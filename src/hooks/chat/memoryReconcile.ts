/**
 * Background reconcile of memories just extracted on a turn.
 *
 * The synchronous fallback has already been saved. This schedules one model
 * pass without awaiting it, so the chat reply is not held. A newer turn
 * invalidates the in-flight result. Provider failures stay on the fallback.
 */

import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
  type BackgroundChatInput,
} from '../../features/autonomy/backgroundChatPolicy.ts'
import { commitLongTermMemoryCap } from '../../features/memory/memoryCapCommit.ts'
import {
  buildReconcilePrompt,
  reconcileFromModelText,
  type MemoryTextEmbedder,
} from '../../features/memory/reconcile.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { appendMemoryOpLog } from '../../lib/storage/memoryOpLog.ts'
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/chat.ts'
import type { MemoryItem } from '../../types/memory.ts'

let memoryReconcileRevision = 0

/** Bump when a new turn starts so an older model result cannot overwrite it. */
export function bumpMemoryReconcileRevision(): number {
  memoryReconcileRevision += 1
  return memoryReconcileRevision
}

export function getMemoryReconcileRevision(): number {
  return memoryReconcileRevision
}

type CompleteChat = (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>

/**
 * Fire the model reconcile and apply it only if this turn is still current.
 * Missing config, a busy background lease, or a failed call leaves the
 * deterministic write in place.
 */
export function scheduleMemoryReconcile(input: {
  revision: number
  settings: BackgroundChatInput
  existing: readonly MemoryItem[]
  candidates: readonly MemoryItem[]
  now: string
  completeChat: CompleteChat
  embed?: MemoryTextEmbedder
  applyMemories: (memories: MemoryItem[]) => void
  onLog: (title: string, detail: string) => void
}): void {
  const lease = acquireBackgroundChatLease()
  if (!lease) {
    input.onLog('Memory reconcile deferred', 'background lease busy')
    return
  }

  void (async () => {
    try {
      const gate = getBackgroundChatGate(input.settings)
      const apiKey = input.settings.apiKey?.trim() ?? ''
      if (!gate.allowed || !apiKey) return
      let text: string | null = null
      try {
        const prompt = buildReconcilePrompt(input.existing, input.candidates)
        const response = await input.completeChat({
          providerId: input.settings.providerId,
          baseUrl: input.settings.baseUrl,
          apiKey,
          model: input.settings.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: 0,
          maxTokens: 800,
          traceId: 'background:memory-reconcile',
        })
        text = response?.content ?? null
        recordBackgroundChatSuccess(input.settings)
      } catch (error) {
        recordBackgroundChatFailure(input.settings, classifyBackgroundChatFailure(error))
        input.onLog('Memory reconcile skipped', getRedactedLogErrorMessage(error))
        return
      }
      if (input.revision !== getMemoryReconcileRevision()) return
      const result = reconcileFromModelText(input.existing, input.candidates, text ?? '', {
        now: input.now,
        embed: input.embed,
      })
      if (result.decisionSource !== 'model') {
        input.onLog('Memory reconcile used fallback', result.fallbackReason ?? 'fallback')
        return
      }
      if (input.revision !== getMemoryReconcileRevision()) return
      const capped = commitLongTermMemoryCap(result.memories, input.now)
      input.applyMemories(capped.kept)
      appendMemoryOpLog(result.ops.filter((op) => op.op !== 'NOOP' || op.reason === 'protected'))
      input.onLog('Memory reconcile applied', `ops=${result.ops.length} evicted=${capped.evicted.length}`)
    } catch (error) {
      input.onLog('Memory reconcile skipped', getRedactedLogErrorMessage(error))
    } finally {
      releaseBackgroundChatLease(lease)
    }
  })()
}
