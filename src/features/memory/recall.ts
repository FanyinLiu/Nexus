import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
  MemoryRecallContext,
  MemorySearchMode,
  MemorySemanticMatch,
} from '../../types'
import {
  getRecentDailyEntries,
  rankDailyEntries,
  rankMemories,
  scoreLexicalSimilarity,
} from './memory'
import { cosineSimilarity, embedMemorySearchText } from './vectorSearch'

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
  const ageMs = Math.max(0, Date.now() - Date.parse(createdAt))
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

function scoreItem<T extends { content: string; createdAt: string; category?: string }>(
  item: T,
  query: string,
  mode: MemorySearchMode,
  vectorScore: number,
) {
  const keywordScore = scoreLexicalSimilarity(item.content, query)
  const recencyBoost = getRecencyBoost(item.createdAt)
  const categoryBoost = CATEGORY_WEIGHT[item.category ?? ''] ?? 0

  if (mode === 'vector') {
    return {
      keywordScore,
      vectorScore,
      finalScore: vectorScore + recencyBoost + categoryBoost,
    }
  }

  return {
    keywordScore,
    vectorScore,
    finalScore: keywordScore * 0.55 + vectorScore * 0.45 + recencyBoost + categoryBoost,
  }
}

function sortScoredItems<T extends { id: string; createdAt: string; content: string }>(
  items: T[],
  query: string,
  mode: MemorySearchMode,
  vectorScoreMap: Map<string, number>,
) {
  return items
    .map((item) => {
      const { keywordScore, vectorScore, finalScore } = scoreItem(
        item,
        query,
        mode,
        vectorScoreMap.get(item.id) ?? 0,
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

      return Date.parse(right.item.createdAt) - Date.parse(left.item.createdAt)
    })
}

async function indexMemoriesToVectorStore<T extends { id: string; content: string }>(
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

async function buildVectorScoreMap<T extends { id: string; content: string }>(
  items: T[],
  query: string,
  embeddingModel: string,
) {
  const queryEmbedding = await embedMemorySearchText(query, embeddingModel)
  if (!queryEmbedding.length) {
    return new Map<string, number>()
  }

  if (window.desktopPet?.memoryVectorSearch) {
    try {
      const results = await window.desktopPet.memoryVectorSearch({
        queryEmbedding,
        limit: items.length,
        threshold: 0,
      })

      const itemIds = new Set(items.map((item) => item.id))
      const scoreMap = new Map<string, number>()
      for (const result of results) {
        if (itemIds.has(result.id)) {
          scoreMap.set(result.id, result.score)
        }
      }

      const missingItems = items.filter((item) => !scoreMap.has(item.id))
      if (missingItems.length) {
        const missingPairs = await Promise.all(missingItems.map(async (item) => {
          const embedding = await embedMemorySearchText(item.content, embeddingModel)
          return [item.id, cosineSimilarity(queryEmbedding, embedding)] as const
        }))
        for (const [id, score] of missingPairs) {
          scoreMap.set(id, score)
        }
      }

      return scoreMap
    } catch {
      // fall back to per-item embeddings below
    }
  }

  const pairs = await Promise.all(items.map(async (item) => {
    const embedding = await embedMemorySearchText(item.content, embeddingModel)
    return [item.id, cosineSimilarity(queryEmbedding, embedding)] as const
  }))

  return new Map(pairs)
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
}: BuildMemoryRecallContextParams): Promise<MemoryRecallContext> {
  const keywordLongTerm = rankMemories(longTermMemories, query)
  const recentDaily = getRecentDailyEntries(dailyMemories, retentionDays).slice(0, 24)
  const keywordDaily = rankDailyEntries(recentDaily, query)

  const keywordDailyResult = uniqueById([
    ...keywordDaily.slice(0, dailyLimit),
    ...recentDaily.slice(0, 2),
  ]).slice(0, dailyLimit)

  if (searchMode === 'keyword') {
    return {
      longTerm: keywordLongTerm.slice(0, longTermLimit),
      daily: keywordDailyResult,
      semantic: [],
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
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
    const vectorScoreMap = await buildVectorScoreMap(
      [...longTermCandidates, ...dailyCandidates],
      query,
      embeddingModel,
    )

    const scoredLongTerm = sortScoredItems(longTermCandidates, query, searchMode, vectorScoreMap)
    const scoredDaily = sortScoredItems(dailyCandidates, query, searchMode, vectorScoreMap)

    void indexMemoriesToVectorStore(longTermCandidates, embeddingModel, 'long_term')
    void indexMemoriesToVectorStore(dailyCandidates, embeddingModel, 'daily')

    return {
      longTerm: scoredLongTerm.slice(0, longTermLimit).map(({ item }) => item),
      daily: uniqueById([
        ...scoredDaily.slice(0, dailyLimit).map(({ item }) => item),
        ...recentDaily.slice(0, 2),
      ]).slice(0, dailyLimit),
      semantic: buildSemanticMatches(scoredLongTerm, scoredDaily, semanticLimit),
      searchModeUsed: searchMode,
      vectorSearchAvailable: true,
    }
  } catch {
    return {
      longTerm: keywordLongTerm.slice(0, longTermLimit),
      daily: keywordDailyResult,
      semantic: [],
      searchModeUsed: 'keyword',
      vectorSearchAvailable: false,
    }
  }
}
