import { LOCAL_HASH_MEMORY_MODEL_ID } from './constants'

const localHashDimensions = 256
const MAX_CACHE_SIZE = 1000
const embeddingCache = new Map<string, Promise<number[]>>()
let remoteVectorRuntimePromise: Promise<typeof import('./vectorSearchRuntime')> | null = null

function setEmbeddingCache(key: string, value: Promise<number[]>): void {
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value
    if (firstKey !== undefined) {
      embeddingCache.delete(firstKey)
    }
  }
  embeddingCache.set(key, value)
}

// 重新导出，确保外部使用 setEmbeddingCache

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

export function isLocalHashMemoryModel(model: string) {
  return normalizeForEmbedding(model) === LOCAL_HASH_MEMORY_MODEL_ID
}

async function getRemoteVectorRuntime() {
  if (!remoteVectorRuntimePromise) {
    remoteVectorRuntimePromise = import('./vectorSearchRuntime')
  }

  return remoteVectorRuntimePromise
}

export async function warmupMemoryVectorModel(model: string) {
  if (isLocalHashMemoryModel(model)) {
    return
  }

  const runtime = await getRemoteVectorRuntime()
  await runtime.warmupRemoteMemoryVectorModel(model)
}

export async function embedMemorySearchText(text: string, model: string) {
  const normalizedText = normalizeForEmbedding(text)

  if (!normalizedText) {
    return []
  }

  const normalizedModel = normalizeForEmbedding(model) || LOCAL_HASH_MEMORY_MODEL_ID
  const cacheKey = `${normalizedModel}::${normalizedText}`
  const cached = embeddingCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const nextEmbedding = (async () => {
    if (isLocalHashMemoryModel(normalizedModel)) {
      return buildLocalHashEmbedding(normalizedText)
    }

    const runtime = await getRemoteVectorRuntime()
    return runtime.embedRemoteMemorySearchText(normalizedText, model)
  })()

  setEmbeddingCache(cacheKey, nextEmbedding)

  try {
    return await nextEmbedding
  } catch (error) {
    embeddingCache.delete(cacheKey)
    throw error
  }
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
