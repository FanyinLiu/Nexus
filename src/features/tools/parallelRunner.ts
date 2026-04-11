/**
 * Parallel tool execution — runs multiple independent tool calls concurrently.
 *
 * Uses Promise.allSettled to ensure one failure doesn't abort others.
 * Results are collected with individual success/failure status so callers
 * can aggregate partial results.
 */

import { maybeRunMatchedBuiltInTool } from './router'
import type { BuiltInToolResult, MatchedBuiltInTool } from './toolTypes'

export type ParallelToolEntry = {
  id: string
  tool: MatchedBuiltInTool
}

export type ParallelToolOutcome = {
  id: string
  tool: MatchedBuiltInTool
  status: 'fulfilled' | 'rejected' | 'skipped'
  result: BuiltInToolResult | null
  error: string | null
  durationMs: number
}

/**
 * Run multiple built-in tools concurrently.
 * Returns outcomes in the same order as the input entries.
 */
export async function runToolsInParallel(
  entries: ParallelToolEntry[],
  settings?: unknown,
): Promise<ParallelToolOutcome[]> {
  if (entries.length === 0) return []

  // Single tool — no need for Promise.allSettled overhead
  if (entries.length === 1) {
    const entry = entries[0]
    const start = Date.now()
    try {
      const result = await maybeRunMatchedBuiltInTool(entry.tool, settings)
      return [{
        id: entry.id,
        tool: entry.tool,
        status: result ? 'fulfilled' : 'skipped',
        result,
        error: null,
        durationMs: Date.now() - start,
      }]
    } catch (err) {
      return [{
        id: entry.id,
        tool: entry.tool,
        status: 'rejected',
        result: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }]
    }
  }

  const startTimes = entries.map(() => Date.now())

  const settled = await Promise.allSettled(
    entries.map((entry, idx) => {
      startTimes[idx] = Date.now()
      return maybeRunMatchedBuiltInTool(entry.tool, settings)
    }),
  )

  return settled.map((outcome, idx) => {
    const entry = entries[idx]
    const durationMs = Date.now() - startTimes[idx]

    if (outcome.status === 'fulfilled') {
      return {
        id: entry.id,
        tool: entry.tool,
        status: outcome.value ? 'fulfilled' as const : 'skipped' as const,
        result: outcome.value,
        error: null,
        durationMs,
      }
    }

    return {
      id: entry.id,
      tool: entry.tool,
      status: 'rejected' as const,
      result: null,
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      durationMs,
    }
  })
}

/**
 * Run multiple async tasks in parallel with a concurrency limit.
 * Generic utility — not tool-specific.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let nextIndex = 0

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++
      try {
        const value = await tasks[idx]()
        results[idx] = { status: 'fulfilled', value }
      } catch (reason) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runNext(),
  )
  await Promise.all(workers)

  return results
}
