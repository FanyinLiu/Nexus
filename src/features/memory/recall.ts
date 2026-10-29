import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
  MemoryRecallContext,
  MemorySearchMode,
  MemorySemanticMatch,
} from '../../types/index.ts'
import type { EmotionState } from '../autonomy/emotionModel.ts'
import {
  getRecentDailyEntries,
  rankDailyEntries,
  rankMemories,
} from './memory.ts'
import { scoreRecallKeywordOverlap } from './recallTokens.ts'
import { classifyRecallConfidence, getRecallConfidenceThresholds } from './recallConfidence.ts'
import {
  cosineSimilarity,
  embedMemorySearchTextWithModel,
  embedMemoryTextsWithModel,
  resolveActiveMemoryEmbeddingModel,
} from './vectorSearch.ts'
import { getDecayedScore } from './decay.ts'
import { getSupersededRecallPenalty } from './contradictionDetector.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import {
  computeEmotionResonance,
  detectRegulatoryMode,
  projectToVA,
  recordPrimingCentroid,
  type RegulatoryMode,
} from './emotionResonance.ts'

type BuildMemoryRecallContextParams = {
  query: string
  longTermMemories: MemoryItem[]
  dailyMemories: DailyMemoryStore
  searchMode: MemorySearchMode
  embeddingModel: string
  longTermLimit: number
  dailyLimit: number
  semanticLimit: number
  retentionDays: number
  /** Current emotion state — enables mood-aware recall ranking. */
  currentEmotion?: EmotionState
}

type ScoredItem<T extends { id: string; createdAt: string; content: string }> = {
  item: T
  keywordScore: number
  vectorScore: number
  finalScore: number
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }

    seen.add(item.id)
    return true
  })
}

/**
 * Recency is a tie-break, not a ranking signal. At 0.18 a four-day-old
 * unrelated memory could outrank an older exact answer ("What's my cat
 * called?" lost to a recent movie note); semantic rank already carries the
 * question, so a few hundredths only nudges otherwise-equal candidates.
 */
const RECENCY_BOOST_MAX = 0.05

function getRecencyBoost(createdAt: string) {
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return 0
  const ageMs = Math.max(0, Date.now() - parsed)
  const ageHours = ageMs / (60 * 60 * 1000)
  return Math.max(0, 1 - Math.min(ageHours, 96) / 96) * RECENCY_BOOST_MAX
}

// Half of the previous weights: a category is a weak prior about where a kind
// of fact lives, not evidence that it answers this question. A project boost
// of 0.10 used to lift an unrelated work project over the asked-about hobby.
const CATEGORY_WEIGHT: Record<string, number> = {
  feedback: 0.075,
  project: 0.05,
  preference: 0.025,
  goal: 0.025,
  reference: 0.015,
  manual: 0.04,
  habit: 0.01,
  profile: 0,
}

/**
 * Hybrid rank weights. The lexical share only breaks near-ties: BM25 and the
 * CJK bigram overlap are strong on exact wording but match generic particles
 * ("最近", "什么") in many memories, so a larger share let those memories
 * outrank the semantic answer. Vector semantics stays the primary signal.
 */
const HYBRID_VECTOR_WEIGHT = 0.8
const HYBRID_KEYWORD_WEIGHT = 0.1

type EmotionContext = {
  currentEmotion: EmotionState
  regulatoryMode: RegulatoryMode
}

