import type { ChatRole } from './chat.ts'

export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'goal'
  | 'habit'
  | 'manual'
  | 'feedback'
  | 'project'
  | 'reference'

export type MemoryImportance = 'low' | 'normal' | 'high' | 'pinned' | 'reflection'

/** Long-term memory record shape written by the v2 reconciler. */
export const MEMORY_RECORD_SCHEMA_VERSION = 2

export type MemoryStatus = 'active' | 'superseded' | 'archived'

export type MemoryReconcileOpName = 'ADD' | 'UPDATE' | 'MERGE' | 'SUPERSEDE' | 'DELETE' | 'NOOP' | 'UNDO'

/** A short quote from the message that justified a write. */
export interface MemoryEvidence {
  messageId?: string
  day: string
  quote: string
  at: string
}

export type MemoryOpActor = 'turn' | 'dream' | 'user' | 'migration' | 'cap'

/** Append-only record of a reconcile or cap decision. Content stays on the memory row. */
export interface MemoryOpRecord {
  id: string
  at: string
  actor: MemoryOpActor
  op: MemoryReconcileOpName
  targetIds: string[]
  reason?: string
  /** Quote copied from the source message. Required for mutating ops. */
  evidenceQuote?: string
  /** Id of the message the quote came from. */
  messageRef?: string
  /** Daily-run id, so one tap can undo the whole pass. */
  runId?: string
  /** Rows as they were before this op. Undo restores them. */
  before?: MemoryItem[]
}

export type MemoryKind = 'preference' | 'fact' | 'relationship' | 'knowledge' | 'open_loop'

/** User-facing lifecycle for a commitment or event. Snooze is a deferral, not a status. */
export type LoopStatus = 'open' | 'done' | 'dismissed'

/**
 * A commitment is something the user said they would do. An event is
 * something happening to them on a date, such as an interview or a trip.
 * Absent on legacy rows, which are treated as commitments.
 */
export type LoopKind = 'commitment' | 'event'

export type EmotionalValence = 'positive' | 'negative' | 'neutral' | 'mixed'

export interface MemoryItem {
  id: string
  content: string
  category: MemoryCategory
  source: string
  kind?: MemoryKind
  enabled?: boolean
  sourceRef?: string
  /** 2 once the row has been through the v2 normalizer. Absent on legacy rows. */
  schemaVersion?: number
  /**
   * Lifecycle. Absent means active so pre-v2 rows stay readable.
   * Superseded and archived rows stay in the store with a reason instead of
   * being removed.
   */
  status?: MemoryStatus
  createdAt: string
  updatedAt?: string
  lastUsedAt?: string
  /** Why status moved off active. */
  statusReason?: string
  /** Ids folded into this row by MERGE. */
  mergedFrom?: string[]
  /** User-authored or explicitly confirmed. Cap eviction will not drop these. */
  userConfirmed?: boolean
  importance?: MemoryImportance
  /** Continuous importance score (0–1+). Decays daily, boosted on recall. */
  importanceScore?: number
  /** How many times this memory has been recalled into prompt context. */
  recallCount?: number
  /** ISO timestamp of the most recent recall. */
  lastRecalledAt?: string
  /**
   * ISO timestamp up to which time decay has already been persisted into
   * importanceScore. Absent on legacy data — fall back to createdAt.
   */
  decayedAt?: string
  /** IDs of semantically related memories (cross-session linking). */
  relatedIds?: string[]
  /** Emotion snapshot at creation time — enables emotion-aware recall. */
  emotionSnapshot?: { energy: number; warmth: number; curiosity: number; concern: number }
  /** Dominant emotional valence when this memory was formed. */
  emotionalValence?: EmotionalValence
  /**
   * Emotional-significance score computed from emotionSnapshot at write
   * time (0–1). Multiplied into recall ranking so moments formed under
   * extreme valence or high arousal resurface more readily — borrowed
   * from Lumen's NPC-significance pattern. Does NOT feed back into decay,
   * so pinned/high importance tiers keep their separate semantics.
   */
  significance?: number
  /**
   * Only set on `importance === 'reflection'` entries. A short topic
   * slug used to dedup — a newly generated reflection on the same topic
   * supersedes the previous one rather than accumulating variants.
   */
  reflectionTopic?: string
  /** Confidence 0–1 asserted by the generator. */
  reflectionConfidence?: number
  /**
   * Contradiction detection (Memory Integrity): id of a newer memory that
   * supersedes this one — set on the OLD memory when a contradiction is
   * judged likely. Recall ranking applies a penalty so superseded
   * memories surface less often (or not at all once confirmed).
   */
  supersededBy?: string
  /** ISO timestamp when `supersededBy` was written. */
  supersededAt?: string
  /**
   * True when the supersession is low-confidence (`possible` judgement)
   * and receives a milder recall penalty than a confirmed supersession.
   * Kept on the record for debugging; no user interaction is required —
   * both tiers are fully automatic (v0.4.6 decision: no confirmation UI).
   */
  supersededPending?: boolean
  /**
   * Only for kind `open_loop`. Absent on older rows, which are not loops.
   * `done` and `dismissed` stay in the store so a later pass does not
   * recreate the same commitment and nag again.
   */
  loopStatus?: LoopStatus
  /** Commitment or event. Absent on older rows, which are commitments. */
  loopKind?: LoopKind
  /** ISO time the commitment or event is due. Absent when no time was named. */
  loopDueAt?: string
  /** The time phrase as the user said it, kept for the memory view. */
  loopDueText?: string
  /** ISO time until which proactive delivery must skip this loop. */
  loopSnoozeUntil?: string
  /** How many times this loop was handed to a proactive channel. */
  loopSurfacedCount?: number
  /** ISO time of the last proactive handoff. */
  loopLastSurfacedAt?: string
  /** Set once the overdue "did it get done?" ask has been sent. */
  loopCheckAskedAt?: string
  /** Place the user named, such as a hall or office. */
  loopPlace?: string
  /** Reminder booked for a clear plan, or when the user accepts an ask. */
  loopReminderTaskId?: string
  /**
   * Groups a commitment with later details. "办护照" and a follow-up
   * about the same errand share one key.
   */
  slotKey?: string
  /** Up to five quotes, newest first. */
  evidence?: MemoryEvidence[]
  /** The user pinned this row. Automatic passes leave it alone. */
  pinned?: boolean
  /** The user edited the wording. Automatic passes leave it alone. */
  userEdited?: boolean
  /**
   * True for rows that arrived through migration. They stay in the store
   * and are never handed to a proactive channel.
   */
  migrated?: boolean
}

