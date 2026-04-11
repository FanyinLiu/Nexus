import type { ParaformerStreamSession } from './localParaformer'
import type { SenseVoiceStreamSession } from './localSenseVoice'
import type { TencentAsrStreamSession } from './tencentAsr'
import type { WakewordRuntimeController } from './wakewordRuntime'
import type { VoiceActivityDetector } from './browserVad'

// ── Types ─────────────────────────────────────────────────────────────────

export type HearingEngineId =
  | 'sensevoice'
  | 'paraformer'
  | 'tencent-asr'
  | 'api-recording'
  | 'vad'
  | 'none'

export type HearingPhase = 'idle' | 'listening' | 'transcribing'

export type HearingRuntimeSnapshot = {
  phase: HearingPhase
  engine: HearingEngineId
  vadActive: boolean
  wakewordListening: boolean
  speechLevel: number
  updatedAt: number
}

// ── Runtime ───────────────────────────────────────────────────────────────

type Listener = () => void

/**
 * Centralised observable store for the hearing (input) subsystem.
 *
 * Holds references to whichever STT engine, VAD detector, and wakeword
 * controller are currently active.  UI layers can subscribe to snapshot
 * changes without reaching into individual React refs.
 *
 * The store is intentionally **mutable** — callers set/clear sessions as
 * conversations start and stop.  Each mutation bumps `updatedAt` and
 * notifies subscribers so that `useSyncExternalStore` consumers re-render.
 */
export class HearingRuntime {
  // ── Phase / engine ────────────────────────────────────────────────────
  private _phase: HearingPhase = 'idle'
  private _engine: HearingEngineId = 'none'

  // ── STT sessions (at most one active at a time) ───────────────────────
  private _sensevoiceSession: SenseVoiceStreamSession | null = null
  private _paraformerSession: ParaformerStreamSession | null = null
  private _tencentAsrSession: TencentAsrStreamSession | null = null

  // ── VAD ───────────────────────────────────────────────────────────────
  private _vadDetector: VoiceActivityDetector | null = null
  private _vadActive = false

  // ── Wakeword ──────────────────────────────────────────────────────────
  private _wakewordController: WakewordRuntimeController | null = null
  private _wakewordListening = false

  // ── Speech level ──────────────────────────────────────────────────────
  private _speechLevel = 0

  // ── Observable plumbing ───────────────────────────────────────────────
  private _updatedAt = Date.now()
  private _snapshot: HearingRuntimeSnapshot | null = null
  private readonly _listeners = new Set<Listener>()

  // ── Getters ───────────────────────────────────────────────────────────

  get phase() { return this._phase }
  get engine() { return this._engine }
  get vadActive() { return this._vadActive }
  get wakewordListening() { return this._wakewordListening }
  get speechLevel() { return this._speechLevel }

  get sensevoiceSession() { return this._sensevoiceSession }
  get paraformerSession() { return this._paraformerSession }
  get tencentAsrSession() { return this._tencentAsrSession }
  get vadDetector() { return this._vadDetector }
  get wakewordController() { return this._wakewordController }

  // ── Snapshot (stable reference for useSyncExternalStore) ──────────────

  getSnapshot(): HearingRuntimeSnapshot {
    if (!this._snapshot || this._snapshot.updatedAt !== this._updatedAt) {
      this._snapshot = {
        phase: this._phase,
        engine: this._engine,
        vadActive: this._vadActive,
        wakewordListening: this._wakewordListening,
        speechLevel: this._speechLevel,
        updatedAt: this._updatedAt,
      }
    }
    return this._snapshot
  }

  // ── Subscribe / notify ────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  private notify() {
    this._updatedAt = Date.now()
    this._snapshot = null
    for (const listener of this._listeners) {
      try { listener() } catch { /* subscriber errors must not break the runtime */ }
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────

  setPhase(phase: HearingPhase) {
    if (this._phase === phase) return
    this._phase = phase
    this.notify()
  }

  /** Activate a specific STT engine. Clears any previously active engine. */
  activateEngine(engine: HearingEngineId) {
    if (this._engine === engine) return
    this._engine = engine
    this.notify()
  }

  clearEngine() {
    if (this._engine === 'none' && this._phase === 'idle') return
    this._engine = 'none'
    this._phase = 'idle'
    this.notify()
  }

  setSensevoiceSession(session: SenseVoiceStreamSession | null) {
    this._sensevoiceSession = session
    this.activateEngine(session ? 'sensevoice' : this._engine === 'sensevoice' ? 'none' : this._engine)
  }

  setParaformerSession(session: ParaformerStreamSession | null) {
    this._paraformerSession = session
    this.activateEngine(session ? 'paraformer' : this._engine === 'paraformer' ? 'none' : this._engine)
  }

  setTencentAsrSession(session: TencentAsrStreamSession | null) {
    this._tencentAsrSession = session
    this.activateEngine(session ? 'tencent-asr' : this._engine === 'tencent-asr' ? 'none' : this._engine)
  }

  setVadDetector(detector: VoiceActivityDetector | null) {
    this._vadDetector = detector
    const wasActive = this._vadActive
    this._vadActive = detector !== null
    if (wasActive !== this._vadActive) this.notify()
  }

  setWakewordController(controller: WakewordRuntimeController | null) {
    this._wakewordController = controller
  }

  setWakewordListening(listening: boolean) {
    if (this._wakewordListening === listening) return
    this._wakewordListening = listening
    this.notify()
  }

  setSpeechLevel(level: number) {
    // Speech level changes at ~60 Hz — only notify on visually meaningful deltas.
    const clamped = Math.max(0, Math.min(1, level))
    if (Math.abs(this._speechLevel - clamped) < 0.015) return
    this._speechLevel = clamped
    this.notify()
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Hard-stop everything this runtime holds references to. */
  dispose() {
    this._sensevoiceSession?.abort()
    this._sensevoiceSession = null
    this._paraformerSession?.abort()
    this._paraformerSession = null
    this._tencentAsrSession = null
    this._vadDetector?.destroy().catch(() => undefined)
    this._vadDetector = null
    this._wakewordController?.destroy()
    this._wakewordController = null
    this._phase = 'idle'
    this._engine = 'none'
    this._vadActive = false
    this._wakewordListening = false
    this._speechLevel = 0
    this._listeners.clear()
    this._snapshot = null
  }
}
