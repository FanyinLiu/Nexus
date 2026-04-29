/**
 * Per-tool timeout, retry with exponential backoff, and circuit breaker.
 *
 * Circuit breaker states:
 *   - closed:   Normal operation — calls go through.
 *   - open:     Consecutive failures exceeded threshold — calls rejected immediately.
 *   - half-open: Cooldown elapsed — next call is a probe; success → closed, failure → open.
 */

import { t } from '../../i18n/runtime.ts'

const CONSECUTIVE_FAILURE_THRESHOLD = 3
const OPEN_COOLDOWN_MS = 30_000
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RETRIES = 2
const INITIAL_BACKOFF_MS = 1_000
const BACKOFF_MULTIPLIER = 2

type CircuitState = 'closed' | 'open' | 'half-open'

type ToolCircuit = {
  state: CircuitState
  consecutiveFailures: number
  lastFailureAt: number
}

const _circuits = new Map<string, ToolCircuit>()

function getCircuit(toolId: string): ToolCircuit {
  let circuit = _circuits.get(toolId)
  if (!circuit) {
    circuit = { state: 'closed', consecutiveFailures: 0, lastFailureAt: 0 }
    _circuits.set(toolId, circuit)
  }
  return circuit
}

function recordSuccess(toolId: string) {
  const circuit = getCircuit(toolId)
  circuit.state = 'closed'
  circuit.consecutiveFailures = 0
}

function recordFailure(toolId: string) {
  const circuit = getCircuit(toolId)
  circuit.consecutiveFailures++
  circuit.lastFailureAt = Date.now()
  if (circuit.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    circuit.state = 'open'
  }
}

function isCallAllowed(toolId: string): boolean {
  const circuit = getCircuit(toolId)
  if (circuit.state === 'closed') return true
  if (circuit.state === 'open') {
    if (Date.now() - circuit.lastFailureAt >= OPEN_COOLDOWN_MS) {
      circuit.state = 'half-open'
      return true
    }
    return false
  }
  // half-open — allow the probe call
  return true
}

export type ToolCallOptions = {
  timeoutMs?: number
  maxRetries?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool call timed out after ${ms}ms`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

/**
 * Execute a tool call with timeout, retry, and circuit breaker protection.
 *
 * @param toolId   The tool name / identifier (used as circuit breaker key).
 * @param callFn   The actual async call to execute.
 * @param options   Optional per-call overrides.
 * @returns         The call result, or throws after retries exhausted / circuit open.
 */
export async function executeWithProtection<T>(
  toolId: string,
  callFn: () => Promise<T>,
  options?: ToolCallOptions,
): Promise<T> {
  if (!isCallAllowed(toolId)) {
    throw new Error(t('tools.circuit.open', { toolId }))
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.maxRetries ?? MAX_RETRIES
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = INITIAL_BACKOFF_MS * (BACKOFF_MULTIPLIER ** (attempt - 1))
      await new Promise((r) => setTimeout(r, backoffMs))

      // Re-check circuit before retry (may have opened from parallel calls)
      if (!isCallAllowed(toolId)) {
        throw new Error(t('tools.circuit.opened_during_retry', { toolId }))
      }
    }

    try {
      const result = await withTimeout(callFn(), timeoutMs)
      recordSuccess(toolId)
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Don't retry on argument / validation errors
      if (lastError.message.includes('Invalid') || lastError.message.includes('not available')) {
        recordFailure(toolId)
        throw lastError
      }

      recordFailure(toolId)
    }
  }

  throw lastError ?? new Error(`Tool "${toolId}" failed after ${maxRetries + 1} attempts`)
}

/** Get the current circuit breaker state for a tool (for debug console). */
export function getCircuitState(toolId: string): { state: CircuitState; failures: number } {
  const circuit = _circuits.get(toolId)
  if (!circuit) return { state: 'closed', failures: 0 }
  // Check if open circuit has cooled down
  if (circuit.state === 'open' && Date.now() - circuit.lastFailureAt >= OPEN_COOLDOWN_MS) {
    return { state: 'half-open', failures: circuit.consecutiveFailures }
  }
  return { state: circuit.state, failures: circuit.consecutiveFailures }
}

/** Reset a specific tool's circuit breaker (for manual recovery). */
export function resetCircuit(toolId: string) {
  _circuits.delete(toolId)
}
