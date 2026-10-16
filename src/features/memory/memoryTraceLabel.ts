/**
 * Summary line for a reply's memory trace.
 * Paused turns stay distinct from "nothing recalled" and from a per-item pause.
 */

import type { ChatMemoryTrace } from '../../types'
import type { TranslationKey } from '../../types/i18n.ts'

export type ChatMemoryTraceLabel = {
  key: TranslationKey
  params?: Record<string, number>
}

/** Label for an assistant turn, or null when the turn has no trace. */
export function describeChatMemoryTrace(message: {
  role: string
  memoryTrace?: ChatMemoryTrace
}): ChatMemoryTraceLabel | null {
  const trace = message.memoryTrace
  if (!trace || message.role !== 'assistant') return null

  if (trace.status === 'paused') {
    return { key: 'message_bubble.memory_trace.paused' }
  }

  const longTerm = trace.longTermIds.length
  const daily = trace.dailyEntryIds.length
  const semantic = trace.semanticIds.length
  if (longTerm + daily + semantic === 0) {
    return { key: 'message_bubble.memory_trace.none' }
  }

  return {
    key: 'message_bubble.memory_trace.used',
    params: { longTerm, daily, semantic },
  }
}