function scoreItem<T extends {
  content: string
  createdAt: string
  category?: string
  importanceScore?: number
  importance?: string
  emotionSnapshot?: MemoryItem['emotionSnapshot']
  emotionalValence?: MemoryItem['emotionalValence']
  significance?: number
}>(
  item: T,
  query: string,
  mode: MemorySearchMode,
  scores: ScoreMapEntry,
  emotionContext: EmotionContext | null,
  rankVectorScore: number = scores.vectorScore,
) {
  // Use BM25 score from main process when available, fall back to a
  // CJK-aware token overlap.
  const keywordScore = scores.bm25Score > 0
    ? scores.bm25Score
    : scoreRecallKeywordOverlap(item.content, query)
  const vectorScore = scores.vectorScore
  const recencyBoost = getRecencyBoost(item.createdAt)
  const categoryBoost = CATEGORY_WEIGHT[item.category ?? ''] ?? 0

  // Decay-weighted importance boost (0–0.15 range). Significance amplifies
  // the boost by up to 40% for memories formed under high emotional load —
  // Lumen-style "peak moments resurface more readily" without altering
  // the underlying decay curve.
  const decayBoost = 'importanceScore' in item
    ? (getDecayedScore(item as unknown as MemoryItem) - 0.5)
      * 0.3
      * (1 + (item.significance ?? 0) * 0.4)
    : 0

  const emotionBoost = emotionContext
    ? computeEmotionResonance({
        currentEmotion: emotionContext.currentEmotion,
        memorySnapshot: item.emotionSnapshot,
        memoryValence: item.emotionalValence,
        mode: emotionContext.regulatoryMode,
      })
    : 0

  // Superseded memories (contradiction resolution) lose recall weight so
  // the newer stance wins in conversation. Both tiers are automatic:
  // confirmed ×0.3, low-confidence ×0.6.
  const supersededPenalty = 'supersededBy' in item
    ? getSupersededRecallPenalty(item as unknown as MemoryItem)
    : 1

  if (mode === 'vector') {
    return {
      keywordScore,
      vectorScore,
      finalScore: (rankVectorScore + recencyBoost + categoryBoost + decayBoost + emotionBoost) * supersededPenalty,
    }
  }

  return {
    keywordScore,
    vectorScore,
    finalScore:
      (keywordScore * HYBRID_KEYWORD_WEIGHT
        + rankVectorScore * HYBRID_VECTOR_WEIGHT
        + recencyBoost
        + categoryBoost
        + decayBoost
        + emotionBoost)
      * supersededPenalty,
  }
}

/**
 * Spread vector scores over [0, 1] within this candidate set before they
 * are mixed with the fixed boosts (recency ≤0.05, category ≤0.075, decay,
 * emotion). Neural embeddings put every memory at cosine 0.3–0.6 with the
 * right one often only ~0.05 ahead, so raw cosine let a category bonus
 * outrank the actual semantic match. Raw scores are still reported for the
 * semantic-match threshold.
 */
function buildVectorRankNormalizer(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length < 2) return (value: number) => value
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const spread = max - min
  if (spread < 1e-6) return (value: number) => value
  return (value: number) => (value - min) / spread
}

function sortScoredItems<T extends {
  id: string
  createdAt: string
  content: string
  emotionSnapshot?: MemoryItem['emotionSnapshot']
  emotionalValence?: MemoryItem['emotionalValence']
}>(
  items: T[],
  query: string,
  mode: MemorySearchMode,
  scoreMap: Map<string, ScoreMapEntry>,
  emotionContext: EmotionContext | null,
) {
  const defaultScores: ScoreMapEntry = { vectorScore: 0, bm25Score: 0 }
  const rankVector = buildVectorRankNormalizer(items.map((item) => (scoreMap.get(item.id) ?? defaultScores).vectorScore))

  return items
    .map((item) => {
      const scores = scoreMap.get(item.id) ?? defaultScores
      const { keywordScore, vectorScore, finalScore } = scoreItem(
        item,
        query,
        mode,
        scores,
        emotionContext,
        rankVector(scores.vectorScore),
      )

      return {
        item,
        keywordScore,
        vectorScore,
        finalScore,
      } satisfies ScoredItem<T>
    })
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore
      }

      const rDate = Date.parse(right.item.createdAt) || 0
      const lDate = Date.parse(left.item.createdAt) || 0
      return rDate - lDate
    })
}

let _indexQueue: Promise<void> = Promise.resolve()

