import type { VoiceBusEvent } from './busEvents.ts'
import type { VoicePhase } from './session/voiceSessionTypes.ts'
import type { VoiceReasonCode } from './voiceReasonCodes.ts'
import type {
  VoiceLatencyBreakdown,
  VoiceSessionTimeline,
  VoiceTransitionRecord,
} from './voiceTransitionTypes.ts'

const DEFAULT_MAX_ENTRIES = 200
const DEFAULT_TIMELINE_LIMIT = 16

/**
 * Phase 1-1 observability: ring-buffer recorder wired to the VoiceBus.
 *
 * The log does not participate in state decisions. Its only job is to make
 * scattered voice-pipeline transitions visible so Phase 2 can refactor with
 * a real before/after diff to validate against.
 */
export type RecordInput = {
  event: VoiceBusEvent
  prevPhase: VoicePhase
  nextPhase: VoicePhase
  /** Override timestamp for tests; defaults to Date.now(). */
  timestamp?: number
}

export type VoiceTransitionLogOptions = {
  maxEntries?: number
  /** Bound on how many distinct sessions we track timelines for. */
  maxTimelines?: number
  /** Injected clock for deterministic tests. */
  now?: () => number
}

export class VoiceTransitionLog {
  private readonly maxEntries: number
  private readonly maxTimelines: number
  private readonly now: () => number
  private readonly entries: VoiceTransitionRecord[] = []
  private readonly timelines = new Map<string, VoiceSessionTimeline>()
  private seqCounter = 0

  constructor(options: VoiceTransitionLogOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxTimelines = options.maxTimelines ?? DEFAULT_TIMELINE_LIMIT
    this.now = options.now ?? (() => Date.now())
  }

  record(input: RecordInput): VoiceTransitionRecord {
    const ts = input.timestamp ?? this.now()
    const sessionId = resolveSessionId(input.event)
    const provider = resolveProvider(input.event)
    const reason = resolveReason(input.event)
    const meta = resolveMeta(input.event)

    const latencyMs = sessionId
      ? this.updateTimeline(sessionId, input.event, ts)
      : null

    const record: VoiceTransitionRecord = {
      seq: ++this.seqCounter,
      ts,
      eventType: input.event.type,
      prevPhase: input.prevPhase,
      nextPhase: input.nextPhase,
      reason,
      sessionId,
      provider,
      latencyMs,
      meta,
    }

    this.entries.push(record)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
    return record
  }

  getEntries(): readonly VoiceTransitionRecord[] {
    return this.entries
  }

  getTimeline(sessionId: string): VoiceSessionTimeline | null {
    return this.timelines.get(sessionId) ?? null
  }

  getLatencyBreakdown(sessionId: string): VoiceLatencyBreakdown {
    const timeline = this.timelines.get(sessionId)
    if (!timeline) {
      return {
        wakeToMicMs: null,
        speechEndToSttFinalMs: null,
        sttFinalToFirstAudioMs: null,
      }
    }
    return computeLatencyBreakdown(timeline)
  }

  clear(): void {
    this.entries.length = 0
    this.timelines.clear()
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2)
  }

  exportNdjson(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join('\n')
  }

  private updateTimeline(
    sessionId: string,
    event: VoiceBusEvent,
    ts: number,
  ): number | null {
    const timeline = this.touchTimeline(sessionId)

    switch (event.type) {
      case 'wake:detected':
        timeline.wakeDetectedAt = ts
        return null
      case 'mic:acquired': {
        timeline.micAcquiredAt = ts
        if (timeline.wakeDetectedAt != null) {
          return ts - timeline.wakeDetectedAt
        }
        return null
      }
      case 'vad:speech_start':
        timeline.speechStartAt = ts
        return null
      case 'vad:speech_end':
        timeline.speechEndAt = ts
        return null
      case 'stt:final': {
        timeline.sttFinalAt = ts
        if (timeline.speechEndAt != null) {
          return ts - timeline.speechEndAt
        }
        return null
      }
      case 'tts:first_audio': {
        if (timeline.firstAudioAt == null) {
          timeline.firstAudioAt = ts
          if (timeline.sttFinalAt != null) {
            return ts - timeline.sttFinalAt
          }
        }
        return null
      }
      case 'session:completed':
      case 'session:aborted':
        // Keep the timeline around for one more record so exportJson() sees
        // its final latency — but drop it from tracking so new sessions that
        // reuse the id don't inherit stale stamps.
        this.timelines.delete(sessionId)
        return null
      default:
        return null
    }
  }

  private touchTimeline(sessionId: string): VoiceSessionTimeline {
    const existing = this.timelines.get(sessionId)
    if (existing) return existing

    if (this.timelines.size >= this.maxTimelines) {
      const oldestKey = this.timelines.keys().next().value
      if (oldestKey != null) this.timelines.delete(oldestKey)
    }

    const timeline: VoiceSessionTimeline = {
      sessionId,
      wakeDetectedAt: null,
      micAcquiredAt: null,
      speechStartAt: null,
      speechEndAt: null,
      sttFinalAt: null,
      firstAudioAt: null,
    }
    this.timelines.set(sessionId, timeline)
    return timeline
  }
}

function resolveSessionId(event: VoiceBusEvent): string | null {
  if ('sessionId' in event && typeof event.sessionId === 'string') {
    return event.sessionId
  }
  return null
}

function resolveProvider(event: VoiceBusEvent): string | null {
  if ('provider' in event && typeof event.provider === 'string') {
    return event.provider
  }
  return null
}

function resolveReason(event: VoiceBusEvent): VoiceReasonCode | null {
  if ('reason' in event && typeof event.reason === 'string') {
    return event.reason as VoiceReasonCode
  }
  return null
}

function resolveMeta(event: VoiceBusEvent): Record<string, unknown> | null {
  if ('meta' in event && event.meta && typeof event.meta === 'object') {
    return event.meta as Record<string, unknown>
  }
  return null
}

function computeLatencyBreakdown(
  timeline: VoiceSessionTimeline,
): VoiceLatencyBreakdown {
  return {
    wakeToMicMs:
      timeline.wakeDetectedAt != null && timeline.micAcquiredAt != null
        ? timeline.micAcquiredAt - timeline.wakeDetectedAt
        : null,
    speechEndToSttFinalMs:
      timeline.speechEndAt != null && timeline.sttFinalAt != null
        ? timeline.sttFinalAt - timeline.speechEndAt
        : null,
    sttFinalToFirstAudioMs:
      timeline.sttFinalAt != null && timeline.firstAudioAt != null
        ? timeline.firstAudioAt - timeline.sttFinalAt
        : null,
  }
}

// ── Process-global singleton used by useVoice ────────────────────────────

let globalLog: VoiceTransitionLog | null = null

export function getGlobalVoiceTransitionLog(): VoiceTransitionLog {
  if (!globalLog) globalLog = new VoiceTransitionLog()
  return globalLog
}

declare global {
  interface Window {
    __voiceLog?: () => readonly VoiceTransitionRecord[]
    __voiceLogExport?: () => string
    __voiceLogClear?: () => void
  }
}

export function installVoiceLogDevHooks(): void {
  if (typeof window === 'undefined') return
  const log = getGlobalVoiceTransitionLog()
  window.__voiceLog = () => log.getEntries()
  window.__voiceLogExport = () => log.exportNdjson()
  window.__voiceLogClear = () => log.clear()
}
