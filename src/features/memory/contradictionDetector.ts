/**
 * Contradiction detection — Memory Integrity (v0.4.6).
 *
 * A memory store drifts toward contradiction over time: "I prefer dark
 * roast" then "coffee keeps me up, I switched to tea". Both sit in
 * long-term memory and both get recalled, leaving the companion
 * self-contradicting in conversation.
 *
 * This module detects *new-vs-existing* contradictions so the newer
 * memory can supersede the older one. Design decisions:
 *
 *   - Pure and injectable: similarity comes in as a function so tests
 *     can drive exact scores without an embedding runtime.
 *   - Conservative by default: only `likely` judgements (high similarity
 *     + opposite emotional valence) auto-supersede; `possible`
 *     judgements are recorded as pending and await user confirmation in
 *     the memory panel (v0.4.6 P1). Nothing is ever deleted.
 *   - New-side only: pairs are (newMemory, existingMemory). Existing
 *     memories already superseded are skipped; memories already linked
 *     via relatedIds (same cluster / merge lineage) are skipped.
 */

import type { MemoryItem, EmotionalValence } from '../../types'

export type ContradictionJudgement = 'likely' | 'possible' | 'none'

export interface ContradictionCandidate {
  /** Newer memory — the one that should win. */
  newMemory: MemoryItem
  /** Older memory — the one that would be superseded. */
  existingMemory: MemoryItem
  /** Semantic similarity score provided by the caller (0–1+). */
  similarity: number
}

export interface ContradictionResolution {
  newId: string
  existingId: string
  judgement: Exclude<ContradictionJudgement, 'none'>
  /** Defaults to the caller's clock when not provided. */
  resolvedAt?: string
}

/** High-similarity + opposite-valence threshold for an auto-supersede. */
export const LIKELY_SIMILARITY_THRESHOLD = 0.85
/** Similarity threshold for a low-confidence (pending) supersession. */
export const POSSIBLE_SIMILARITY_THRESHOLD = 0.8
/** Recall penalty applied to confirmed superseded memories (likely). */
export const SUPERSEDED_RECALL_PENALTY = 0.3
/** Milder recall penalty for low-confidence (possible) supersessions. */
export const PENDING_SUPERSEDED_RECALL_PENALTY = 0.6
/** Hard cap on candidates returned per run (bounds LLM/embedding cost). */
export const MAX_CONTRADICTION_CANDIDATES = 20
/** Keyword pre-filter size: per-new-memory, top-N existing by lexical score. */
export const CONTRADICTION_KEYWORD_PREFILTER = 8

const OPPOSITE_VALENCES: ReadonlyArray<readonly [EmotionalValence, EmotionalValence]> = [
  ['positive', 'negative'],
  ['negative', 'positive'],
]

function valencesAreOpposite(left: EmotionalValence | undefined, right: EmotionalValence | undefined): boolean {
  if (!left || !right) return false
  return OPPOSITE_VALENCES.some(([a, b]) => a === left && b === right)
}

export type MemorySimilarityFn = (left: MemoryItem, right: MemoryItem) => number

/**
 * Rank new-vs-existing pairs by similarity, filtered to pairs that could
 * plausibly contradict:
 *
 *   - existing memories already superseded are skipped (one supersession
 *     per memory — the newest winner stays the winner);
 *   - pairs already linked through relatedIds (same merge lineage /
 *     semantic cluster) are skipped — those are relatives, not rivals;
 *   - the pair's own id equality is skipped.
 *
 * Returns at most `MAX_CONTRADICTION_CANDIDATES` pairs, highest
 * similarity first. The caller decides what to do with each pair via
 * `judgeContradictionPair` — ranking here is purely about likelihood of
 * *relatedness*, not contradiction.
 */
