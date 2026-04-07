import type { VoiceBusEvent, VoiceBusEventType } from './busEvents'
import { type BusEffect, type VoiceBusState, type VoicePhase, createInitialBusState, reduceVoiceBus } from './busReducer'

export type VoiceBusHistoryEntry = {
  event: VoiceBusEvent
  prevPhase: VoicePhase
  nextPhase: VoicePhase
  effects: BusEffect[]
  timestamp: number
}

export type VoiceBusOptions = {
  maxHistoryLength?: number
}

type Handler = (event: VoiceBusEvent) => void

export class VoiceBus {
  private state: VoiceBusState
  private readonly listeners = new Map<VoiceBusEventType, Set<Handler>>()
  private readonly wildcardListeners = new Set<Handler>()
  private readonly _history: VoiceBusHistoryEntry[] = []
  private readonly maxHistoryLength: number

  constructor(options?: VoiceBusOptions) {
    this.state = createInitialBusState()
    this.maxHistoryLength = options?.maxHistoryLength ?? 50
  }

  get phase(): VoicePhase {
    return this.state.phase
  }

  get sessionId(): string | null {
    return this.state.sessionId
  }

  get lastError(): string | null {
    return this.state.lastError
  }

  get history(): readonly VoiceBusHistoryEntry[] {
    return this._history
  }

  /**
   * Emit an event: reduce state, record history, notify subscribers, return effects.
   * Effects are descriptors — the caller (useVoice) executes them.
   */
  emit(event: VoiceBusEvent): BusEffect[] {
    const prevPhase = this.state.phase
    const { state: nextState, effects } = reduceVoiceBus(this.state, event)
    this.state = nextState

    // Record
    this._history.push({
      event,
      prevPhase,
      nextPhase: nextState.phase,
      effects,
      timestamp: Date.now(),
    })
    if (this._history.length > this.maxHistoryLength) {
      this._history.splice(0, this._history.length - this.maxHistoryLength)
    }

    // Log phase transitions
    if (prevPhase !== nextState.phase) {
      console.log(`[VoiceBus] ${prevPhase} → ${nextState.phase}  (${event.type})`)
    }

    // Notify type-specific listeners
    const handlers = this.listeners.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event) } catch (err) {
          console.error(`[VoiceBus] handler error for ${event.type}:`, err)
        }
      }
    }

    // Notify wildcard listeners
    for (const handler of this.wildcardListeners) {
      try { handler(event) } catch (err) {
        console.error('[VoiceBus] wildcard handler error:', err)
      }
    }

    return effects
  }

  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on(type: VoiceBusEventType, handler: Handler): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler)
    return () => { set!.delete(handler) }
  }

  /** Subscribe to all events. Returns unsubscribe function. */
  onAny(handler: Handler): () => void {
    this.wildcardListeners.add(handler)
    return () => { this.wildcardListeners.delete(handler) }
  }

  /** Reset to initial state (e.g., on unmount). */
  reset() {
    this.state = createInitialBusState()
    this._history.length = 0
  }

  /** Destroy all subscriptions. */
  destroy() {
    this.listeners.clear()
    this.wildcardListeners.clear()
    this._history.length = 0
  }
}
