import { LOCAL_HASH_MEMORY_MODEL_ID } from './constants.ts'
import { resolveMemoryEmbeddingModelSetting } from './memoryEmbeddingAuto.ts'
import {
  embedTextsWithOllama,
  isOllamaMemoryModel,
  isOllamaMemoryModelCoolingDown,
  type MemoryEmbeddingPurpose,
} from './ollamaEmbedding.ts'

export type { MemoryEmbeddingPurpose } from './ollamaEmbedding.ts'

const localHashDimensions = 256
const MAX_CACHE_SIZE = 1000
const embeddingCache = new Map<string, Promise<number[]>>()
let remoteVectorRuntimePromise: Promise<typeof import('./vectorSearchRuntime.ts')> | null = null

function setEmbeddingCache(key: string, value: Promise<number[]>): void {
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value
    if (firstKey !== undefined) {
      embeddingCache.delete(firstKey)
    }
  }
  embeddingCache.set(key, value)
}

/**
 * Drop every cached vector. Cache keys contain the memory text itself, so a
 * memory clear has to empty this map even though only vectors are stored.
 */
export function clearMemoryEmbeddingCache(): void {
  embeddingCache.clear()
}

/**
 * Drop the cached vectors for one deleted memory. Ollama keys keep the
 * collapsed text while the local hash keeps the normalized text, so both
 * spellings are checked.
 */
export function clearMemoryEmbeddingCacheForText(text: string): void {
  const compact = String(text).replace(/\s+/g, ' ').trim()
  const normalized = normalizeForEmbedding(text)
  if (!compact && !normalized) return
  for (const key of [...embeddingCache.keys()]) {
    if ((compact && key.endsWith(`::${compact}`)) || (normalized && key.endsWith(`::${normalized}`))) {
      embeddingCache.delete(key)
    }
  }
}

// Re-exported so external callers go through setEmbeddingCache.

