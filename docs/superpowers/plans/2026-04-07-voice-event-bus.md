# Voice Event Bus Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered callback chains, timer-based polling, and ref-gated voice restart with a centralized event bus that routes all voice events through a single coordinator.

**Architecture:** Introduce a `VoiceBus` singleton that all voice subsystems (STT providers, TTS playback, transcript handling, continuous restart) publish to and subscribe from. The bus owns the canonical voice state and a priority-aware intent queue. Existing code becomes thin adapters that emit events instead of directly calling callbacks. No external dependencies — the bus is a plain TypeScript EventEmitter-style class (~200 lines).

**Tech Stack:** TypeScript, React 19 hooks, existing Nexus voice infrastructure. No new npm packages.

---

## Current Problem

The voice pipeline chains functions via closures: `onEnd() → scheduleVoiceRestart() → setTimeout(60ms) → check 6 refs → startVoiceConversation()`. Any ref being stale, any timer being cleared, any condition checked at the wrong moment silently kills the chain. There is no observability: when voice doesn't restart, nothing logs why.

## Target State

```
STT provider  ──emit──▶ VoiceBus ──notify──▶ Transcript handler
TTS controller ──emit──▶ VoiceBus ──notify──▶ Restart coordinator
User action   ──emit──▶ VoiceBus ──notify──▶ State machine
                           │
                     ┌─────┴─────┐
                     │ Canonical  │
                     │   State    │
                     │ + Intent Q │
                     └───────────┘
```

All voice events flow through the bus. The bus:
1. Maintains canonical `VoicePhase` (idle/listening/transcribing/speaking)
2. Runs an intent queue with `queue`/`interrupt` behaviors
3. Decides when to restart STT after TTS completes — no timers, no ref polling
4. Logs every event transition for debugging

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/features/voice/bus.ts` | VoiceBus class — event emitter, state machine, intent queue |
| **Create:** `src/features/voice/busEvents.ts` | Event type definitions and payload interfaces |
| **Create:** `src/features/voice/busReducer.ts` | Pure reducer: (state, event) → state + side-effect descriptors |
| **Modify:** `src/hooks/useVoice.ts` | Create bus instance, wire subscriptions, expose bus-driven state |
| **Modify:** `src/hooks/voice/speechReply.ts` | Emit `tts:started`/`tts:completed`/`tts:error` instead of direct callbacks |
| **Modify:** `src/hooks/voice/streamingSpeechOutput.ts` | Emit events via bus in `settleSuccess`/`fail` |
| **Modify:** `src/hooks/voice/continuousVoice.ts` | Replace `scheduleVoiceRestart` with bus subscription to `tts:completed` |
| **Modify:** `src/hooks/voice/transcriptHandling.ts` | Emit `transcript:recognized`/`transcript:ignored` events |
| **Modify:** `src/hooks/voice/conversationEntrypoints.ts` | Emit `session:starting`/`session:started` events |
| **Modify:** `src/hooks/voice/runtimeSupport.ts` | Thin wrapper: dispatch to bus instead of session machine directly |
| **Modify:** `src/hooks/chat/assistantReply.ts` | Use bus events instead of direct `setVoiceState`/`scheduleVoiceRestart` calls |
| **Modify:** `src/hooks/useChat.ts` | Use bus events instead of direct `setVoiceState` calls |
| **Keep unchanged:** `src/features/voice/sessionMachine.ts` | Still used internally by bus reducer for phase transitions |
| **Create:** `tests/features/voice/bus.test.ts` | Unit tests for bus reducer and event routing |
| **Create:** `tests/features/voice/busReducer.test.ts` | Pure function tests for the reducer |

---

### Task 1: Define Event Types

**Files:**
- Create: `src/features/voice/busEvents.ts`

- [ ] **Step 1: Create the event type definitions**

```typescript
// src/features/voice/busEvents.ts

// ── Session lifecycle ─────────────────────────────────────────────────────
export type SessionStartedEvent = {
  type: 'session:started'
  sessionId: string
  transport: string
}

