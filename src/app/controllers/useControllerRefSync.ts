// Owns the small ref-sync effects that forward the latest chat/voice/reminder
// handlers and state into refs. Extracted from useAppController without
// behavior change; the effect order is preserved.

import { useEffect } from 'react'
import type { AppSettings, ChatMessage, VoiceState } from '../../types'

type ChatController = ReturnType<typeof import('../../hooks/useChat').useChat>
type VoiceController = ReturnType<typeof import('../../hooks/useVoice').useVoice>
type ReminderTaskStore = ReturnType<typeof import('./useReminderTaskStore').useReminderTaskStore>

type UseControllerRefSyncOptions = {
  addReminderTaskFnRef: { current: ReminderTaskStore['addReminderTask'] | null }
  appendSystemMessageRef: { current: ChatController['appendSystemMessage'] }
  busyRef: { current: boolean }
  chat: ChatController
  inputRef: { current: string }
  messagesRef: { current: ChatMessage[] }
  presentPetDialogBubbleRef: { current: ChatController['presentPetDialogBubble'] }
  reminderTaskStore: ReminderTaskStore
  removeReminderTaskFnRef: { current: ReminderTaskStore['removeReminderTask'] | null }
  setErrorRef: { current: ChatController['setError'] }
  setInputFnRef: { current: ChatController['setInput'] }
  settings: AppSettings
  settingsOpen: boolean
  settingsOpenRef: { current: boolean }
  settingsRef: { current: AppSettings }
  updateReminderTaskFnRef: { current: ReminderTaskStore['updateReminderTask'] | null }
  voice: VoiceController
  voiceStateRef: { current: VoiceState }
}

export function useControllerRefSync({
  addReminderTaskFnRef,
  appendSystemMessageRef,
  busyRef,
  chat,
  inputRef,
  messagesRef,
  presentPetDialogBubbleRef,
  reminderTaskStore,
  removeReminderTaskFnRef,
  setErrorRef,
  setInputFnRef,
  settings,
  settingsOpen,
  settingsOpenRef,
  settingsRef,
  updateReminderTaskFnRef,
  voice,
  voiceStateRef,
}: UseControllerRefSyncOptions) {
  // Forward the latest chat handlers to refs so the closures we passed into
  // useChat (which call setErrorRef.current(...) etc.) always see up-to-date
  // implementations. This is a deliberate break of the hook-circular-dependency
  // between useAutonomyController, useChat, and these setters — hence the
  // ref-mutation-through-effect pattern is intentional.
  useEffect(() => {
    setErrorRef.current = chat.setError
    setInputFnRef.current = chat.setInput
    appendSystemMessageRef.current = chat.appendSystemMessage
    presentPetDialogBubbleRef.current = chat.presentPetDialogBubble
  }, [
    chat.appendSystemMessage,
    chat.presentPetDialogBubble,
    chat.setError,
    chat.setInput,
    appendSystemMessageRef,
    presentPetDialogBubbleRef,
    setErrorRef,
    setInputFnRef,
  ])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings, settingsRef])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen, settingsOpenRef])

  useEffect(() => {
    busyRef.current = chat.busy
  }, [busyRef, chat.busy])

  useEffect(() => {
    inputRef.current = chat.input
  }, [chat.input, inputRef])

  useEffect(() => {
    messagesRef.current = chat.messages
  }, [chat.messages, messagesRef])

  useEffect(() => {
    voiceStateRef.current = voice.voiceState
  }, [voice.voiceState, voiceStateRef])

  useEffect(() => {
    addReminderTaskFnRef.current = reminderTaskStore.addReminderTask
    updateReminderTaskFnRef.current = reminderTaskStore.updateReminderTask
    removeReminderTaskFnRef.current = reminderTaskStore.removeReminderTask
  }, [
    reminderTaskStore.addReminderTask,
    reminderTaskStore.removeReminderTask,
    reminderTaskStore.updateReminderTask,
    addReminderTaskFnRef,
    removeReminderTaskFnRef,
    updateReminderTaskFnRef,
  ])
}
