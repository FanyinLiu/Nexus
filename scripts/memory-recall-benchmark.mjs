#!/usr/bin/env node
/**
 * Chinese long-term memory recall benchmark.
 *
 *   node scripts/memory-recall-benchmark.mjs [options]
 *
 * Options:
 *   --models=local-hash-v1,ollama:qwen3-embedding:0.6b   models to compare
 *   --ollama=http://127.0.0.1:11434                       Ollama root
 *   --json=out.json                                       also write raw results
 *   --skip-pipeline                                       embedding-only metrics
 *
 * Dataset: tests/fixtures/memory-recall-zh/dataset.json (fictional user,
 * 40 memories, 45 queries: paraphrase / state change / English / mixed /
 * no-answer). Three measurements per model:
 *   1. embedding-only: cosine over all 40 memories (Recall@1/@3, MRR);
 *   2. pipeline, renderer path: buildMemoryRecallContext() with the default
 *      settings (hybrid, 4 long-term results) and no main-process store;
 *   3. pipeline, main-process path: same, with window.desktopPet backed by
 *      the real electron/services/memoryVectorStore (BM25 + vector worker),
 *      every memory pre-indexed (steady state).
 * Pipeline lists are truncated at the recall limit, so MRR there is MRR@4.
 */

import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
register(new URL("../tests/helpers/memory-vector-electron-hooks.mjs", import.meta.url));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const models = (args.get("models") ?? "local-hash-v1,ollama:qwen3-embedding:0.6b").split(",").map((m) => m.trim()).filter(Boolean);
const ollamaBase = args.get("ollama") ?? "http://127.0.0.1:11434";
const skipPipeline = args.has("skip-pipeline");
const PIPELINE_LIMIT = 4;
const dataset = JSON.parse(await readFile(path.join(root, "tests/fixtures/memory-recall-zh/dataset.json"), "utf8"));
const userData = await mkdtemp(path.join(tmpdir(), "nexus-recall-bench-"));
globalThis.__nexusMemoryVectorUserData = userData;
// Storage modules open a BroadcastChannel when `window` exists; it would keep
// the process alive, so hide it while the renderer modules load.
const realBroadcastChannel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = void 0;
globalThis.window = {
  addEventListener() {
  },
  removeEventListener() {
  },
  dispatchEvent() {
    return true;
  },
  setTimeout,
  clearTimeout
};
const vectorSearch = await import("../src/features/memory/vectorSearch.ts");
const recall = await import("../src/features/memory/recall.ts");
let ollamaModule = null;
try {
  ollamaModule = await import("../src/features/memory/ollamaEmbedding.ts");
  ollamaModule.setOllamaEmbedBaseUrl(ollamaBase);
} catch {
  // Older checkout without the Ollama backend: hash-only comparison.
}
const store = await import("../electron/services/memoryVectorStore.js");
globalThis.BroadcastChannel = realBroadcastChannel;
const now = Date.now();
const memoryItems = dataset.memories.map((memory) => ({
  id: memory.id,
  content: memory.content,
  category: memory.category,
  source: "benchmark",
  enabled: true,
  status: "active",
  importance: "normal",
  createdAt: new Date(now - memory.daysAgo * 864e5).toISOString()
}));
function metrics(rows) {
  const answerable = rows.filter((row) => row.query.relevant.length);
  let r1 = 0;
  let r3 = 0;
  let mrr = 0;
  let stateNewestFirst = 0;
  let stateTotal = 0;
  const byType = /* @__PURE__ */ new Map();
  for (const row of answerable) {
    const relevant = new Set(row.query.relevant);
    const firstHit = row.ranking.findIndex((id) => relevant.has(id));
    const hit1 = firstHit === 0 ? 1 : 0;
    const hit3 = firstHit >= 0 && firstHit < 3 ? 1 : 0;
    const rr = firstHit >= 0 ? 1 / (firstHit + 1) : 0;
    r1 += hit1;
    r3 += hit3;
    mrr += rr;
    const bucket = byType.get(row.query.type) ?? { n: 0, r1: 0, r3: 0, mrr: 0 };
    bucket.n += 1;
    bucket.r1 += hit1;
    bucket.r3 += hit3;
    bucket.mrr += rr;
    byType.set(row.query.type, bucket);
    if (row.query.type === "state") {
      stateTotal += 1;
      const newer = row.ranking.indexOf(row.query.relevant[0]);
      const older = row.ranking.indexOf(row.query.relevant[1]);
      if (newer >= 0 && (older < 0 || newer < older)) stateNewestFirst += 1;
    }
  }
  const none = rows.filter((row) => !row.query.relevant.length);
  const maxNoneScore = Math.max(...none.map((row) => row.topScore), -Infinity);
  const separable = answerable.filter((row) => row.topScore > maxNoneScore).length;
  return {
    n: answerable.length,
    recallAt1: r1 / answerable.length,
    recallAt3: r3 / answerable.length,
    mrr: mrr / answerable.length,
    stateNewestFirst: `${stateNewestFirst}/${stateTotal}`,
    meanTopScoreAnswerable: answerable.reduce((sum, row) => sum + row.topScore, 0) / answerable.length,
    meanTopScoreNone: none.reduce((sum, row) => sum + row.topScore, 0) / Math.max(1, none.length),
    answerableAboveAllNone: `${separable}/${answerable.length}`,
    byType: Object.fromEntries([...byType].map(([type, b]) => [type, {
      n: b.n,
      recallAt1: b.r1 / b.n,
      recallAt3: b.r3 / b.n,
      mrr: b.mrr / b.n
    }]))
  };
}
async function embeddingOnly(model) {
  const docVectors = /* @__PURE__ */ new Map();
  const docStart = performance.now();
  for (const memory of dataset.memories) {
    const result = vectorSearch.embedMemorySearchTextWithModel ? await vectorSearch.embedMemorySearchTextWithModel(memory.content, model, "document") : { embedding: await vectorSearch.embedMemorySearchText(memory.content, model), model };
    if (result.model !== model) throw new Error(`${model} fell back to ${result.model}; is Ollama running and the model pulled?`);
    docVectors.set(memory.id, result.embedding);
  }
  const docMs = (performance.now() - docStart) / dataset.memories.length;
  const rows = [];
  const queryStart = performance.now();
  for (const query of dataset.queries) {
    const queryVector = await vectorSearch.embedMemorySearchText(query.text, model, "query");
    const scored = dataset.memories.map((memory) => ({ id: memory.id, score: vectorSearch.cosineSimilarity(queryVector, docVectors.get(memory.id) ?? []) })).sort((a, b) => b.score - a.score);
    rows.push({ query, ranking: scored.map((s) => s.id), topScore: scored[0]?.score ?? 0 });
  }
  const queryMs = (performance.now() - queryStart) / dataset.queries.length;
  return { metrics: metrics(rows), docMsPerText: docMs, queryMsPerText: queryMs, rows };
}
function installDesktopPet(enabled) {
  const w = globalThis.window;
  if (!enabled) {
    delete w.desktopPet;
    return;
  }
  w.desktopPet = {
    memoryVectorIndexBatch: async (batch) => {
      await store.indexBatch(batch);
      return { ok: true, count: batch.length };
    },
    memoryVectorSearch: async (payload) => store.searchSimilar(payload.queryEmbedding, payload),
    memoryHybridSearch: async (payload) => store.searchHybrid(payload.queryEmbedding, payload.queryText, payload)
  };
}
async function pipeline(model, mainProcess) {
  await store.clearAllEntries();
  installDesktopPet(mainProcess);
  if (mainProcess) {
    const batch = [];
    for (const memory of dataset.memories) {
      const embedding = await vectorSearch.embedMemorySearchText(memory.content, model, "document");
      batch.push({ id: memory.id, content: memory.content, embedding, layer: "long_term", model });
    }
    await store.indexBatch(batch);
  }
  const rows = [];
  for (const query of dataset.queries) {
    const context = await recall.buildMemoryRecallContext({
      query: query.text,
      longTermMemories: memoryItems,
      dailyMemories: {},
      searchMode: "hybrid",
      embeddingModel: model,
      longTermLimit: PIPELINE_LIMIT,
      dailyLimit: 4,
      semanticLimit: 4,
      retentionDays: 7
    });
    const top = context.semantic?.[0]?.score ?? 0;
    rows.push({ query, ranking: context.longTerm.map((item) => item.id), topScore: top });
  }
  installDesktopPet(false);
  return { metrics: metrics(rows), rows };
}
async function ollamaLatency(model) {
  const name = model.replace(/^ollama:/, "");
  const texts = dataset.memories.map((m) => m.content);
  const single = [];
  for (const text of texts.slice(0, 20)) {
    const start2 = performance.now();
    const response2 = await fetch(`${ollamaBase}/api/embed`, { method: "POST", body: JSON.stringify({ model: name, input: `${text} ` }) });
    await response2.json();
    single.push(performance.now() - start2);
  }
  const start = performance.now();
  const response = await fetch(`${ollamaBase}/api/embed`, { method: "POST", body: JSON.stringify({ model: name, input: texts.map((t) => `${t}  `) }) });
  await response.json();
  const batchTotal = performance.now() - start;
  single.sort((a, b) => a - b);
  return {
    singleMedianMs: single[Math.floor(single.length / 2)],
    singleP90Ms: single[Math.floor(single.length * 0.9)],
    batch40PerTextMs: batchTotal / texts.length
  };
}
const results = {};
for (const model of models) {
  if (model.startsWith("ollama:") && !ollamaModule) {
    console.warn(`skip ${model}: this checkout has no Ollama backend`);
    continue;
  }
  const entry = {};
  const emb = await embeddingOnly(model);
  entry.embeddingOnly = emb.metrics;
  entry.latency = model.startsWith("ollama:") ? { ...await ollamaLatency(model), docMsPerTextViaBackend: emb.docMsPerText, queryMsPerTextViaBackend: emb.queryMsPerText } : { docMsPerTextViaBackend: emb.docMsPerText, queryMsPerTextViaBackend: emb.queryMsPerText };
  if (!skipPipeline) {
    entry.pipelineRenderer = (await pipeline(model, false)).metrics;
    const main = await pipeline(model, true);
    entry.pipelineMainProcess = main.metrics;
    entry.pipelineMainProcessMisses = main.rows.filter((row) => row.query.relevant.length && !row.query.relevant.includes(row.ranking[0])).map((row) => `${row.query.id} ${row.query.text} -> ${row.ranking.join(",")}`);
  }
  entry.embeddingOnlyMisses = emb.rows.filter((row) => row.query.relevant.length && !row.query.relevant.includes(row.ranking[0])).map((row) => `${row.query.id} ${row.query.text} -> ${row.ranking.slice(0, 3).join(",")}`);
  results[model] = entry;
}
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const lines = ["| model | measurement | R@1 | R@3 | MRR | state newest-first | top score answerable / none |", "|---|---|---|---|---|---|---|"];
for (const [model, entry] of Object.entries(results)) {
  for (const key of ["embeddingOnly", "pipelineRenderer", "pipelineMainProcess"]) {
    const m = entry[key];
    if (!m) continue;
    lines.push(`| ${model} | ${key} | ${pct(m.recallAt1)} | ${pct(m.recallAt3)} | ${m.mrr.toFixed(3)} | ${m.stateNewestFirst} | ${m.meanTopScoreAnswerable.toFixed(3)} / ${m.meanTopScoreNone.toFixed(3)} |`);
  }
}
console.log(lines.join("\n"));
console.log(JSON.stringify(results, null, 2));
if (args.get("json")) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(args.get("json"), JSON.stringify(results, null, 2));
}
await store.terminate?.();
await rm(userData, { recursive: true, force: true });
process.exit(0);
