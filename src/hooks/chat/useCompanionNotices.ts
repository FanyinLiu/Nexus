import { useCallback, useRef } from 'react'
import { COMPANION_NOTICE_AUTO_HIDE_MS } from '../../features/uiV2/caption.ts'
import { createId } from '../../lib/index.ts'
import { emitPetNotify } from '../../lib/petNotifyBus.ts'
import { isInterruptedError } from '../../features/voice/interruptedError.ts'
import type { Translator } from '../../types/i18n.ts'
import type { ChatMessage, PetDialogBubbleState } from '../../types/index.ts'
import { getSpeechOutputErrorMessage } from './support.ts'
import type { ChatVoiceDeps, CompanionNoticePayload } from './types.ts'

type CompanionNoticeDependencies = {
  ctx: Pick<ChatVoiceDeps, 'speakAssistantReply' | 'voiceStateRef'>
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
 * Drop every busy-deferred notice. The reminder task row and its history live
 * in persistence, so a user-initiated Stop only silences delivery here.
 * Returns the number of notices dropped.
 */
export function clearDeferredCompanionNotices(queue: CompanionNoticePayload[]): number {
  const cleared = queue.length
  queue.length = 0
  return cleared
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

  const deliverCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    const chatContent = options.chatContent.trim()
    const bubbleContent = (options.bubbleContent ?? chatContent).trim()
    const proactiveTitle = options.proactiveTitle?.trim() ?? ''
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
        ...(options.loopOffer ? { loopOffer: options.loopOffer } : {}),
        ...(options.loopCheck ? { loopCheck: options.loopCheck } : {}),
        ...(options.proactiveWhy ? { proactiveWhy: options.proactiveWhy } : {}),
        // The letter card belongs to the chat history only; the bubble below
        // stays empty for a capsule, so the letter never leaves this message.
        ...(options.capsuleLetter ? { capsuleLetter: options.capsuleLetter } : {}),
      })
    }

    if (bubbleContent) {
      presentPetDialogBubble(
        {
          content: bubbleContent,
          toolResult: options.toolResult,
          streaming: false,
          createdAt,
          ...(options.loopOffer ? { loopOffer: options.loopOffer } : {}),
          ...(options.loopCheck ? { loopCheck: options.loopCheck } : {}),
          ...(options.proactiveWhy ? { proactiveWhy: options.proactiveWhy } : {}),
          ...(proactiveTitle ? { proactiveTitle } : {}),
        },
        // A proactive notice is timed by the shared collapse scheduler on the
        // surface, never by the plain notice auto-hide.
        proactiveTitle
          ? undefined
          : { autoHideMs: options.autoHideMs ?? COMPANION_NOTICE_AUTO_HIDE_MS },
      )
    }

    // History-only notices opt out: a line the router kept quiet must not move
    // the pet's presence or expression behind the user's back.
    if (options.petReaction !== false) {
      emitPetNotify({ type: 'presence_activity' })
      emitPetNotify({ type: 'mood', mood: 'happy' })
    }

    if (!speechContent) {
      return
    }

    try {
      await ctx.speakAssistantReply(speechContent, options.shouldResumeContinuousVoice ?? false)
    } catch (speechError) {
      // An intentional stop aborts this promise. That is a normal cancellation,
      // not a playback failure; surfacing it would flip the pet to error.
      if (isInterruptedError(speechError)) return
      const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
      setError(t('chat.error.speech_with_detail', { error: speechErrorMessage }))
    }
  }, [appendChatMessage, ctx, presentPetDialogBubble, setError, t])

  const canDeliverDeferredCompanionNotice = useCallback(() => (
    !busyRef.current
    && ctx.voiceStateRef.current !== 'processing'
    && ctx.voiceStateRef.current !== 'speaking'
  ), [busyRef, ctx.voiceStateRef])

  const pushCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    // A notice that arrives mid-reply must not start speaking over the pet.
    // Queue it instead; flush only runs once the turn and its speech are done.
    if (!canDeliverDeferredCompanionNotice()) {
      deferredCompanionNoticesRef.current.push(options)
      return
    }
    await deliverCompanionNotice(options)
  }, [canDeliverDeferredCompanionNotice, deliverCompanionNotice])

  const discardDeferredCompanionNotices = useCallback(() => (
    clearDeferredCompanionNotices(deferredCompanionNoticesRef.current)
  ), [])

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

        await deliverCompanionNotice(nextNotice)
      }
    } finally {
      flushingDeferredCompanionNoticesRef.current = false
    }
  }, [canDeliverDeferredCompanionNotice, deliverCompanionNotice])

  return {
    pushCompanionNotice,
    flushDeferredCompanionNotices,
    discardDeferredCompanionNotices,
  }
}