export type SessionCompletedEvent = {
  type: 'session:completed'
}

export type SessionAbortedEvent = {
  type: 'session:aborted'
  reason?: string
}

// ── STT events ────────────────────────────────────────────────────────────
export type SttSpeechDetectedEvent = {
  type: 'stt:speech_detected'
}

export type SttPartialEvent = {
  type: 'stt:partial'
  text: string
}

export type SttEndpointEvent = {
  type: 'stt:endpoint'
  text: string
}

export type SttFinalizingEvent = {
  type: 'stt:finalizing'
  text?: string
}

export type SttFinalEvent = {
  type: 'stt:final'
  text: string
}

export type SttErrorEvent = {
  type: 'stt:error'
  code: string
  message: string
}

// ── TTS events ────────────────────────────────────────────────────────────
export type TtsStartedEvent = {
  type: 'tts:started'
  text: string
  speechGeneration: number
}

export type TtsCompletedEvent = {
  type: 'tts:completed'
  speechGeneration: number
  /** Whether voice input should restart after this TTS finishes. */
  shouldResumeContinuousVoice: boolean
}

export type TtsInterruptedEvent = {
  type: 'tts:interrupted'
  speechGeneration: number
}

export type TtsErrorEvent = {
  type: 'tts:error'
  message: string
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
}

// ── Transcript decisions ──────────────────────────────────────────────────
export type TranscriptRecognizedEvent = {
  type: 'transcript:recognized'
  text: string
  decision: 'direct_send' | 'manual_confirm' | 'hold_incomplete' | 'wake_word_only'
}

export type TranscriptBlockedEvent = {
  type: 'transcript:blocked'
  text: string
  reason: string
}

// ── Control events ────────────────────────────────────────────────────────
export type VoiceRestartRequestedEvent = {
  type: 'voice:restart_requested'
  reason: string
  force: boolean
}

export type VoiceStopRequestedEvent = {
  type: 'voice:stop_requested'
}

export type ChatBusyChangedEvent = {
  type: 'chat:busy_changed'
  busy: boolean
}

// ── Union ─────────────────────────────────────────────────────────────────
export type VoiceBusEvent =
  | SessionStartedEvent
  | SessionCompletedEvent
  | SessionAbortedEvent
  | SttSpeechDetectedEvent
  | SttPartialEvent
  | SttEndpointEvent
  | SttFinalizingEvent
  | SttFinalEvent
  | SttErrorEvent
  | TtsStartedEvent
  | TtsCompletedEvent
  | TtsInterruptedEvent
  | TtsErrorEvent
  | TranscriptRecognizedEvent
  | TranscriptBlockedEvent
  | VoiceRestartRequestedEvent
  | VoiceStopRequestedEvent
  | ChatBusyChangedEvent

export type VoiceBusEventType = VoiceBusEvent['type']
```

- [ ] **Step 2: Commit**

```bash
git add src/features/voice/busEvents.ts
git commit -m "feat(voice): define VoiceBus event types"
```

---

### Task 2: Build the Bus Reducer (Pure Logic)

**Files:**
- Create: `src/features/voice/busReducer.ts`
- Create: `tests/features/voice/busReducer.test.ts`

- [ ] **Step 1: Write failing tests for the reducer**

```typescript
// tests/features/voice/busReducer.test.ts
import { describe, it, expect } from 'vitest'
import { reduceVoiceBus, createInitialBusState } from '../../src/features/voice/busReducer'

