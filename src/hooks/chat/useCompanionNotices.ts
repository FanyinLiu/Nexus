import { useCallback, useEffect, useRef } from 'react'
import { COMPANION_NOTICE_AUTO_HIDE_MS } from '../../features/uiV2/caption.ts'
import { createId } from '../../lib/index.ts'
import { emitPetNotify } from '../../lib/petNotifyBus.ts'
import { isInterruptedError, isStopAllInterrupted } from '../../features/voice/interruptedError.ts'
import {
  mergeDeferredReminders,
  type DeferredReminderCopy,
  type DeferredReminderItem,
} from '../../features/reminders/deferredNotice.ts'
import type { Translator } from '../../types/i18n.ts'
import type { ChatMessage, PetDialogBubbleState } from '../../types/index.ts'
import { getSpeechOutputErrorMessage } from './support.ts'
import type { ChatVoiceDeps, CompanionNoticePayload } from './types.ts'

type CompanionNoticeDependencies = {
  ctx: Pick<ChatVoiceDeps, 'speakAssistantReply' | 'voiceStateRef' | 'continuousVoiceActiveRef'>
  t: Translator
  busyRef: { current: boolean }
  appendChatMessage: (message: ChatMessage) => void
  presentPetDialogBubble: (
    bubble: PetDialogBubbleState,
    options?: { autoHideMs?: number },
  ) => void
  setError: (value: string | null) => void
  /** Injectable clock keeps the 60 s prefix threshold testable. */
  now?: () => number
  /** Settings/DND gate: true drops a queued reminder instead of replaying it. */
  shouldDropDeferredNotice?: (payload: CompanionNoticePayload) => boolean
}

/**
 * Drop every busy-deferred notice. The reminder task row and its history live
 * in persistence, so a user-initiated Stop only silences delivery here.
 * Returns the number of notices dropped.
 */
export function clearDeferredCompanionNotices<T>(queue: T[]): number {
  const cleared = queue.length
  queue.length = 0
  return cleared
}

/**
 * Companion notice delivery: immediate chat/bubble/speech fan-out with a
 * 10min dedupe gate, plus a deferred queue that holds notices back while the
 * assistant is busy or speaking and flushes them in order once idle.
 */
type DeferredCompanionNotice = {
  payload: CompanionNoticePayload
  /** A replay must not duplicate the chat line/bubble already shown. */
  speechOnly: boolean
  /** Queue entry time drives the "waited >= 60 s" prefix rule. */
  enqueuedAt: number
}

type CompanionNoticeSpeechResult = 'played' | 'interrupted' | 'cleared'

