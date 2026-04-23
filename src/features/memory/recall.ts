import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
  MemoryRecallContext,
  MemorySearchMode,
  MemorySemanticMatch,
} from '../../types'
import type { EmotionState } from '../autonomy/emotionModel'
import {
  getRecentDailyEntries,
  rankDailyEntries,
  rankMemories,
  scoreLexicalSimilarity,
} from './memory'
import { cosineSimilarity, embedMemorySearchText } from './vectorSearch'
import { getDecayedScore } from './decay'
import {
  computeEmotionResonance,
  detectRegulatoryMode,
  projectToVA,
  recordPrimingCentroid,
  type RegulatoryMode,
} from './emotionResonance'

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

function getRecencyBoost(createdAt: string) {
  const parsed = Date.parse(createdAt)
  if (!Number.isFinite(parsed)) return 0
  const ageMs = Math.max(0, Date.now() - parsed)
  const ageHours = ageMs / (60 * 60 * 1000)
  return Math.max(0, 1 - Math.min(ageHours, 96) / 96) * 0.18
}

const CATEGORY_WEIGHT: Record<string, number> = {
  feedback: 0.15,
  project: 0.10,
  preference: 0.05,
  goal: 0.05,
  reference: 0.03,
  manual: 0.08,
  habit: 0.02,
  profile: 0,
}

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
) {
  // Use BM25 score from main process when available, fall back to Jaccard
  const keywordScore = scores.bm25Score > 0
    ? scores.bm25Score
    : scoreLexicalSimilarity(item.content, query)
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

  if (mode === 'vector') {
    return {
      keywordScore,
      vectorScore,
      finalScore: vectorScore + recencyBoost + categoryBoost + decayBoost + emotionBoost,
    }
  }

  return {
    keywordScore,
    vectorScore,
    finalScore:
      keywordScore * 0.3 + vectorScore * 0.7 + recencyBoost + categoryBoost + decayBoost + emotionBoost,
  }
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

  return items
    .map((item) => {
      const { keywordScore, vectorScore, finalScore } = scoreItem(
        item,
        query,
        mode,
        scoreMap.get(item.id) ?? defaultScores,
        emotionContext,
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
  _indexQueue = job.catch((err) => {
    console.warn('[memory] Vector index queue job failed:', err)
  })
  // Return the caught chain so callers using `void` never trigger unhandled rejections.
  return _indexQueue
}

async function doIndexMemoriesToVectorStore<T extends { id: string; content: string }>(
  items: T[],
  embeddingModel: string,
  layer: string,
) {
  if (!window.desktopPet?.memoryVectorIndexBatch) return

  const batch: Array<{ id: string; content: string; embedding: number[]; layer: string }> = []
  for (const item of items) {
    const embedding = await embedMemorySearchText(item.content, embeddingModel)
    if (embedding.length) {
      batch.push({ id: item.id, content: item.content, embedding, layer })
    }
  }

  if (batch.length) {
    await window.desktopPet.memoryVectorIndexBatch(batch).catch((error) => {
      console.warn('[Memory] Vector index batch failed:', error)
    })
  }
}

type ScoreMapEntry = { vectorScore: number; bm25Score: number }

async function buildScoreMap<T extends { id: string; content: string }>(
  items: T[],
  query: string,
  embeddingModel: string,
): Promise<Map<string, ScoreMapEntry>> {
  const queryEmbedding = await embedMemorySearchText(query, embeddingModel)
  if (!queryEmbedding.length) {
    return new Map()
  }

  // Prefer hybrid search (vector + BM25 in main process)
  if (window.desktopPet?.memoryHybridSearch) {
    try {
      const results = await window.desktopPet.memoryHybridSearch({
        queryEmbedding,
        queryText: query,
        limit: items.length,
        threshold: 0,
      })

      const itemIds = new Set(items.map((item) => item.id))
      const scoreMap = new Map<string, ScoreMapEntry>()
      for (const r of results) {
        if (itemIds.has(r.id)) {
          scoreMap.set(r.id, { vectorScore: r.vectorScore, bm25Score: r.keywordScore })
        }
      }

      // Fill missing items with local embeddings (not yet indexed in main process)
      const missingItems = items.filter((item) => !scoreMap.has(item.id))
      if (missingItems.length) {
        const missingPairs = await Promise.all(missingItems.map(async (item) => {
          const embedding = await embedMemorySearchText(item.content, embeddingModel)
          return [item.id, cosineSimilarity(queryEmbedding, embedding)] as const
        }))
        for (const [id, score] of missingPairs) {
          scoreMap.set(id, { vectorScore: score, bm25Score: 0 })
        }
      }

      return scoreMap
    } catch (error) {
      console.warn('[Memory] Hybrid search failed, falling back to vector-only:', error)
    }
  }

  // Fallback: vector-only via main process or local computation
  if (window.desktopPet?.memoryVectorSearch) {
    try {
      const results = await window.desktopPet.memoryVectorSearch({
        queryEmbedding,
        limit: items.length,
        threshold: 0,
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
        const missingPairs = await Promise.all(missingItems.map(async (item) => {
          const embedding = await embedMemorySearchText(item.content, embeddingModel)
          return [item.id, cosineSimilarity(queryEmbedding, embedding)] as const
        }))
        for (const [id, score] of missingPairs) {
          scoreMap.set(id, { vectorScore: score, bm25Score: 0 })
        }
      }

      return scoreMap
    } catch (error) {
      console.warn('[Memory] Vector search failed, falling back to per-item embeddings:', error)
    }
  }

  const pairs = await Promise.all(items.map(async (item) => {
    const embedding = await embedMemorySearchText(item.content, embeddingModel)
    return [item.id, cosineSimilarity(queryEmbedding, embedding)] as const
  }))

  return new Map(pairs.map(([id, score]) => [id, { vectorScore: score, bm25Score: 0 }]))
}

function buildSemanticMatches(
  longTerm: Array<ScoredItem<MemoryItem>>,
  daily: Array<ScoredItem<DailyMemoryEntry>>,
  limit: number,
) {
  const combined: MemorySemanticMatch[] = [
    ...longTerm.map(({ item, vectorScore }) => ({
      id: item.id,
      layer: 'long_term' as const,
      content: item.content,
      score: vectorScore,
    })),
    ...daily.map(({ item, vectorScore }) => ({
      id: item.id,
      layer: 'daily' as const,
      content: item.content,
      score: vectorScore,
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
  const keywordLongTerm = rankMemories(longTermMemories, query)
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

  const longTermCandidates = searchMode === 'vector'
    ? longTermMemories
    : keywordLongTerm.slice(0, Math.max(longTermLimit * 3, 12))
  const dailyCandidates = searchMode === 'vector'
    ? recentDaily
    : uniqueById([
        ...keywordDaily.slice(0, Math.max(dailyLimit * 3, 12)),
        ...recentDaily.slice(0, 6),
      ])

  try {
    const scoreMap = await buildScoreMap(
      [...longTermCandidates, ...dailyCandidates],
      query,
      embeddingModel,
    )

    const scoredLongTerm = sortScoredItems(longTermCandidates, query, searchMode, scoreMap, emotionContext)
    const scoredDaily = sortScoredItems(dailyCandidates, query, searchMode, scoreMap, emotionContext)

    void indexMemoriesToVectorStore(longTermCandidates, embeddingModel, 'long_term')
    void indexMemoriesToVectorStore(dailyCandidates, embeddingModel, 'daily')

    const selectedLongTerm = scoredLongTerm.slice(0, longTermLimit).map(({ item }) => item)
    updatePrimingFromSelection(selectedLongTerm)
    return {
      longTerm: selectedLongTerm,
      daily: uniqueById([
        ...scoredDaily.slice(0, dailyLimit).map(({ item }) => item),
        ...recentDaily.slice(0, 2),
      ]).slice(0, dailyLimit),
      semantic: buildSemanticMatches(scoredLongTerm, scoredDaily, semanticLimit),
      searchModeUsed: searchMode,
      vectorSearchAvailable: true,
      recalledLongTermIds: selectedLongTerm.map((m) => m.id),
    }
  } catch (error) {
    console.warn('[Memory] Score map build failed, falling back to keyword-only:', error)
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