function indexMemoriesToVectorStore<T extends { id: string; content: string }>(
  items: T[],
  embeddingModel: string,
  layer: string,
) {
  const job = _indexQueue.then(() => doIndexMemoriesToVectorStore(items, embeddingModel, layer))
  const settled = job.catch((err) => {
    console.warn('[memory] Vector index queue job failed:', getRedactedLogErrorMessage(err))
    return false
  })
  _indexQueue = settled.then(() => undefined)
  // Return the caught chain so callers using `void` never trigger unhandled
  // rejections. Resolves true when every item was indexed with the model.
  return settled
}

// What this session already sent to the main-process vector store, keyed
// by `${model}\u0000${memory id}` -> content. Recall scores every active
// memory now, so without this every chat turn would re-send ~500 vectors.
// An edited memory is re-indexed. Keyed per model so a session that moves
// between two models (auto mode: hash while qwen3 re-embeds, or a fallback)
// does not re-send each model's vectors every time it switches back.
const indexedThisSession = new Map<string, string>()
const INDEX_BATCH_SIZE = 32

function indexLedgerKey(model: string, id: string) {
  return `${model}\u0000${id}`
}

/** Forget the whole "indexed this session" ledger (memory clear). */
export function resetMemoryRecallIndexLedger(): void {
  indexedThisSession.clear()
}

/** Forget one memory id across models (single delete). */
export function forgetMemoryFromRecallIndexLedger(id: string): void {
  const target = String(id ?? '')
  if (!target) return
  const suffix = `\u0000${target}`
  for (const key of [...indexedThisSession.keys()]) {
    if (key.endsWith(suffix)) indexedThisSession.delete(key)
  }
}

async function doIndexMemoriesToVectorStore<T extends { id: string; content: string }>(
  items: T[],
  embeddingModel: string,
  layer: string,
): Promise<boolean> {
  if (!window.desktopPet?.memoryVectorIndexBatch) return true

  const pending = items.filter((item) => (
    item.content.trim() && indexedThisSession.get(indexLedgerKey(embeddingModel, item.id)) !== item.content
  ))

  for (let start = 0; start < pending.length; start += INDEX_BATCH_SIZE) {
    const chunk = pending.slice(start, start + INDEX_BATCH_SIZE)
    const { embeddings, model } = await embedMemoryTextsWithModel(
      chunk.map((item) => item.content),
      embeddingModel,
      'document',
    )
    // Never store a fallback vector under another model's slot: if Ollama
    // dropped out, stop and let a later recall index the rest.
    if (model !== embeddingModel) return false

    const batch = chunk
      .map((item, index) => ({ id: item.id, content: item.content, embedding: embeddings[index] ?? [], layer, model }))
      .filter((entry) => entry.embedding.length)
    if (!batch.length) continue

    try {
      await window.desktopPet.memoryVectorIndexBatch(batch)
      for (const entry of batch) {
        indexedThisSession.set(indexLedgerKey(model, entry.id), entry.content)
      }
    } catch (error) {
      console.warn('[Memory] Vector index batch failed:', getRedactedLogErrorMessage(error))
      return false
    }
  }
  return true
}

/**
 * Re-embed memories with a newly selected model in the background (after a
 * model switch), so the first recall does not pay for embedding the whole
 * store and the main-process index stops holding vectors from the old
 * model. Safe to call repeatedly: already-indexed items are skipped.
 */
export function reindexMemoriesForEmbeddingModel<T extends { id: string; content: string }>(
  items: T[],
  embeddingModel: string,
  layer: 'long_term' | 'daily' = 'long_term',
): Promise<boolean> {
  const active = resolveActiveMemoryEmbeddingModel(embeddingModel)
  // The requested model is cooling down after a failure: nothing to do now.
  if (active !== embeddingModel) return Promise.resolve(false)
  return indexMemoriesToVectorStore(items, active, layer)
}