describe('reduceVoiceBus', () => {
  it('transitions to listening on session:started', () => {
    const state = createInitialBusState()
    const result = reduceVoiceBus(state, {
      type: 'session:started',
      sessionId: 'test-1',
      transport: 'sherpa',
    })
    expect(result.state.phase).toBe('listening')
    expect(result.state.sessionId).toBe('test-1')
    expect(result.effects).toEqual([])
  })

  it('transitions to speaking on tts:started', () => {
    const state = { ...createInitialBusState(), phase: 'transcribing' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:started',
      text: 'hello',
      speechGeneration: 1,
    })
    expect(result.state.phase).toBe('speaking')
  })

  it('emits restart_voice effect on tts:completed when shouldResume is true', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toContainEqual({ type: 'restart_voice', delay: 60 })
  })

  it('does NOT emit restart_voice when shouldResume is false', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: false,
    })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toEqual([{ type: 'set_mood', mood: 'idle' }])
  })

  it('transitions to idle on session:aborted', () => {
    const state = { ...createInitialBusState(), phase: 'listening' as const }
    const result = reduceVoiceBus(state, { type: 'session:aborted', reason: 'user' })
    expect(result.state.phase).toBe('idle')
  })

  it('emits restart_voice on tts:error when shouldResume', () => {
    const state = { ...createInitialBusState(), phase: 'speaking' as const }
    const result = reduceVoiceBus(state, {
      type: 'tts:error',
      message: 'network',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toContainEqual({ type: 'restart_voice', delay: 200 })
  })

  it('ignores events that are no-ops for current phase', () => {
    const state = createInitialBusState() // phase: idle
    const result = reduceVoiceBus(state, { type: 'stt:partial', text: 'hello' })
    expect(result.state.phase).toBe('idle')
    expect(result.effects).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix F:/Nexus vitest run tests/features/voice/busReducer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the reducer**

```typescript
// src/features/voice/busReducer.ts
import type { VoiceBusEvent } from './busEvents'
import type { PetMood } from '../../types'

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'speaking'

export type VoiceBusState = {
  phase: VoicePhase
  sessionId: string | null
  transport: string | null
  lastError: string | null
}

export type BusEffect =
  | { type: 'restart_voice'; delay: number }
  | { type: 'set_mood'; mood: PetMood }
  | { type: 'show_status'; message: string; duration: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; data?: Record<string, unknown> }

export type ReducerResult = {
  state: VoiceBusState
  effects: BusEffect[]
}

export function createInitialBusState(): VoiceBusState {
  return {
    phase: 'idle',
    sessionId: null,
    transport: null,
    lastError: null,
  }
}

export function reduceVoiceBus(
  current: VoiceBusState,
  event: VoiceBusEvent,
): ReducerResult {
  const effects: BusEffect[] = []

  switch (event.type) {
    // ── Session lifecycle ──────────────────────────────────────────────
    case 'session:started':
      return {
        state: {
          phase: 'listening',
          sessionId: event.sessionId,
          transport: event.transport,
          lastError: null,
        },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:completed':
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'session:aborted':
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects: [],
      }

    // ── STT events ─────────────────────────────────────────────────────
    case 'stt:speech_detected':
      return { state: current, effects: [] }

    case 'stt:partial':
    case 'stt:endpoint':
      return { state: current, effects: [] }

    case 'stt:finalizing':
      if (current.phase !== 'listening') return { state: current, effects: [] }
      return {
        state: { ...current, phase: 'transcribing' },
        effects: [],
      }

    case 'stt:final':
      return {
        state: { ...current, phase: 'transcribing' },
        effects: [],
      }

    case 'stt:error':
      return {
        state: { ...current, phase: 'idle', lastError: event.message },
        effects: [
          { type: 'set_mood', mood: 'idle' },
          { type: 'log', level: 'error', message: `STT error: ${event.code} — ${event.message}` },
        ],
      }

    // ── TTS events ─────────────────────────────────────────────────────
    case 'tts:started':
      return {
        state: { ...current, phase: 'speaking' },
        effects: [{ type: 'set_mood', mood: 'happy' }],
      }

    case 'tts:completed': {
      effects.push({ type: 'set_mood', mood: 'idle' })
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 60 })
      }
      return {
        state: { ...current, phase: 'idle', lastError: null },
        effects,
      }
    }

    case 'tts:interrupted':
      return {
        state: { ...current, phase: 'idle' },
        effects: [],
      }

    case 'tts:error': {
      effects.push(
        { type: 'set_mood', mood: 'idle' },
        { type: 'log', level: 'error', message: `TTS error: ${event.message}` },
      )
      if (event.shouldResumeContinuousVoice) {
        effects.push({ type: 'restart_voice', delay: 200 })
      }
      return {
        state: { ...current, phase: 'idle', lastError: event.message },
        effects,
      }
    }

    // ── Transcript ─────────────────────────────────────────────────────
    case 'transcript:recognized':
    case 'transcript:blocked':
      return { state: current, effects: [] }

    // ── Control ────────────────────────────────────────────────────────
    case 'voice:restart_requested':
      // The bus itself doesn't change state — the effect executor handles the actual restart.
      effects.push({ type: 'restart_voice', delay: 60 })
      return { state: current, effects }

    case 'voice:stop_requested':
      return {
        state: { ...current, phase: 'idle' },
        effects: [{ type: 'set_mood', mood: 'idle' }],
      }

    case 'chat:busy_changed':
      // Informational — the restart executor reads busy state from the bus.
      return { state: current, effects: [] }

    default:
      return { state: current, effects: [] }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix F:/Nexus vitest run tests/features/voice/busReducer.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/voice/busReducer.ts tests/features/voice/busReducer.test.ts
git commit -m "feat(voice): implement VoiceBus pure reducer with tests"
```

---

### Task 3: Build the VoiceBus Class

**Files:**
- Create: `src/features/voice/bus.ts`
- Create: `tests/features/voice/bus.test.ts`

- [ ] **Step 1: Write failing tests for the bus**

```typescript
// tests/features/voice/bus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { VoiceBus } from '../../src/features/voice/bus'

describe('VoiceBus', () => {
  it('emits events to subscribers', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    bus.on('tts:completed', handler)
    bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('updates phase after event', () => {
    const bus = new VoiceBus()
    expect(bus.phase).toBe('idle')
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    expect(bus.phase).toBe('listening')
  })

  it('returns effects from emit', () => {
    const bus = new VoiceBus()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'tts:started', text: 'hi', speechGeneration: 1 })
    const effects = bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: true,
    })
    expect(effects).toContainEqual({ type: 'restart_voice', delay: 60 })
  })

  it('supports wildcard subscribers via onAny', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    bus.onAny(handler)
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'hello' })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes correctly', () => {
    const bus = new VoiceBus()
    const handler = vi.fn()
    const unsub = bus.on('tts:completed', handler)
    unsub()
    bus.emit({
      type: 'tts:completed',
      speechGeneration: 1,
      shouldResumeContinuousVoice: false,
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('logs every event to history', () => {
    const bus = new VoiceBus()
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'hi' })
    expect(bus.history.length).toBe(2)
    expect(bus.history[0].event.type).toBe('session:started')
    expect(bus.history[1].event.type).toBe('stt:partial')
  })

  it('caps history at maxHistoryLength', () => {
    const bus = new VoiceBus({ maxHistoryLength: 3 })
    bus.emit({ type: 'session:started', sessionId: 's1', transport: 'sherpa' })
    bus.emit({ type: 'stt:partial', text: 'a' })
    bus.emit({ type: 'stt:partial', text: 'b' })
    bus.emit({ type: 'stt:partial', text: 'c' })
    expect(bus.history.length).toBe(3)
    expect(bus.history[0].event.type).toBe('stt:partial')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx --prefix F:/Nexus vitest run tests/features/voice/bus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the VoiceBus**

```typescript
// src/features/voice/bus.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --prefix F:/Nexus vitest run tests/features/voice/bus.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/voice/bus.ts tests/features/voice/bus.test.ts
git commit -m "feat(voice): implement VoiceBus event emitter with history"
```

---

### Task 4: Wire VoiceBus into useVoice Hook

**Files:**
- Modify: `src/hooks/useVoice.ts`

This is the integration point. The bus becomes the single source of truth for voice phase. External code still calls the same functions (`startVoiceConversation`, `scheduleVoiceRestart`, etc.) but internally they route through the bus.

- [ ] **Step 1: Create bus instance and effect executor in useVoice**

At the top of the `useVoice` function (after existing state declarations), add:

```typescript
// src/hooks/useVoice.ts — add after line ~155 (after voiceStateRef declaration)
import { VoiceBus } from '../features/voice/bus'
import type { BusEffect } from '../features/voice/busReducer'

// Inside useVoice():

const voiceBusRef = useRef<VoiceBus | null>(null)
if (!voiceBusRef.current) {
  voiceBusRef.current = new VoiceBus()
}
const voiceBus = voiceBusRef.current

// Effect executor — translates BusEffect descriptors into real side effects
function executeBusEffects(effects: BusEffect[]) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'restart_voice':
        // Use a minimal setTimeout; the bus already decided we should restart.
        // No ref polling needed — the bus state is canonical.
        window.setTimeout(() => {
          if (voiceBus.phase !== 'idle') return // guard: something else started
          try {
            startVoiceConversation({ restart: true, passive: true })
          } catch (err) {
            console.warn('[VoiceBus] restart failed:', err)
            ctx.updatePetStatus('语音重启失败，请手动重试。', 4_000)
          }
        }, effect.delay)
        break
      case 'set_mood':
        ctx.setMood(effect.mood)
        break
      case 'show_status':
        ctx.updatePetStatus(effect.message, effect.duration)
        break
      case 'log':
        console[effect.level](`[VoiceBus]`, effect.message, effect.data ?? '')
        break
    }
  }
}

// Sync bus phase → React state (one-way: bus is source of truth)
useEffect(() => {
  const unsub = voiceBus.onAny(() => {
    const busPhase = voiceBus.phase
    const voiceState =
      busPhase === 'listening' ? 'listening'
        : busPhase === 'transcribing' ? 'processing'
          : busPhase === 'speaking' ? 'speaking'
            : 'idle'
    setVoiceState(voiceState)
  })
  return unsub
}, []) // eslint-disable-line react-hooks/exhaustive-deps

// Clean up on unmount
useEffect(() => {
  return () => voiceBus.destroy()
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Add a `busEmit` helper that emits + executes effects**

```typescript
// Inside useVoice(), after executeBusEffects:
function busEmit(event: import('../features/voice/busEvents').VoiceBusEvent) {
  const effects = voiceBus.emit(event)
  executeBusEffects(effects)
}
```

- [ ] **Step 3: Expose bus on the return value for cross-hook access**

In the return object of `useVoice` (around line 1505+), add:

```typescript
    // Event bus
    voiceBus,
    busEmit,
```

- [ ] **Step 4: Type-check**

Run: `npx --prefix F:/Nexus tsc --project F:/Nexus/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useVoice.ts
git commit -m "feat(voice): wire VoiceBus into useVoice with effect executor"
```

---

### Task 5: Migrate TTS Callbacks to Bus Events

**Files:**
- Modify: `src/hooks/voice/speechReply.ts`
- Modify: `src/hooks/voice/streamingSpeechOutput.ts`

This replaces the `onStart → dispatchVoiceSessionAndSync` → `onEnd → scheduleVoiceRestart` callback chain with bus events.

- [ ] **Step 1: Add `busEmit` to speech reply options**

In `src/hooks/voice/speechReply.ts`, add `busEmit` to `BaseSpeechReplyOptions`:

```typescript
// Add to BaseSpeechReplyOptions type:
  busEmit: (event: import('../../features/voice/busEvents').VoiceBusEvent) => void
```

- [ ] **Step 2: Replace callback chain with bus events in createSpeechReplyCallbacks**

Replace the `onStart`, `onEnd`, `onError` implementations inside `createSpeechReplyCallbacks`:

```typescript
    onStart: () => {
      options.busEmit({
        type: 'tts:started',
        text: options.text,
        speechGeneration: options.speechGeneration,
      })
      // Keep legacy dispatch for session machine (will be removed in later cleanup)
      options.dispatchVoiceSessionAndSync({ type: 'tts_started', text: options.text })
    },
    onEnd: () => {
      options.stopSpeechInterruptMonitor()
      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.usesBrowserSpeechOutput,
        options.isSpeechInterrupted,
        options.clearSpeechInterruptedFlag,
      )) {
        return
      }
      options.busEmit({
        type: 'tts:completed',
        speechGeneration: options.speechGeneration,
        shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
      })
      // Keep legacy dispatch for session machine
      options.dispatchVoiceSessionAndSync({ type: 'session_completed' })
    },
    onError: (message: string) => {
      options.stopSpeechInterruptMonitor()
      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.usesBrowserSpeechOutput,
        options.isSpeechInterrupted,
        options.clearSpeechInterruptedFlag,
      )) {
        return
      }
      options.busEmit({
        type: 'tts:error',
        message,
        speechGeneration: options.speechGeneration,
        shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
      })
      // Keep legacy dispatch
      options.dispatchVoiceSessionAndSync({ type: 'error', code: 'tts', message })
      options.setError(message)
    },
```

Note: we keep the legacy `dispatchVoiceSessionAndSync` calls during migration. They will be removed once all consumers read from the bus.

- [ ] **Step 3: Remove direct `scheduleVoiceRestart` and `setMood` calls from onEnd/onError**

The bus reducer now produces `restart_voice` and `set_mood` effects, so the explicit `options.scheduleVoiceRestart(...)` and `options.setMood('idle')` calls in `onEnd`/`onError` are no longer needed. They were replaced in Step 2 by `busEmit`.

- [ ] **Step 4: Pass `busEmit` through from useVoice.ts**

In `useVoice.ts`, wherever `beginStreamingSpeechReplyRuntime` or `speakAssistantReplyRuntime` is called, add `busEmit` to the options:

```typescript
// In beginStreamingSpeechReply():
  return beginStreamingSpeechReplyRuntime({
    // ... existing options ...
    busEmit,
  })

// In speakAssistantReply():
  await speakAssistantReplyRuntime({
    // ... existing options ...
    busEmit,
  })
```

- [ ] **Step 5: Type-check**

Run: `npx --prefix F:/Nexus tsc --project F:/Nexus/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/hooks/voice/speechReply.ts src/hooks/useVoice.ts
git commit -m "feat(voice): migrate TTS callbacks to VoiceBus events"
```

---

### Task 6: Migrate assistantReply.ts and useChat.ts Away from Direct State Manipulation

**Files:**
- Modify: `src/hooks/chat/assistantReply.ts`
- Modify: `src/hooks/useChat.ts`
- Modify: `src/hooks/chat/types.ts`

These files currently call `setVoiceState('idle')` and `scheduleVoiceRestart(...)` directly. They should emit bus events instead and let the bus decide state transitions.

- [ ] **Step 1: Add `busEmit` to chat voice context type**

In `src/hooks/chat/types.ts`, add to the voice context interface:

```typescript
  busEmit: (event: import('../../features/voice/busEvents').VoiceBusEvent) => void
```

- [ ] **Step 2: Replace direct setVoiceState calls in assistantReply.ts**

Replace the three `dependencies.ctx.setVoiceState('idle')` calls at lines 423, 443, 477 and the `scheduleVoiceRestart` calls with `busEmit`:

```typescript
// Line 422-425 (TTS timeout case):
if (ttsWaitTimedOut && shouldResumeContinuousVoice) {
  dependencies.ctx.busEmit({
    type: 'tts:completed',
    speechGeneration: 0,
    shouldResumeContinuousVoice: true,
  })
}

// Line 442-447 (no TTS, no speech output case):
dependencies.ctx.busEmit({ type: 'session:completed' })
// The bus reducer handles setting mood to idle

// Line 476-484 (error handler):
dependencies.ctx.busEmit({ type: 'session:aborted', reason: errorMessage })
if (shouldResumeContinuousVoice) {
  dependencies.ctx.busEmit({
    type: 'voice:restart_requested',
    reason: 'error_recovery',
    force: true,
  })
}
```

- [ ] **Step 3: Replace direct setVoiceState in useChat.ts**

Replace the `ctx.setVoiceState('processing')` at line 535 with a bus event:

```typescript
// Line 535: instead of ctx.setVoiceState('processing')
// The bus doesn't need this — the STT finalizing event already transitions to transcribing.
// Just emit chat:busy_changed for observability:
ctx.busEmit({ type: 'chat:busy_changed', busy: true })
```

And in the handleSpeechPlaybackFailure callback (around line 292):

```typescript
// Replace ctx.setVoiceState('idle') + ctx.scheduleVoiceRestart(...)
ctx.busEmit({
  type: 'tts:error',
  message: speechErrorMessage,
  speechGeneration: 0,
  shouldResumeContinuousVoice: options.shouldResumeContinuousVoice ?? false,
})
```

- [ ] **Step 4: Type-check**

Run: `npx --prefix F:/Nexus tsc --project F:/Nexus/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/chat/assistantReply.ts src/hooks/useChat.ts src/hooks/chat/types.ts
git commit -m "refactor(voice): migrate chat hooks to VoiceBus events"
```

---

### Task 7: Remove Legacy scheduleVoiceRestart Timer Machinery

**Files:**
- Modify: `src/hooks/voice/continuousVoice.ts`
- Modify: `src/hooks/useVoice.ts`

Now that the bus reducer emits `restart_voice` effects and the effect executor in `useVoice.ts` handles them with a simple `setTimeout` + bus phase guard, the complex `scheduleVoiceRestart` with ref polling, retry counters, and recursive rescheduling is no longer needed for the bus-driven path.

- [ ] **Step 1: Mark `scheduleVoiceRestart` as legacy**

Add a deprecation comment at the top of the function in `continuousVoice.ts`:

```typescript
/**
 * @deprecated Use VoiceBus `tts:completed` event instead.
 * Kept temporarily for code paths not yet migrated to the bus.
 * Will be removed once all callers use busEmit.
 */
export function scheduleVoiceRestart(options: ScheduleVoiceRestartOptions) {
```

- [ ] **Step 2: Verify the bus-driven restart works by checking the effect executor**

The effect executor in `useVoice.ts` (from Task 4) handles `restart_voice`:

```typescript
case 'restart_voice':
  window.setTimeout(() => {
    if (voiceBus.phase !== 'idle') return
    try {
      startVoiceConversation({ restart: true, passive: true })
    } catch (err) { ... }
  }, effect.delay)
  break
```

This is simpler: one setTimeout, one phase check, no ref polling, no retry loop. If the phase isn't idle when the timer fires, the restart is skipped (the user did something else). No silent infinite loops.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/voice/continuousVoice.ts
git commit -m "refactor(voice): deprecate scheduleVoiceRestart in favor of VoiceBus"
```

---

### Task 8: Final Type-Check and Build Verification

**Files:**
- All modified files

- [ ] **Step 1: Run type checker**

Run: `npx --prefix F:/Nexus tsc --project F:/Nexus/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 2: Run Vite build**

Run: `npx --prefix F:/Nexus vite build --config F:/Nexus/vite.config.ts`
Expected: Build succeeds

- [ ] **Step 3: Run tests**

Run: `npx --prefix F:/Nexus vitest run`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(voice): VoiceBus event-driven voice pipeline — complete migration"
```

---

## Migration Strategy

This plan uses a **dual-write** approach during migration:
1. New code emits bus events AND calls legacy `dispatchVoiceSessionAndSync`
2. Both the bus and the old session machine update in parallel
3. The bus-driven `restart_voice` effect replaces `scheduleVoiceRestart` for TTS→STT restart
4. Legacy code paths that aren't yet migrated (wake word, individual STT providers) continue using the old callbacks

**After this plan is complete**, the following cleanup can be done incrementally:
- Remove legacy `dispatchVoiceSessionAndSync` calls from `speechReply.ts` once all consumers read from bus
- Remove `scheduleVoiceRestart` once all callers use `busEmit`
- Migrate individual STT providers to emit bus events instead of calling `handleVoiceListeningFailure` directly
- Remove `voiceSessionRef` and `sessionMachine.ts` once the bus reducer fully replaces them