function normalizeForEmbedding(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalizeVector(values: ArrayLike<number>) {
  const raw = Array.from(values, (value) => Number(value) || 0)
  const magnitude = Math.hypot(...raw)

  if (!magnitude) {
    return raw
  }

  return raw.map((value) => value / magnitude)
}

function hashToken(token: string) {
  let hash = 2166136261

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function buildLocalHashTokens(text: string) {
  const normalized = normalizeForEmbedding(text)
  const wordTokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const compact = normalized.replace(/\s+/g, '')
  const ngrams: string[] = []

  for (let size = 2; size <= 3; size += 1) {
    if (compact.length < size) continue

    for (let index = 0; index <= compact.length - size; index += 1) {
      ngrams.push(compact.slice(index, index + size))
    }
  }

  return [...wordTokens, ...ngrams]
}

function buildLocalHashEmbedding(text: string) {
  const vector = new Float32Array(localHashDimensions)

  for (const token of buildLocalHashTokens(text)) {
    const hash = hashToken(token)
    const index = hash % localHashDimensions
    const sign = hash % 2 === 0 ? 1 : -1
    vector[index] += sign * (1 + Math.log1p(token.length))
  }

  return normalizeVector(vector)
}

/**
 * Synchronous local-hash embedding used when a remote vector model is
 * unavailable. Empty text returns an empty vector so callers can skip it.
 */
export function embedLocalHashMemoryText(text: string): number[] {
  const normalized = normalizeForEmbedding(text)
  if (!normalized) return []
  return buildLocalHashEmbedding(normalized)
}

/** True for the local hash, including `auto` while it resolves to the hash. */
export function isLocalHashMemoryModel(model: string) {
  return normalizeForEmbedding(resolveMemoryEmbeddingModelSetting(model)) === LOCAL_HASH_MEMORY_MODEL_ID
}

/**
 * The embedding model a recall should actually use right now: an Ollama
 * model that just failed is swapped for the local hash until its cooldown
 * ends, so one recall never mixes vectors from two spaces.
 */
export function resolveActiveMemoryEmbeddingModel(model: string) {
  const trimmed = resolveMemoryEmbeddingModelSetting(model) || LOCAL_HASH_MEMORY_MODEL_ID
  if (isOllamaMemoryModel(trimmed) && isOllamaMemoryModelCoolingDown(trimmed)) {
    return LOCAL_HASH_MEMORY_MODEL_ID
  }
  return trimmed
}

function normalizeModelId(model: string) {
  // `auto` -> whatever it currently resolves to (qwen3 or the local hash).
  const trimmed = resolveMemoryEmbeddingModelSetting(model)
  if (!trimmed) return LOCAL_HASH_MEMORY_MODEL_ID
  return isLocalHashMemoryModel(trimmed) ? LOCAL_HASH_MEMORY_MODEL_ID : trimmed
}

async function getRemoteVectorRuntime() {
  if (!remoteVectorRuntimePromise) {
    remoteVectorRuntimePromise = import('./vectorSearchRuntime.ts')
  }

  return remoteVectorRuntimePromise
}

export async function warmupMemoryVectorModel(model: string) {
  model = resolveMemoryEmbeddingModelSetting(model)
  if (isLocalHashMemoryModel(model)) {
    return
  }

  if (isOllamaMemoryModel(model)) {
    // Probe once so the settings status reflects reality (ready / missing
    // model / Ollama down). Failures are recorded, not thrown.
    await embedTextsWithOllama(['nexus memory warmup'], model, 'document').catch(() => undefined)
    return
  }

  const runtime = await getRemoteVectorRuntime()
  await runtime.warmupRemoteMemoryVectorModel(model)
}

export type MemoryEmbeddingResult = {
  embedding: number[]
  /** Model the vector really came from (local hash after an Ollama fallback). */
  model: string
}

async function cachedEmbedding(cacheKey: string, compute: () => Promise<number[]>) {
  const cached = embeddingCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const nextEmbedding = compute()
  setEmbeddingCache(cacheKey, nextEmbedding)

  try {
    return await nextEmbedding
  } catch (error) {
    embeddingCache.delete(cacheKey)
    throw error
  }
}

/**
 * Embed one text and report which model produced the vector. Ollama models
 * fall back to the local hash when Ollama is down or the model is missing;
 * the fallback vector is cached under the hash model id, never under the
 * Ollama id, so a later successful call is not shadowed by it.
 *
 * `purpose` matters for instruction-aware models (qwen3-embedding): queries
 * get a task instruction, stored memories are embedded as-is.
 */
export async function embedMemorySearchTextWithModel(
  text: string,
  model: string,
  purpose: MemoryEmbeddingPurpose = 'document',
  options: { reportStatus?: boolean } = {},
): Promise<MemoryEmbeddingResult> {
  const normalizedText = normalizeForEmbedding(text)
  const requestedModel = normalizeModelId(model)

  if (!normalizedText) {
    return { embedding: [], model: requestedModel }
  }

  if (isOllamaMemoryModel(requestedModel)) {
    if (!isOllamaMemoryModelCoolingDown(requestedModel)) {
      // Keep casing for the neural model; only collapse whitespace.
      const modelText = String(text).replace(/\s+/g, ' ').trim()
      try {
        const embedding = await cachedEmbedding(
          `${requestedModel}::${purpose}::${modelText}`,
          async () => (await embedTextsWithOllama([modelText], requestedModel, purpose, options))[0] ?? [],
        )
        if (embedding.length) {
          return { embedding, model: requestedModel }
        }
      } catch {
        // Status + cooldown already recorded by the Ollama backend.
      }
    }

    return {
      embedding: await cachedEmbedding(
        `${LOCAL_HASH_MEMORY_MODEL_ID}::${normalizedText}`,
        async () => buildLocalHashEmbedding(normalizedText),
      ),
      model: LOCAL_HASH_MEMORY_MODEL_ID,
    }
  }

  const embedding = await cachedEmbedding(`${requestedModel.toLowerCase()}::${normalizedText}`, async () => {
    if (isLocalHashMemoryModel(requestedModel)) {
      return buildLocalHashEmbedding(normalizedText)
    }

    const runtime = await getRemoteVectorRuntime()
    return runtime.embedRemoteMemorySearchText(normalizedText, model)
  })
  return { embedding, model: requestedModel }
}

/**
 * Batch version for stored memories. Ollama gets one request per 32 texts
 * instead of one per memory; everything else goes through the single-text
 * path. All returned vectors come from the same model (reported), falling
 * back to the local hash for the whole batch if Ollama fails.
 */
export async function embedMemoryTextsWithModel(
  texts: string[],
  model: string,
  purpose: MemoryEmbeddingPurpose = 'document',
  options: { reportStatus?: boolean } = {},
): Promise<{ embeddings: number[][]; model: string }> {
  const requestedModel = normalizeModelId(model)
  if (isOllamaMemoryModel(requestedModel) && !isOllamaMemoryModelCoolingDown(requestedModel)) {
    const modelTexts = texts.map((text) => String(text).replace(/\s+/g, ' ').trim())
    const keys = modelTexts.map((text) => `${requestedModel}::${purpose}::${text}`)
    const pending = [...new Set(modelTexts.filter((text, index) => text && !embeddingCache.has(keys[index])))]
    try {
      if (pending.length) {
        const vectors = await embedTextsWithOllama(pending, requestedModel, purpose, options)
        pending.forEach((text, index) => {
          setEmbeddingCache(`${requestedModel}::${purpose}::${text}`, Promise.resolve(vectors[index] ?? []))
        })
      }
      const embeddings = await Promise.all(modelTexts.map((text, index) => (
        text ? (embeddingCache.get(keys[index]) ?? embedMemorySearchText(text, requestedModel, purpose)) : Promise.resolve([])
      )))
      return { embeddings, model: requestedModel }
    } catch {
      // Fall through to the hash for the whole batch.
    }
  }

  if (isOllamaMemoryModel(requestedModel)) {
    return {
      embeddings: texts.map((text) => embedLocalHashMemoryText(text)),
      model: LOCAL_HASH_MEMORY_MODEL_ID,
    }
  }

  const embeddings = await Promise.all(texts.map((text) => embedMemorySearchText(text, requestedModel, purpose)))
  return { embeddings, model: requestedModel }
}

export async function embedMemorySearchText(
  text: string,
  model: string,
  purpose: MemoryEmbeddingPurpose = 'document',
) {
  return (await embedMemorySearchTextWithModel(text, model, purpose)).embedding
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || !right.length || left.length !== right.length) {
    return 0
  }

  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index]
  }

  return total
}