/**
 * vectorScore feeds ranking (the main-process hybrid search normalizes it
 * by the best hit); rawVectorScore is always the plain cosine, which is what
 * the low-confidence rule and the prompt's confidence read.
 */
type ScoreMapEntry = { vectorScore: number; bm25Score: number; rawVectorScore?: number }

async function scoreLocally<T extends { id: string; content: string }>(
  items: T[],
  queryEmbedding: number[],
  embeddingModel: string,
) {
  const { embeddings } = await embedMemoryTextsWithModel(
    items.map((item) => item.content),
    embeddingModel,
    'document',
  )
  return items.map((item, index) => [item.id, cosineSimilarity(queryEmbedding, embeddings[index] ?? [])] as const)
}

async function buildScoreMap<T extends { id: string; content: string }>(
  items: T[],
  query: string,
  requestedModel: string,
): Promise<{ scoreMap: Map<string, ScoreMapEntry>; embeddingModel: string }> {
  // The query decides the embedding space for the whole recall: if Ollama
  // is unavailable it comes back as a local-hash vector, and every memory
  // below is then embedded with the hash too, so vectors always match.
  const { embedding: queryEmbedding, model: embeddingModel } = await embedMemorySearchTextWithModel(
    query,
    requestedModel,
    'query',
  )
  if (!queryEmbedding.length) {
    return { scoreMap: new Map(), embeddingModel }
  }
  const scoreMap = await buildScoreMapForEmbedding(items, query, queryEmbedding, embeddingModel)
  return { scoreMap, embeddingModel }
}

async function buildScoreMapForEmbedding<T extends { id: string; content: string }>(
  items: T[],
  query: string,
  queryEmbedding: number[],
  embeddingModel: string,
): Promise<Map<string, ScoreMapEntry>> {
  // Prefer hybrid search (vector + BM25 in main process)
  if (window.desktopPet?.memoryHybridSearch) {
    try {
      const results = await window.desktopPet.memoryHybridSearch({
        queryEmbedding,
        queryText: query,
        limit: items.length,
        threshold: 0,
        model: embeddingModel,
      })

      const itemIds = new Set(items.map((item) => item.id))
      const scoreMap = new Map<string, ScoreMapEntry>()
      const staleKeyword = new Map<string, number>()
      for (const r of results) {
        if (!itemIds.has(r.id)) continue
        if (r.vectorStale) {
          // Stored vector is from another model/dimension: keep the BM25
          // score, recompute the vector score below.
          staleKeyword.set(r.id, r.keywordScore)
          continue
        }
        scoreMap.set(r.id, {
          vectorScore: r.vectorScore,
          bm25Score: r.keywordScore,
          rawVectorScore: typeof r.rawVectorScore === 'number' ? r.rawVectorScore : r.vectorScore,
        })
      }

      // Fill missing items with local embeddings (not yet indexed in main
      // process, or indexed under a different embedding model).
      const missingItems = items.filter((item) => !scoreMap.has(item.id))
      if (missingItems.length) {
        const missingPairs = await scoreLocally(missingItems, queryEmbedding, embeddingModel)
        for (const [id, score] of missingPairs) {
          scoreMap.set(id, { vectorScore: score, bm25Score: staleKeyword.get(id) ?? 0 })
        }
      }

      return scoreMap
    } catch (error) {
      console.warn('[Memory] Hybrid search failed, falling back to vector-only:', getRedactedLogErrorMessage(error))
    }
  }

  // Fallback: vector-only via main process or local computation
  if (window.desktopPet?.memoryVectorSearch) {
    try {
      const results = await window.desktopPet.memoryVectorSearch({
        queryEmbedding,
        limit: items.length,
        threshold: 0,
        model: embeddingModel,
      })

      const itemIds = new Set(items.map((item) => item.id))
      const scoreMap = new Map<string, ScoreMapEntry>()
      for (const result of results) {
        if (itemIds.has(result.id)) {
          scoreMap.set(result.id, { vectorScore: result.score, bm25Score: 0 })
        }
      }

      const missingItems = items.filter((item) => !scoreMap.has(item.id))
      if (missingItems.length) {
        const missingPairs = await scoreLocally(missingItems, queryEmbedding, embeddingModel)
        for (const [id, score] of missingPairs) {
          scoreMap.set(id, { vectorScore: score, bm25Score: 0 })
        }
      }

      return scoreMap
    } catch (error) {
      console.warn('[Memory] Vector search failed, falling back to per-item embeddings:', getRedactedLogErrorMessage(error))
    }
  }

  const pairs = await scoreLocally(items, queryEmbedding, embeddingModel)

  return new Map(pairs.map(([id, score]) => [id, { vectorScore: score, bm25Score: 0 }]))
}

