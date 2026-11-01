import { useCallback } from 'react'
import type {
  AppSettings,
  ChatMessageTone,
  DebugConsoleEventDraft,
  FocusState,
  ReminderTask,
  RuntimeStateSnapshot,
  WindowView,
} from '../../types'
import type { DeliveryDecision } from '../../../shared/proactiveDelivery.js'
import {
  buildBuiltInToolSpeechSummary,
  executeBuiltInTool,
  resolveBuiltInToolPolicy,
  toChatToolResult,
} from '../../features/tools'
import {
  buildReminderDeliveryContext,
  buildReminderProactiveMessage,
  planReminderPresentation,
  proactiveBubbleAutoHideMs,
  REMINDER_NOTICE_AUTO_HIDE_MS,
  shouldRunReminderScheduler,
} from '../../features/reminders'
import { useReminderScheduler } from '../../hooks/useReminderScheduler.ts'
import { broadcastToChannels } from '../../features/integrations/channelBroadcast.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { createLogger } from '../../lib/logger.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'

const reminderLog = createLogger('reminders.notice')

/**
 * Read the active-window snapshot only when the user's settings allow desktop
 * awareness. Anything unreadable counts as "not fullscreen": a reminder must
 * still be delivered when context collection is unavailable.
 */
async function readReminderDesktopContext(settings: AppSettings) {
  if (
    !settings.contextAwarenessEnabled
    || !settings.activeWindowContextEnabled
    || settings.companionAwarenessPaused
  ) {
    return null
  }
  try {
    return await window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true }) ?? null
  } catch {
    return null
  }
}

type ChatBridge = {
  pushCompanionNotice: (payload: {
    chatContent: string
    bubbleContent: string
    speechContent: string
    autoHideMs: number
    dedupeKey?: string
    toolResult?: ReturnType<typeof toChatToolResult>
  }) => Promise<void>
  appendSystemMessage: (content: string, tone?: ChatMessageTone) => void
  sendMessage: (text: string, options?: { source?: 'text' | 'voice' | 'telegram' | 'discord' | 'notification' }) => Promise<unknown>
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
  /** Pet-window view of the user's focus; main adds the panel signal itself. */
  focusState: FocusState
  chat: ChatBridge
  pet: PetBridge
  debugConsole: DebugConsoleBridge
  reminderTaskStore: ReminderTaskStore
}

export function useReminderController({
  view,
  settingsRef,
  runtimeSnapshot,
  focusState,
  chat,
  pet,
  debugConsole,
  reminderTaskStore,
}: UseReminderControllerOptions) {
  const { t, locale } = useTranslation()
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
        const now = Date.now()
        const message = buildReminderProactiveMessage(task, {
          displayText,
          speech: defaultSpeechText,
          now,
        })
        const desktopContext = await readReminderDesktopContext(currentSettings)
        const context = buildReminderDeliveryContext({
          focusState,
          activeWindowTitle: desktopContext?.activeWindowTitle,
          activeWindowAppName: desktopContext?.activeWindowAppName,
          quietStart: currentSettings.proactiveQuietHoursStart,
          quietEnd: currentSettings.proactiveQuietHoursEnd,
          awayNotificationsEnabled: currentSettings.proactiveAwayNotificationsEnabled,
          now,
        })

        let decision: DeliveryDecision | null = null
        const deliver = window.desktopPet?.deliverProactiveMessage
        if (deliver) {
          try {
            decision = await deliver({ message, context })
          } catch (error) {
            reminderLog.warn('reminder routing failed; using the legacy notice', {
              error: getRedactedLogErrorMessage(error),
            })
          }
        } else {
          reminderLog.warn('reminder routing bridge unavailable; using the legacy notice', {
            source: 'reminder',
          })
        }

        if (decision) {
          const plan = planReminderPresentation(decision)
          await chat.pushCompanionNotice({
            chatContent: plan.chatLine
              ? t('chat.prefix.reminder_task', { title: task.title, content: displayText })
              : '',
            // The routed path never opens the controller bubble: rule 4's
            // bubble is rendered by the M0 bubble outlet, and rule 3 must not
            // add a second bubble next to the strip.
            bubbleContent: plan.bubble ? displayText : '',
            speechContent: plan.speech ? defaultSpeechText : '',
            autoHideMs: proactiveBubbleAutoHideMs(message.source, REMINDER_NOTICE_AUTO_HIDE_MS),
            dedupeKey: message.id,
          })
        } else {
          // Legacy path: a reminder must never be lost when routing is
          // unavailable, so fall back to chat line + bubble + speech.
          await chat.pushCompanionNotice({
            chatContent: t('chat.prefix.reminder_task', { title: task.title, content: displayText }),
            bubbleContent: displayText,
            speechContent: defaultSpeechText,
            autoHideMs: REMINDER_NOTICE_AUTO_HIDE_MS,
          })
        }

        const broadcastResults = await broadcastToChannels(
          `${task.title}\n${displayText}`,
          settingsRef.current,
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
          speechContent: task.speechText?.trim()
            || buildBuiltInToolSpeechSummary(result, currentSettings.uiLanguage),
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
        speechContent: task.speechText?.trim()
          || buildBuiltInToolSpeechSummary(result, currentSettings.uiLanguage),
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
  }, [chat, debugConsole, focusState, pet, settingsRef, t])

  useReminderScheduler({
    enabled: shouldRunReminderScheduler(view, runtimeSnapshot),
    tasks: reminderTaskStore.reminderTasks,
    setTasks: reminderTaskStore.setReminderTasks,
    locale,
    onTrigger: handleReminderTaskTrigger,
    onEvent: debugConsole.appendDebugConsoleEvent,
  })
}
