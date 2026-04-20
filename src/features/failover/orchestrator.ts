import { t } from '../../i18n/runtime.ts'
import type { FailoverDomain } from './runtime.ts'
import {
  buildFailoverKey,
  isFailoverCoolingDown,
  isFailoverEligibleError,
  recordFailoverFailure,
  recordFailoverSuccess,
} from './runtime.ts'

// ── Types ──

export type FailoverCandidate<T> = {
  id: string
  identity: string
  payload: T
}

export type FailoverEvent =
  | { type: 'attempt'; candidateId: string; isPrimary: boolean }
  | { type: 'success'; candidateId: string; isPrimary: boolean }
  | { type: 'failure'; candidateId: string; isPrimary: boolean; error: string; eligible: boolean }
  | { type: 'cooldown-skip'; candidateId: string }

export type FailoverResult<R> = {
  result: R
  candidateId: string
  usedFallback: boolean
}

export type ExecuteWithFailoverOptions<T, R> = {
  domain: FailoverDomain
  candidates: FailoverCandidate<T>[]
  execute: (candidate: FailoverCandidate<T>, isPrimary: boolean) => Promise<R>
  failoverEnabled: boolean
  onEvent?: (event: FailoverEvent) => void
  formatError?: (candidateId: string, error: Error) => string
}

// ── Orchestrator ──

export async function executeWithFailover<T, R>(
  options: ExecuteWithFailoverOptions<T, R>,
): Promise<FailoverResult<R>> {
  const { domain, candidates, execute, failoverEnabled, onEvent } = options
  const errors: string[] = []

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const isPrimary = index === 0
    const failoverKey = buildFailoverKey(domain, candidate.id, candidate.identity)

    if (!isPrimary && isFailoverCoolingDown(failoverKey)) {
      onEvent?.({ type: 'cooldown-skip', candidateId: candidate.id })
      continue
    }

    onEvent?.({ type: 'attempt', candidateId: candidate.id, isPrimary })

    try {
      const result = await execute(candidate, isPrimary)
      recordFailoverSuccess(failoverKey)
      onEvent?.({ type: 'success', candidateId: candidate.id, isPrimary })
      return { result, candidateId: candidate.id, usedFallback: !isPrimary }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      const eligible = isFailoverEligibleError(error)

      if (eligible) {
        recordFailoverFailure(failoverKey, message)
      }

      const formatted = options.formatError?.(candidate.id, error instanceof Error ? error : new Error(message))
        ?? `${candidate.id}: ${message}`
      errors.push(formatted)

      onEvent?.({ type: 'failure', candidateId: candidate.id, isPrimary, error: message, eligible })

      if (!failoverEnabled || !eligible) {
        throw error instanceof Error ? error : new Error(message)
      }
    }
  }

  throw new Error(errors.join('\n') || t('failover.error.all_failed', { domain }))
}
