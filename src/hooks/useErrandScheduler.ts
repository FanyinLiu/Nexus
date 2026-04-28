import { useEffect, useRef } from 'react'
import { createChatAgentExecutor } from '../features/agent/agentLoop'
import {
  decideErrandRun,
  recordRun,
} from '../features/agent/errandPolicy'
import { findRunnableErrand } from '../features/agent/errandStore'
import {
  readErrandRunnerState,
  runErrand,
  writeErrandRunnerState,
} from '../features/agent/errandRunner'
import type { AppSettings, MemoryRecallContext } from '../types'

const POLL_INTERVAL_MS = 5 * 60 * 1000  // 5 min — gentle on CPU and on the LLM bill

/**
 * Module-level lock so a slow-running errand (60 s+ agent loop) doesn't
 * let the next 5-min tick start a *second* errand in parallel against
 * the same stale runner-state snapshot. `findRunnableErrand` already
 * skips errands in 'running' status, so the same errand can't be picked
 * twice — but a different queued errand could, bypassing the nightly
 * budget cap. The lock fixes that.
 */
let runningTick = false

/**
 * Errand mode is the only place we run the agent loop without a recall
 * context. The user's prompt is the goal; we don't try to weave in
 * past memory because errands are task-shaped (research, summarize,
 * draft) rather than companionship-shaped. Empty context keeps the
 * agent prompt small and the spend predictable.
 */
const EMPTY_MEMORY: MemoryRecallContext = {
  longTerm: [],
  daily: [],
  semantic: [],
  searchModeUsed: 'keyword',
  vectorSearchAvailable: false,
}

interface UseErrandSchedulerOptions {
  settings: AppSettings
}

/**
 * Overnight errand scheduler.
 *
 * Polls every 5 minutes. When a queued errand exists AND we're inside
 * the configured run window AND the cooldown / per-night budget allow
 * it, the scheduler picks the next queued errand and runs it through
 * `runErrand` (which drives the agent loop). The result lands in the
 * errand store; the morning bracket surfaces it to the user.
 *
 * Manual approval is the contract: the runner never invents tasks. It
 * only executes ones the user explicitly added to the queue.
 */
export function useErrandScheduler({ settings }: UseErrandSchedulerOptions) {
  const liveRef = useRef({ settings })
  useEffect(() => {
    liveRef.current = { settings }
  }, [settings])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (runningTick) return  // already running an errand from a prior tick

      const errand = findRunnableErrand()
      if (!errand) return

      const state = readErrandRunnerState()
      const decision = decideErrandRun({
        nowMs: Date.now(),
        hasQueuedErrand: true,
        state,
      })
      if (!decision.shouldRun) return

      const { settings: s } = liveRef.current
      const executor = createChatAgentExecutor({
        settings: s,
        memoryContext: EMPTY_MEMORY,
      })

      runningTick = true
      try {
        try {
          await runErrand(errand, {
            executeTurn: executor,
            uiLanguage: s.uiLanguage,
          })
        } catch (err) {
          // runErrand catches its own agent-loop errors and writes them to
          // the store; this catches an outer surprise (executor build
          // failure etc.) so the scheduler stays alive.
          console.warn('[errand] run failed unexpectedly:', err)
        }

        if (stopped) return
        // Re-read the runner state inside the lock so any concurrent
        // writes outside the scheduler (none today, defensive) don't get
        // overwritten by our stale snapshot. Then record this run.
        const fresh = readErrandRunnerState()
        writeErrandRunnerState(
          recordRun(fresh, decision.nightAnchor, new Date().toISOString()),
        )
      } finally {
        runningTick = false
      }
    }

    void tick()
    const id = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      window.clearInterval(id)
    }
    // Empty deps: scheduler runs for the lifetime of the app. liveRef
    // already gives the tick the latest settings.
  }, [])
}