export function rankContradictionCandidates(
  newMemories: ReadonlyArray<MemoryItem>,
  existingMemories: ReadonlyArray<MemoryItem>,
  similarityFn: MemorySimilarityFn,
  maxCandidates: number = MAX_CONTRADICTION_CANDIDATES,
): ContradictionCandidate[] {
  const candidates: ContradictionCandidate[] = []

  for (const newMemory of newMemories) {
    if (!newMemory.id || !newMemory.content) continue
    for (const existingMemory of existingMemories) {
      if (existingMemory.id === newMemory.id) continue
      if (existingMemory.supersededBy) continue
      if (areLinked(newMemory, existingMemory)) continue
      const similarity = similarityFn(newMemory, existingMemory)
      if (!Number.isFinite(similarity) || similarity <= 0) continue
      candidates.push({ newMemory, existingMemory, similarity })
    }
  }

  candidates.sort((left, right) => right.similarity - left.similarity)
  return candidates.slice(0, maxCandidates)
}

function areLinked(left: MemoryItem, right: MemoryItem): boolean {
  const leftLinks = left.relatedIds ?? []
  const rightLinks = right.relatedIds ?? []
  return leftLinks.includes(right.id) || rightLinks.includes(left.id)
}

/**
 * Classify one candidate pair:
 *
 *   - `likely`  — similarity ≥ 0.85 AND opposite emotional valence
 *     (e.g. "I love running" vs "running ruined my knees"). The polarity
 *     flip is the signal that the newer memory *replaces* the older
 *     stance rather than merely resembling it.
 *   - `possible` — similarity ≥ 0.8 without the polarity flip (or with
 *     unknown valence). Recorded but pending user confirmation.
 *   - `none`    — below the similarity floor.
 */
export function judgeContradictionPair(
  newMemory: MemoryItem,
  existingMemory: MemoryItem,
  similarity: number,
): ContradictionJudgement {
  if (!Number.isFinite(similarity)) return 'none'
  if (similarity >= LIKELY_SIMILARITY_THRESHOLD
    && valencesAreOpposite(newMemory.emotionalValence, existingMemory.emotionalValence)) {
    return 'likely'
  }
  if (similarity >= POSSIBLE_SIMILARITY_THRESHOLD) {
    return 'possible'
  }
  return 'none'
}

/**
 * Apply resolutions to a memory list immutably. Returns a new array with
 * the superseded markers written onto the OLD memories.
 *
 * Idempotence rules:
 *   - an existing memory that already has a confirmed supersession
 *     (`supersededBy` without `supersededPending`) is never overwritten;
 *   - re-applying the same resolution produces the same output;
 *   - a pending marker may be upgraded to confirmed by a later `likely`
 *     resolution (same or different new memory).
 */
export function applyContradictionResolutions(
  memories: ReadonlyArray<MemoryItem>,
  resolutions: ReadonlyArray<ContradictionResolution>,
  nowIso: string,
): MemoryItem[] {
  if (resolutions.length === 0) return [...memories]

  const latestByExisting = new Map<string, ContradictionResolution>()
  for (const resolution of resolutions) {
    const existing = latestByExisting.get(resolution.existingId)
    if (!existing || resolution.judgement === 'likely' && existing.judgement === 'possible') {
      latestByExisting.set(resolution.existingId, resolution)
    }
  }

  return memories.map((memory) => {
    const resolution = latestByExisting.get(memory.id)
    if (!resolution) return memory
    if (memory.supersededBy && !memory.supersededPending) return memory
    return {
      ...memory,
      supersededBy: resolution.newId,
      supersededAt: resolution.resolvedAt ?? nowIso,
      supersededPending: resolution.judgement === 'possible' ? true : undefined,
    }
  })
}

/**
 * Recall penalty multiplier for a memory, fully automatic:
 *
 *   - confirmed supersession (`likely`) → 0.3 (newer stance wins)
 *   - pending supersession (`possible`) → 0.6 (mild, guards against
 *     false positives — no user confirmation UI)
 *   - otherwise → 1 (no penalty)
 */
export function getSupersededRecallPenalty(memory: MemoryItem): number {
  if (!memory.supersededBy) return 1
  return memory.supersededPending === true
    ? PENDING_SUPERSEDED_RECALL_PENALTY
    : SUPERSEDED_RECALL_PENALTY
}

