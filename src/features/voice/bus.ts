import type { VoiceBusEvent, VoiceBusEventType } from './busEvents'
import { voiceDebug } from './voiceDebugLog'
import {
  createInitialVoiceSessionState,
  reduceVoiceSession,
} from './session/voiceSessionMachine.ts'
import {
  toBusPhase,
  toUiPhase,
  type VoicePhase,
  type VoiceSessionEffect,
  type VoiceSessionMachineState,
  type VoiceSessionStateName,
} from './session/voiceSessionTypes.ts'
import type { VoiceState } from '../../types'

/**
 * Phase 2-2 rewire: `VoiceBus` now wraps the unified session machine
 * (`reduceVoiceSession`) instead of the legacy `reduceVoiceBus`. The external
 * API — `phase`, `emit`, subscription helpers — is preserved so callers in
 * useVoice / voiceTransitionLog don't need to change. The richer 13-state
 * machine is folded down to the legacy 4-phase surface via `toBusPhase` so
 * existing listeners keep seeing the same `VoicePhase` values.
 */

// Re-export the effect type under the legacy name so existing importers keep
// compiling. The shape is identical — this is purely a migration alias.
export type BusEffect = VoiceSessionEffect

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
type TransitionHandler = (
  event: VoiceBusEvent,
  prevPhase: VoicePhase,
  nextPhase: VoicePhase,
) => void

export class VoiceBus {
  private state: VoiceSessionMachineState
  private readonly listeners = new Map<VoiceBusEventType, Set<Handler>>()
  private readonly wildcardListeners = new Set<Handler>()
  private readonly transitionListeners = new Set<TransitionHandler>()
  private readonly _history: VoiceBusHistoryEntry[] = []
  private readonly maxHistoryLength: number

  constructor(options?: VoiceBusOptions) {
    this.state = createInitialVoiceSessionState()
    this.maxHistoryLength = options?.maxHistoryLength ?? 50
  }

  get phase(): VoicePhase {
    return toBusPhase(this.state.state)
  }

  /**
   * UI-layer phase (`VoiceState`). Derived directly from the internal 13-state
   * machine via `toUiPhase`, so call sites that render "what is the pet doing
   * right now" don't have to go through the legacy `VoicePhase` indirection.
   * Phase 2-3 replaces the `voiceStateForBusPhase` helper in useVoice with this
   * getter — one less moving part, one less place the mapping can drift.
   */
  get uiPhase(): VoiceState {
    return toUiPhase(this.state.state)
  }

  /** Raw 13-state machine state. Exposed for Phase 2-3+ internal consumers. */
  get internalState(): VoiceSessionStateName {
    return this.state.state
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
    const prevPhase = toBusPhase(this.state.state)
    const { state: nextState, effects } = reduceVoiceSession(this.state, event)
    this.state = nextState
    const nextPhase = toBusPhase(nextState.state)

    // Record
    this._history.push({
      event,
      prevPhase,
      nextPhase,
      effects,
      timestamp: Date.now(),
    })
    if (this._history.length > this.maxHistoryLength) {
      this._history.splice(0, this._history.length - this.maxHistoryLength)
    }

    // Log phase transitions (dev only; compiled out in production).
    if (prevPhase !== nextPhase) {
      voiceDebug('VoiceBus', `${prevPhase} → ${nextPhase}  (${event.type})`)
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

    // Notify transition listeners with before/after phase context
    for (const handler of this.transitionListeners) {
      try { handler(event, prevPhase, nextPhase) } catch (err) {
        console.error('[VoiceBus] transition handler error:', err)
      }
    }

    return effects
  }

  /** Subscribe with access to before/after phase. Returns unsubscribe function. */
  onTransition(handler: TransitionHandler): () => void {
    this.transitionListeners.add(handler)
    return () => { this.transitionListeners.delete(handler) }
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
    this.state = createInitialVoiceSessionState()
    this._history.length = 0
  }

  /** Destroy all subscriptions. */
  destroy() {
    this.listeners.clear()
    this.wildcardListeners.clear()
    this.transitionListeners.clear()
    this._history.length = 0
  }
}
