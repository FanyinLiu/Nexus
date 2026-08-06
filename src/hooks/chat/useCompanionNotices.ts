import { useCallback, useRef } from 'react'
import { createId } from '../../lib/index.ts'
import type { Translator } from '../../types/i18n.ts'
import type { ChatMessage, PetDialogBubbleState } from '../../types/index.ts'
import { getSpeechOutputErrorMessage } from './support.ts'
import type { CompanionNoticePayload, UseChatContext } from './types.ts'

type CompanionNoticeDependencies = {
  ctx: UseChatContext
  t: Translator
  busyRef: { current: boolean }
  appendChatMessage: (message: ChatMessage) => void
  presentPetDialogBubble: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void
  setError: (value: string | null) => void
}

/**
 * Companion notice delivery: immediate chat/bubble/speech fan-out with a
 * 10min dedupe gate, plus a deferred queue that holds notices back while the
 * assistant is busy or speaking and flushes them in order once idle.
 */
export function useCompanionNotices({
  ctx,
  t,
  busyRef,
  appendChatMessage,
  presentPetDialogBubble,
  setError,
}: CompanionNoticeDependencies) {
  const deferredCompanionNoticesRef = useRef<CompanionNoticePayload[]>([])
  const flushingDeferredCompanionNoticesRef = useRef(false)
  const recentCompanionNoticesRef = useRef<Map<string, number>>(new Map())

  const pushCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    const chatContent = options.chatContent.trim()
    const bubbleContent = (options.bubbleContent ?? chatContent).trim()
    const speechContent = options.speechContent?.trim() ?? ''
    const createdAt = new Date().toISOString()

    // Dedupe gate: drop near-identical broadcasts within 10min. StrictMode
    // double-mount and cross-category autonomy paths (proactive speak /
    // scheduled / context trigger / brief) can otherwise produce twin
    // notices for the same underlying thought. We key on bubbleContent —
    // the label-free core text — so 【早报】X and 【自主】X collapse to
    // one entry instead of bypassing the gate through their prefix.
    const DEDUPE_WINDOW_MS = 10 * 60_000
    const dedupeKey = options.dedupeKey?.trim() || bubbleContent || speechContent || chatContent
    if (dedupeKey) {
      const now = Date.now()
      const recent = recentCompanionNoticesRef.current
      for (const [key, ts] of recent) {
        if (now - ts > DEDUPE_WINDOW_MS) recent.delete(key)
      }
      const lastTs = recent.get(dedupeKey)
      if (lastTs !== undefined && now - lastTs < DEDUPE_WINDOW_MS) {
        return
      }
      recent.set(dedupeKey, now)
    }

    if (chatContent) {
      appendChatMessage({
        id: createId('msg'),
        role: 'assistant',
        content: chatContent,
        toolResult: options.toolResult,
        createdAt,
      })
    }

    if (bubbleContent) {
      presentPetDialogBubble(
        {
          content: bubbleContent,
          toolResult: options.toolResult,
          streaming: false,
          createdAt,
        },
        { autoHideMs: options.autoHideMs ?? 14_000 },
      )
    }

    ctx.markPresenceActivity()
    ctx.setMood('happy')

    if (!speechContent) {
      return
    }

    try {
      await ctx.speakAssistantReply(speechContent, options.shouldResumeContinuousVoice ?? false)
    } catch (speechError) {
      const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
      setError(t('chat.error.speech_with_detail', { error: speechErrorMessage }))
    }
  }, [appendChatMessage, ctx, presentPetDialogBubble, setError, t])

  const canDeliverDeferredCompanionNotice = useCallback(() => (
    !busyRef.current
    && ctx.voiceStateRef.current !== 'processing'
    && ctx.voiceStateRef.current !== 'speaking'
  ), [busyRef, ctx.voiceStateRef])

  const flushDeferredCompanionNotices = useCallback(async () => {
    if (flushingDeferredCompanionNoticesRef.current || !canDeliverDeferredCompanionNotice()) {
      return
    }

    flushingDeferredCompanionNoticesRef.current = true

    try {
      while (deferredCompanionNoticesRef.current.length && canDeliverDeferredCompanionNotice()) {
        const nextNotice = deferredCompanionNoticesRef.current.shift()
        if (!nextNotice) {
          continue
        }

        await pushCompanionNotice(nextNotice)
      }
    } finally {
      flushingDeferredCompanionNoticesRef.current = false
    }
  }, [canDeliverDeferredCompanionNotice, pushCompanionNotice])

  return {
    pushCompanionNotice,
    flushDeferredCompanionNotices,
  }
}