// ── Async orchestration (dream integration) ────────────────────────────

/**
 * Injectable dependencies so the orchestration is testable without an
 * embedding runtime and the dream hook can wire the real ones in.
 */
export type ContradictionDetectorDeps = {
  /** Embed one text (cached by the caller if it wishes). */
  embedText: (text: string) => Promise<number[]>
  /** Cosine similarity between two embeddings. */
  cosine: (left: number[], right: number[]) => number
  /** Keyword ranking used to pre-filter existing memories per new one. */
  keywordRank: (memories: MemoryItem[], query: string) => MemoryItem[]
  /** How many existing memories are embedded per new memory (default 8). */
  prefilterPerNew?: number
  /** Cap on returned candidates (default 20). */
  maxCandidates?: number
}

/**
 * Full detection pipeline for a dream run:
 *
 *   1. embed each new memory once;
 *   2. keyword-rank existing memories per new memory and embed only the
 *      top `prefilterPerNew` (bounds embedding cost — long-term stores
 *      can hold hundreds of items);
 *   3. rank candidate pairs by similarity (`rankContradictionCandidates`);
 *   4. classify each pair (`judgeContradictionPair`);
 *   5. drop `none` judgements.
 *
 * Resolutions carry no timestamp — the caller supplies `nowIso` when
 * applying, keeping this function pure with respect to the clock.
 */
export async function detectContradictions(
  newMemories: ReadonlyArray<MemoryItem>,
  existingMemories: ReadonlyArray<MemoryItem>,
  deps: ContradictionDetectorDeps,
): Promise<Array<Omit<ContradictionResolution, 'resolvedAt'>>> {
  const prefilterPerNew = deps.prefilterPerNew ?? CONTRADICTION_KEYWORD_PREFILTER
  const maxCandidates = deps.maxCandidates ?? MAX_CONTRADICTION_CANDIDATES

  // Pre-compute embeddings: new memories once each; existing memories
  // only the keyword top-N per new memory. Similarity lookups then stay
  // synchronous inside rankContradictionCandidates.
  const newEmbeddings = new Map<string, number[]>()
  const existingEmbeddings = new Map<string, number[]>()
  const similarityByPair = new Map<string, number>()
  const pairKey = (newId: string, existingId: string) => `${newId}::${existingId}`

  for (const newMemory of newMemories) {
    if (!newMemory.id || !newMemory.content) continue
    const newEmbedding = await deps.embedText(newMemory.content)
    if (!newEmbedding.length) continue
    newEmbeddings.set(newMemory.id, newEmbedding)

    const topExisting = deps.keywordRank([...existingMemories], newMemory.content).slice(0, prefilterPerNew)
    for (const existing of topExisting) {
      if (existing.id === newMemory.id) continue
      if (existingEmbeddings.has(existing.id)) {
        similarityByPair.set(
          pairKey(newMemory.id, existing.id),
          deps.cosine(newEmbedding, existingEmbeddings.get(existing.id)!),
        )
        continue
      }
      const existingEmbedding = await deps.embedText(existing.content)
      if (!existingEmbedding.length) continue
      existingEmbeddings.set(existing.id, existingEmbedding)
      similarityByPair.set(pairKey(newMemory.id, existing.id), deps.cosine(newEmbedding, existingEmbedding))
    }
  }

  const candidates = rankContradictionCandidates(
    newMemories,
    existingMemories,
    (newMemory, existingMemory) => similarityByPair.get(pairKey(newMemory.id, existingMemory.id)) ?? 0,
    maxCandidates,
  )

  return candidates
    .map((candidate) => ({
      newId: candidate.newMemory.id,
      existingId: candidate.existingMemory.id,
      judgement: judgeContradictionPair(candidate.newMemory, candidate.existingMemory, candidate.similarity),
    }))
    .filter((resolution): resolution is { newId: string; existingId: string; judgement: 'likely' | 'possible' } =>
      resolution.judgement !== 'none')
}
