import type {
  EvaluationScore,
  HarnessArtifact,
  HarnessDomain,
  HarnessMemory,
  RoundMemoryEntry,
} from './types.ts'

const STORAGE_KEY_PREFIX = 'nexus:harness-memory:'

export function createHarnessMemory<T>(maxRetention: number): HarnessMemory<T> {
  return { entries: [], maxRetention }
}

export function appendToMemory<T>(
  memory: HarnessMemory<T>,
  artifact: HarnessArtifact<T>,
  score: EvaluationScore,
): HarnessMemory<T> {
  const entry: RoundMemoryEntry<T> = {
    round: artifact.round,
    artifact,
    score,
    timestamp: Date.now(),
  }

  const entries = [...memory.entries, entry]
  const trimmed = entries.length > memory.maxRetention
    ? entries.slice(-memory.maxRetention)
    : entries

  return { ...memory, entries: trimmed }
}

export function bestEntry<T>(
  memory: HarnessMemory<T>,
): RoundMemoryEntry<T> | undefined {
  if (memory.entries.length === 0) {
    return undefined
  }

  let best = memory.entries[0]
  for (let i = 1; i < memory.entries.length; i += 1) {
    if (memory.entries[i].score.overall > best.score.overall) {
      best = memory.entries[i]
    }
  }
  return best
}

export function scoreHistory<T>(memory: HarnessMemory<T>): EvaluationScore[] {
  return memory.entries.map((e) => e.score)
}

type PersistedEntry = {
  round: number
  score: number
  candidateId: string
  timestamp: number
}

type PersistedMemory = {
  entries: PersistedEntry[]
}

function storageKey(domain: HarnessDomain): string {
  return STORAGE_KEY_PREFIX + domain
}

/** Persist a lightweight summary (scores + candidate IDs) to localStorage. */
export function persistHarnessSummary<T>(
  domain: HarnessDomain,
  memory: HarnessMemory<T>,
  maxEntries = 50,
): void {
  const data: PersistedMemory = {
    entries: memory.entries.slice(-maxEntries).map((e) => ({
      round: e.round,
      score: e.score.overall,
      candidateId: e.artifact.candidateId,
      timestamp: e.timestamp,
    })),
  }

  try {
    window.localStorage.setItem(storageKey(domain), JSON.stringify(data))
  } catch {
    // Storage full or unavailable.
  }
}

export function loadPersistedSummary(
  domain: HarnessDomain,
): PersistedEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(domain))
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as PersistedMemory | null
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

export function clearPersistedSummary(domain: HarnessDomain): void {
  try {
    window.localStorage.removeItem(storageKey(domain))
  } catch {
    // Storage unavailable.
  }
}