export interface DailyMemoryEntry {
  id: string
  day: string
  role: Exclude<ChatRole, 'system'>
  content: string
  source: 'chat' | 'voice'
  createdAt: string
}

export type DailyMemoryStore = Record<string, DailyMemoryEntry[]>

/**
 * One short dream she wrote down after a quiet night.
 *
 * This is her own artifact, not a memory about the user: `text` is imagery,
 * `sourceMemoryIds` only records which memories coloured it so the row can be
 * audited without turning the dream into a factual claim.
 */
export interface DreamDiaryEntry {
  id: string
  /** Local night key (YYYY-MM-DD). At most one entry exists per night. */
  night: string
  /** Local calendar day the row is dated to; equals `night` for new rows. */
  day: string
  createdAt: string
  text: string
  /** Up to two memory ids used as loose thematic material. */
  sourceMemoryIds?: string[]
  /** ISO timestamp the one-line morning mention landed; null when never. */
  surfacedAt?: string | null
}

export type MemorySearchMode = 'keyword' | 'hybrid' | 'vector'

export interface MemorySemanticMatch {
  id: string
  layer: 'long_term' | 'daily'
  content: string
  score: number
}

export interface MemoryRecallContext {
  longTerm: MemoryItem[]
  daily: DailyMemoryEntry[]
  semantic: MemorySemanticMatch[]
  searchModeUsed: MemorySearchMode
  vectorSearchAvailable: boolean
  /** IDs of long-term memories that were selected for prompt injection (for recall feedback). */
  recalledLongTermIds?: string[]
  /**
   * How sure recall is that a stored memory is about the query (embedding
   * models with calibrated thresholds only). 'none' means long-term recall
   * was suppressed; 'low' means the memories may not fit.
   */
  recallConfidence?: 'high' | 'low' | 'none'
}

// ── Semantic Clustering ───────────────────────────────────────────────────

export interface MemoryCluster {
  id: string
  label: string
  memberIds: string[]
  centroidContent: string
  createdAt: string
  updatedAt: string
}

// ── Memory Archive ────────────────────────────────────────────────────────

export interface ArchivedMemory {
  id: string
  content: string
  category: MemoryCategory
  source: string
  createdAt: string
  archivedAt: string
  finalScore: number
  importance?: MemoryImportance
  clusterId?: string
}
