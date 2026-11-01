// Owns the autonomy-aware sendMessage wrapper (stable identity via refs) and
// the chat controller with the patched sendMessage. Extracted from
// useAppController without behavior change.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { classifyMessageSignals } from '../../features/autonomy/emotionModel.ts'
import type { AppSettings } from '../../types'

type ChatController = ReturnType<typeof import('../../hooks/useChat').useChat>
type AutonomyController = ReturnType<typeof import('./useAutonomyController').useAutonomyController>

type UseAutonomyAwareSendMessageOptions = {
  autonomy: AutonomyController
  chat: ChatController
  sendMessageRef: { current: ChatController['sendMessage'] }
  settingsRef: { current: AppSettings }
}

export function useAutonomyAwareSendMessage({
  autonomy,
  chat,
  sendMessageRef,
  settingsRef,
}: UseAutonomyAwareSendMessageOptions) {
  // Wake autonomy when user sends a chat message.
  //
  // Depending on the whole `autonomy` object (or even `chat.sendMessage`) in
  // this wrapper's useCallback deps rebuilt it every render — the autonomy
  // return value is a fresh object whenever any inner hook returns a new
  // reference, and `chat.sendMessage` was also a function identity that
  // rotated on chat state changes. That pushed a new `autonomyAwareSendMessage`
  // into downstream useMemos (`chatWithAutonomy`, `petView`, `overlays`), which
  // then re-rendered components whose effects wrote back to state — a classic
  // "Maximum update depth exceeded" loop, observable as a log spam storm the
  // moment a chat turn settles.
  //
  // Fix: stash the live references in refs and let the wrapper close over
  // empty deps. The wrapper identity is now stable for the lifetime of the
  // component, so `chatWithAutonomy` / `petView` / `overlays` stop churning.
  const autonomyRef = useRef(autonomy)
  const originalSendMessageRef = useRef(chat.sendMessage)
  useEffect(() => {
    autonomyRef.current = autonomy
  }, [autonomy])
  useEffect(() => {
    originalSendMessageRef.current = chat.sendMessage
  }, [chat.sendMessage])

  const autonomyAwareSendMessage = useCallback(async (
    ...args: Parameters<ChatController['sendMessage']>
  ) => {
    const live = autonomyRef.current
    live.focusAwareness.markActive()
    if (settingsRef.current.autonomyWakeOnInput !== false) {
      live.autonomyTick.wakeUp()
    }
    live.markInteraction()

    // Classify user message text for emotion signals
    const messageText = typeof args[0] === 'string' ? args[0] : ''
    if (messageText) {
      live.applyEmotionSignal('user_returned')
      for (const signal of classifyMessageSignals(messageText)) {
        live.applyEmotionSignal(signal)
      }
      live.processRelationshipMessage(messageText)
    }

    const emotion = live.emotionStateRef.current
    if (emotion && messageText) {
      live.updateSessionContext(emotion, messageText)
    }

    const result = await originalSendMessageRef.current(...args)
    if (result) {
      live.memoryDream.incrementSessionCount()
      live.applyEmotionSignal('task_completed')
    }
    return result
  }, [settingsRef])

  // Point sendMessageRef to the autonomy-aware wrapper so that voice
  // and other ref-based paths also trigger emotion/interaction tracking.
  useEffect(() => {
    sendMessageRef.current = autonomyAwareSendMessage
  }, [autonomyAwareSendMessage, sendMessageRef])

  // Patch chat.sendMessage with autonomy-aware wrapper.
  // `autonomyAwareSendMessage` is now a stable identity, so this memo only
  // invalidates when `chat` itself changes shape — which is what we want.
  const chatWithAutonomy = useMemo(() => ({
    ...chat,
    sendMessage: autonomyAwareSendMessage,
  }), [chat, autonomyAwareSendMessage])

  return {
    chatWithAutonomy,
  }
}
