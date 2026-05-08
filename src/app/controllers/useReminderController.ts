import { useCallback } from 'react'
import type {
  AppSettings,
  ChatMessageTone,
  DebugConsoleEventDraft,
  ReminderTask,
  RuntimeStateSnapshot,
  WindowView,
} from '../../types'
import {
  buildBuiltInToolSpeechSummary,
  executeBuiltInTool,
  resolveBuiltInToolPolicy,
  toChatToolResult,
} from '../../features/tools'
import { shouldRunReminderScheduler } from '../../features/reminders'
import { useReminderScheduler } from '../../hooks/useReminderScheduler'
import { broadcastToChannels } from '../../lib/coreRuntime'
import { useTranslation } from '../../i18n/useTranslation.ts'

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
    toolResult?: ReturnType<typeof toChatToolResult>
  }) => Promise<void>
  appendSystemMessage: (content: string, tone?: ChatMessageTone) => void
  sendMessage: (text: string, options?: { source?: 'text' | 'voice' | 'telegram' | 'discord' }) => Promise<unknown>
}

type PetBridge = {
  updatePetStatus: (text: string, durationMs?: number) => void
}

type DebugConsoleBridge = {
  appendDebugConsoleEvent: (event: DebugConsoleEventDraft) => void
}

type ReminderTaskStore = {
  reminderTasks: ReminderTask[]
  setReminderTasks: React.Dispatch<React.SetStateAction<ReminderTask[]>>
}

export type UseReminderControllerOptions = {
  view: WindowView
  settingsRef: React.RefObject<AppSettings>
  runtimeSnapshot: RuntimeStateSnapshot
  chat: ChatBridge
  pet: PetBridge
  debugConsole: DebugConsoleBridge
  reminderTaskStore: ReminderTaskStore
}

export function useReminderController({
  view,
  settingsRef,
  runtimeSnapshot,
  chat,
  pet,
  debugConsole,
  reminderTaskStore,
}: UseReminderControllerOptions) {
  const { t } = useTranslation()
  const handleReminderTaskTrigger = useCallback(async (task: ReminderTask) => {
    const displayText = task.prompt.trim()
    const action = task.action
    const currentSettings = settingsRef.current
    const defaultSpeechText = task.speechText?.trim() || t('chat.reminder_task.speech_fallback', { title: task.title, content: task.prompt.trim() })

    const actionLabel = action.kind === 'notice' ? 'notice' : action.kind === 'weather' ? 'weather' : action.kind === 'chat_action' ? 'chat_action' : 'search'
    debugConsole.appendDebugConsoleEvent({
      source: 'tool',
      title: 'Starting automated task',
      detail: `${task.title} / ${actionLabel}`,
      relatedTaskId: task.id,
    })

    try {
      if (action.kind === 'notice') {
        await chat.pushCompanionNotice({
          chatContent: t('chat.prefix.reminder_task', { title: task.title, content: displayText }),
          bubbleContent: displayText,
          speechContent: defaultSpeechText,
          autoHideMs: 16_000,
        })
        const broadcastResults = await broadcastToChannels(
          `${task.title}\n${displayText}`,
        )
        const deliveredCount = broadcastResults.filter((r) => r.ok).length
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: 'Automated reminder dispatched',
          detail: deliveredCount > 0
            ? `${task.title} / local + ${deliveredCount} channel(s)`
            : `${task.title} / next run visible in task snapshot`,
          tone: 'success',
          relatedTaskId: task.id,
        })
        return
      }

      if (action.kind === 'weather') {
        const policy = resolveBuiltInToolPolicy('weather', currentSettings)
        if (!policy.enabled) {
          chat.appendSystemMessage(t('chat.reminder_task.weather_disabled', { title: task.title }), 'error')
          debugConsole.appendDebugConsoleEvent({
            source: 'tool',
            title: 'Automated task skipped',
            detail: `${task.title} / weather tool currently disabled`,
            tone: 'error',
            relatedTaskId: task.id,
          })
          return
        }

        const result = await executeBuiltInTool(
          {
            id: 'weather',
            location: action.location,
          },
          policy,
          currentSettings,
        )

        await chat.pushCompanionNotice({
          chatContent: t('chat.prefix.reminder_task', { title: task.title, content: result.assistantSummary }),
          bubbleContent: result.assistantSummary,
          speechContent: task.speechText?.trim() || buildBuiltInToolSpeechSummary(result),
          autoHideMs: 18_000,
          toolResult: toChatToolResult(result),
        })
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: 'Automated weather task completed',
          detail: `${task.title} / ${result.kind === 'weather' ? result.result.resolvedName : action.location || 'default location'}`,
          tone: 'success',
          relatedTaskId: task.id,
        })
        return
      }

      if (action.kind === 'chat_action') {
        await chat.sendMessage(
          t('chat.prefix.scheduled_chat_action', { title: task.title, instruction: action.instruction }),
          { source: 'text' },
        )
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: 'Chat action triggered',
          detail: `${task.title} / ${action.instruction}`,
          tone: 'success',
          relatedTaskId: task.id,
        })
        return
      }

      const policy = resolveBuiltInToolPolicy('web_search', currentSettings)
      if (!policy.enabled) {
        chat.appendSystemMessage(t('chat.reminder_task.search_disabled', { title: task.title }), 'error')
        debugConsole.appendDebugConsoleEvent({
          source: 'tool',
          title: 'Automated task skipped',
          detail: `${task.title} / search tool currently disabled`,
          tone: 'error',
          relatedTaskId: task.id,
        })
        return
      }

      const result = await executeBuiltInTool(
        {
          id: 'web_search',
          query: action.query,
          limit: action.limit ?? 5,
        },
        policy,
        currentSettings,
      )

      await chat.pushCompanionNotice({
        chatContent: t('chat.prefix.reminder_task', { title: task.title, content: result.assistantSummary }),
        bubbleContent: result.assistantSummary,
        speechContent: task.speechText?.trim() || buildBuiltInToolSpeechSummary(result),
        autoHideMs: 18_000,
        toolResult: toChatToolResult(result),
      })
      debugConsole.appendDebugConsoleEvent({
        source: 'tool',
        title: 'Automated search task completed',
        detail: `${task.title} / ${result.kind === 'web_search' ? result.result.query : action.query}`,
        tone: 'success',
        relatedTaskId: task.id,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('chat.reminder_task.execution_failed')
      chat.appendSystemMessage(t('chat.reminder_task.execution_failed_system', { title: task.title, error: errorMessage }), 'error')
      pet.updatePetStatus(t('chat.reminder_task.execution_failed_pet', { title: task.title }), 3200)
      debugConsole.appendDebugConsoleEvent({
        source: 'tool',
        title: 'Automated task execution failed',
        detail: `${task.title} / ${errorMessage}`,
        tone: 'error',
        relatedTaskId: task.id,
      })
    }
  }, [chat, debugConsole, pet, settingsRef, t])

  useReminderScheduler({
    enabled: shouldRunReminderScheduler(view, runtimeSnapshot),
    tasks: reminderTaskStore.reminderTasks,
    setTasks: reminderTaskStore.setReminderTasks,
    onTrigger: handleReminderTaskTrigger,
    onEvent: debugConsole.appendDebugConsoleEvent,
  })
}