function parseReminderDueAt(value: CompanionNoticePayload['reminderDueAt']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function useCompanionNotices({
  ctx,
  t,
  busyRef,
  appendChatMessage,
  presentPetDialogBubble,
  setError,
  now = Date.now,
  shouldDropDeferredNotice,
}: CompanionNoticeDependencies) {
  const deferredCompanionNoticesRef = useRef<DeferredCompanionNotice[]>([])
  const flushingDeferredCompanionNoticesRef = useRef(false)
  const recentCompanionNoticesRef = useRef<Map<string, number>>(new Map())
  // The host recreates its ctx literal every render. Reading through a ref
  // keeps delivery callbacks stable so the idle-flush subscription is not
  // torn down and restarted (which would postpone the 15 s fallback forever).
  const ctxRef = useRef(ctx)
  useEffect(() => {
    ctxRef.current = ctx
  }, [ctx])
  const nowRef = useRef(now)
  useEffect(() => {
    nowRef.current = now
  })
  const shouldDropDeferredNoticeRef = useRef(shouldDropDeferredNotice)
  useEffect(() => {
    shouldDropDeferredNoticeRef.current = shouldDropDeferredNotice
  })
  // A notice interrupted while it was already in the shared player gets one
  // replay. The WeakSet keeps a second interruption from queueing it forever.
  const replayedCompanionNoticesRef = useRef(new WeakSet<CompanionNoticePayload>())

  const playCompanionNoticeSpeech = useCallback(async (
    options: CompanionNoticePayload,
  ): Promise<CompanionNoticeSpeechResult> => {
    const speechContent = options.speechContent?.trim() ?? ''
    if (!speechContent) return 'played'

    try {
      await ctxRef.current.speakAssistantReply(speechContent, options.shouldResumeContinuousVoice ?? false)
      return 'played'
    } catch (speechError) {
      if (isInterruptedError(speechError)) {
        // Stop is final: cleared notices never come back. An interrupt only
        // pauses the notice; requeue it once so it can play in full later.
        if (isStopAllInterrupted(speechError)) return 'cleared'
        const replayed = replayedCompanionNoticesRef.current
        if (!replayed.has(options)) {
          replayed.add(options)
          deferredCompanionNoticesRef.current.push({
            payload: options,
            speechOnly: true,
            enqueuedAt: nowRef.current(),
          })
        }
        return 'interrupted'
      }
      const speechErrorMessage = getSpeechOutputErrorMessage(speechError)
      setError(t('chat.error.speech_with_detail', { error: speechErrorMessage }))
      return 'played'
    }
  }, [setError, t])

  const deliverCompanionNotice = useCallback(async (
    options: CompanionNoticePayload,
    speechOnly = false,
  ): Promise<CompanionNoticeSpeechResult> => {
    if (speechOnly) {
      return playCompanionNoticeSpeech(options)
    }

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
        return 'played'
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

    return playCompanionNoticeSpeech(options)
  }, [appendChatMessage, playCompanionNoticeSpeech, presentPetDialogBubble])

  const canDeliverDeferredCompanionNotice = useCallback((options: { force?: boolean } = {}) => {
    const voiceState = ctxRef.current.voiceStateRef.current
    // A listening turn owns the microphone: speaking a reminder here would
    // talk over the user and can make the voice session drop the utterance.
    if (
      busyRef.current
      || voiceState === 'processing'
      || voiceState === 'speaking'
      || voiceState === 'listening'
    ) {
      return false
    }
    // Continuous voice leaves a short idle gap between turns (for example
    // right after tts:completed) before it reopens listening. The voice state
    // alone cannot distinguish that gap from a truly idle pet, so hold the
    // queue until the whole continuous session ends. A stuck flag can only be
    // overridden by the explicit idle-timeout force path.
    return options.force === true
      || ctxRef.current.continuousVoiceActiveRef?.current !== true
  }, [busyRef])

  const buildDeferredReminderCopy = useCallback((): DeferredReminderCopy => {
    const separator = t('companion.notice.deferred_separator')
    return {
      separator,
      prefix: (items) => t('companion.notice.deferred_prefix', { items }),
      more: (count) => t('companion.notice.deferred_more', { count }),
      moreOne: () => t('companion.notice.deferred_more_one'),
      // Latin locales need a space before the "more" sentence; zh/ja use the
      // punctuation from the item text directly.
      moreJoiner: separator.endsWith(' ') ? ' ' : '',
    }
  }, [t])

  const dropQueuedCompanionNotices = useCallback(() => {
    const queue = deferredCompanionNoticesRef.current
    const shouldDrop = shouldDropDeferredNoticeRef.current
    if (!shouldDrop || queue.length === 0) return 0
    const kept = queue.filter((entry) => !shouldDrop(entry.payload))
    const dropped = queue.length - kept.length
    if (dropped > 0) {
      queue.splice(0, queue.length, ...kept)
    }
    return dropped
  }, [])

  const pushCompanionNotice = useCallback(async (options: CompanionNoticePayload) => {
    if (shouldDropDeferredNoticeRef.current?.(options)) return
    const queue = deferredCompanionNoticesRef.current
    // Deduplicate a reminder that was already queued by id before it can grow
    // the queue or produce a second merged item.
    if (options.reminderId && queue.some((entry) => entry.payload.reminderId === options.reminderId)) {
      return
    }
    // A notice that arrives mid-reply must not start speaking over the pet.
    // Queue it instead; flush only runs once the turn and its speech are done.
    // Reminders already waiting also keep a newcomer in the same merge batch.
    if (!canDeliverDeferredCompanionNotice() || (options.reminderId && queue.length > 0)) {
      queue.push({
        payload: options,
        speechOnly: false,
        enqueuedAt: nowRef.current(),
      })
      return
    }
    await deliverCompanionNotice(options)
  }, [canDeliverDeferredCompanionNotice, deliverCompanionNotice])

  const discardDeferredCompanionNotices = useCallback(() => (
    clearDeferredCompanionNotices(deferredCompanionNoticesRef.current)
  ), [])

  const hasDeferredCompanionNotices = useCallback(
    () => deferredCompanionNoticesRef.current.length > 0,
    [],
  )

  const flushDeferredCompanionNotices = useCallback(async (options: { force?: boolean } = {}) => {
    dropQueuedCompanionNotices()
    if (
      flushingDeferredCompanionNoticesRef.current
      || !canDeliverDeferredCompanionNotice(options)
    ) {
      return
    }

    flushingDeferredCompanionNoticesRef.current = true

    try {
      const queue = deferredCompanionNoticesRef.current
      const reminderEntries = queue.filter((entry) => entry.payload.reminderId)
      if (reminderEntries.length > 0) {
        // Remove every reminder in one pass so the merged utterance is the
        // only delivery for this batch, even when new reminders arrived while
        // earlier ones waited.
        const remaining = queue.filter((entry) => !entry.payload.reminderId)
        queue.splice(0, queue.length, ...remaining)

        const reminderItems: DeferredReminderItem[] = reminderEntries.map((entry) => ({
          reminderId: entry.payload.reminderId as string,
          dueAt: parseReminderDueAt(entry.payload.reminderDueAt) ?? entry.enqueuedAt,
          enqueuedAt: entry.enqueuedAt,
          chatContent: entry.payload.chatContent,
          bubbleContent: entry.payload.bubbleContent ?? entry.payload.chatContent,
          speechContent: entry.payload.speechContent ?? entry.payload.bubbleContent ?? entry.payload.chatContent,
        }))
        const merged = mergeDeferredReminders(reminderItems, buildDeferredReminderCopy(), {
          now: nowRef.current(),
        })
        if (merged) {
          const firstPayload = reminderEntries[0].payload
          const mergedPayload: CompanionNoticePayload = {
            ...firstPayload,
            chatContent: merged.chatContent,
            bubbleContent: merged.bubbleContent,
            speechContent: merged.speechContent,
            // One batch has one delivery key; the per-reminder ids stay in the
            // queue metadata only, never in the user-visible copy.
            dedupeKey: `deferred-reminders:${merged.items.map((item) => item.reminderId).join('|')}`,
            shouldResumeContinuousVoice: false,
          }
          const speechOnly = reminderEntries.every((entry) => entry.speechOnly)
          const result = await deliverCompanionNotice(mergedPayload, speechOnly)
          // An interrupted replay is requeued by the speech layer; do not
          // continue into the non-reminder tail in the same pass.
          if (result !== 'played') return
        }
      }

      while (queue.length && canDeliverDeferredCompanionNotice(options)) {
        const nextNotice = queue.shift()
        if (!nextNotice) {
          continue
        }

        const result = await deliverCompanionNotice(nextNotice.payload, nextNotice.speechOnly)
        // A requeued notice waits for the next completed turn/idle transition;
        // replaying it inside this loop could start before the new reply.
        if (result !== 'played') break
      }
    } finally {
      flushingDeferredCompanionNoticesRef.current = false
    }
  }, [
    buildDeferredReminderCopy,
    canDeliverDeferredCompanionNotice,
    deliverCompanionNotice,
    dropQueuedCompanionNotices,
  ])

  return {
    pushCompanionNotice,
    flushDeferredCompanionNotices,
    discardDeferredCompanionNotices,
    hasDeferredCompanionNotices,
    canDeliverDeferredCompanionNotice,
  }
}