function buildSemanticMatches(
  longTerm: Array<ScoredItem<MemoryItem>>,
  daily: Array<ScoredItem<DailyMemoryEntry>>,
  limit: number,
  rawOf: (id: string) => number = () => Number.NaN,
) {
  // The confidence the prompt shows is the raw cosine: the hybrid search's
  // vectorScore is normalized by the best hit, so it always read 1.00.
  const confidence = (id: string, vectorScore: number) => {
    const raw = rawOf(id)
    return Number.isFinite(raw) ? raw : vectorScore
  }
  const combined: MemorySemanticMatch[] = [
    ...longTerm.map(({ item, vectorScore }) => ({
      id: item.id,
      layer: 'long_term' as const,
      content: item.content,
      score: confidence(item.id, vectorScore),
    })),
    ...daily.map(({ item, vectorScore }) => ({
      id: item.id,
      layer: 'daily' as const,
      content: item.content,
      score: confidence(item.id, vectorScore),
    })),
  ]

  return combined
    .filter((item) => item.score > 0.08)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

function buildEmotionContext(
  currentEmotion: EmotionState | undefined,
  userMessage: string,
): EmotionContext | null {
  if (!currentEmotion) return null
  return {
    currentEmotion,
    regulatoryMode: detectRegulatoryMode(currentEmotion, userMessage),
  }
}

function updatePrimingFromSelection(
  selected: Array<{ emotionSnapshot?: MemoryItem['emotionSnapshot'] }>,
): void {
  const snapshots = selected
    .map((item) => item.emotionSnapshot)
    .filter((snap): snap is NonNullable<typeof snap> => !!snap)
  if (snapshots.length === 0) return

  let v = 0, a = 0
  for (const s of snapshots) {
    const va = projectToVA(s)
    v += va.valence
    a += va.arousal
  }
  recordPrimingCentroid({ valence: v / snapshots.length, arousal: a / snapshots.length })
}

export async function buildMemoryRecallContext({
  query,
  longTermMemories,
  dailyMemories,
  searchMode,
  embeddingModel,
  longTermLimit,
  dailyLimit,
  semanticLimit,
  retentionDays,
  currentEmotion,
}: BuildMemoryRecallContextParams): Promise<MemoryRecallContext> {
  const activeLongTermMemories = longTermMemories.filter((memory) => (
    memory.enabled !== false
    && memory.status !== 'superseded'
    && memory.status !== 'archived'
  ))
  const keywordLongTerm = rankMemories(activeLongTermMemories, query)
  const recentDaily = getRecentDailyEntries(dailyMemories, retentionDays).slice(0, 24)
  const keywordDaily = rankDailyEntries(recentDaily, query)

  const emotionContext = buildEmotionContext(currentEmotion, query)

  const keywordDailyResult = uniqueById([
    ...keywordDaily.slice(0, dailyLimit),
    ...recentDaily.slice(0, 2),
  ]).slice(0, dailyLimit)

  if (searchMode === 'keyword') {
    const selectedLongTerm = keywordLongTerm.slice(0, longTermLimit)
    updatePrimingFromSelection(selectedLongTerm)
    return {
      longTerm: selectedLongTerm,
      daily: keywordDailyResult,
      semantic: [],
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
      recalledLongTermIds: selectedLongTerm.map((m) => m.id),
    }
  }

  // Hybrid used to pre-filter long-term candidates to the keyword top 12,
  // so a paraphrased query with little word overlap (the normal case in
  // Chinese) never reached vector scoring at all. The long-term store is
  // capped (MAX_LONG_TERM_MEMORIES), vectors are cached / indexed in the
  // main process, and keyword overlap still carries 30% of the hybrid
  // score, so every active memory is scored.
  const longTermCandidates = activeLongTermMemories
  const dailyCandidates = searchMode === 'vector'
    ? recentDaily
    : uniqueById([
        ...keywordDaily.slice(0, Math.max(dailyLimit * 3, 12)),
        ...recentDaily.slice(0, 6),
      ])

  try {
    const { scoreMap, embeddingModel: usedEmbeddingModel } = await buildScoreMap(
      [...longTermCandidates, ...dailyCandidates],
      query,
      resolveActiveMemoryEmbeddingModel(embeddingModel),
    )

    const scoredLongTerm = sortScoredItems(longTermCandidates, query, searchMode, scoreMap, emotionContext)
    const scoredDaily = sortScoredItems(dailyCandidates, query, searchMode, scoreMap, emotionContext)

    void indexMemoriesToVectorStore(longTermCandidates, usedEmbeddingModel, 'long_term')
    void indexMemoriesToVectorStore(dailyCandidates, usedEmbeddingModel, 'daily')

    const rawOf = (id: string) => {
      const entry = scoreMap.get(id)
      // A missing score is unknown, not zero: zero would look like a real
      // (bad) neighbour and could push an answerable memory into rejection.
      return entry?.rawVectorScore ?? entry?.vectorScore ?? Number.NaN
    }
    // Duplicate copies of one memory would flatten the top-two margin and
    // make a real fact look like a field of unrelated neighbours. Confidence
    // reads distinct contents; the selection below still keeps every copy.
    const contentScores = new Map<string, number>()
    for (const item of longTermCandidates) {
      const content = item.content.trim()
      const score = rawOf(item.id)
      const previous = contentScores.get(content)
      if (previous === undefined || (!Number.isFinite(previous) && Number.isFinite(score))) {
        contentScores.set(content, score)
      }
    }
    const confidenceScores = [...contentScores.values()]
    const recallConfidence = confidenceScores.length
      ? classifyRecallConfidence(confidenceScores, usedEmbeddingModel)
      : getRecallConfidenceThresholds(usedEmbeddingModel)
        ? 'none'
        : undefined
    const selectedLongTerm = recallConfidence === 'none'
      ? []
      : scoredLongTerm.slice(0, longTermLimit).map(({ item }) => item)
    updatePrimingFromSelection(selectedLongTerm)
    return {
      ...(recallConfidence ? { recallConfidence } : {}),
      longTerm: selectedLongTerm,
      daily: uniqueById([
        ...scoredDaily.slice(0, dailyLimit).map(({ item }) => item),
        ...recentDaily.slice(0, 2),
      ]).slice(0, dailyLimit),
      semantic: buildSemanticMatches(
        recallConfidence === 'none' ? [] : scoredLongTerm,
        scoredDaily,
        semanticLimit,
        rawOf,
      ),
      searchModeUsed: searchMode,
      vectorSearchAvailable: true,
      recalledLongTermIds: selectedLongTerm.map((m) => m.id),
    }
  } catch (error) {
    console.warn('[Memory] Score map build failed, falling back to keyword-only:', getRedactedLogErrorMessage(error))
    const fallbackLongTerm = keywordLongTerm.slice(0, longTermLimit)
    updatePrimingFromSelection(fallbackLongTerm)
    return {
      longTerm: fallbackLongTerm,
      daily: keywordDailyResult,
      semantic: [],
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
      recalledLongTermIds: fallbackLongTerm.map((m) => m.id),
    }
  }
}
