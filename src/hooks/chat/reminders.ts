import {
  buildReminderDraftFromPrompt,
  buildReminderTaskDigest,
  findBestReminderTaskMatch,
  parseReminderIntent,
  parseReminderPromptOnly,
  parseReminderScheduleOnly,
  type ParsedReminderIntent,
} from '../../features/reminders/parseReminderIntent.ts'
import { formatReminderScheduleSummaryForUi } from '../../features/reminders/schedule.ts'
import { shorten } from '../../lib/common'
import { getLocale, t } from '../../i18n/runtime.ts'
import type { AssistantRuntimeActivity, DebugConsoleEventDraft } from '../../types'
import { formatReminderNextRunLabel } from './support'
import type {
  CompanionNoticePayload,
  PendingReminderDraft,
  PendingReminderDraftInput,
  UseChatContext,
} from './types'

export type ResolvedReminderIntent = {
  intent: ParsedReminderIntent | null
  shouldClearPendingDraft: boolean
}

export type LocalReminderActionOptions = {
  intent: ParsedReminderIntent
  content: string
  fromVoice: boolean
  traceLabel: string
  shouldResumeContinuousVoice: boolean
}

type LocalReminderActionDependencies = {
  ctx: Pick<
    UseChatContext,
    | 'addReminderTask'
    | 'appendDebugConsoleEvent'
    | 'appendVoiceTrace'
    | 'reminderTasksRef'
    | 'removeReminderTask'
    | 'scheduleVoiceRestart'
    | 'shouldAutoRestartVoice'
    | 'suppressVoiceReplyRef'
    | 'updateReminderTask'
    | 'updateVoicePipeline'
  >
  clearPendingReminderDraft: () => void
  pushCompanionNotice: (notice: CompanionNoticePayload) => Promise<void>
  setAssistantActivity: (activity: AssistantRuntimeActivity) => void
  setPendingReminderDraft: (draft: PendingReminderDraftInput) => void
  syncAssistantActivity: () => void
}

export function resolveReminderIntentWithPendingDraft(
  content: string,
  pendingReminderDraft: PendingReminderDraft | null,
): ResolvedReminderIntent {
  let parsedReminderIntent = parseReminderIntent(content)
  let shouldClearPendingDraft = false

  if (!parsedReminderIntent && pendingReminderDraft) {
    if (pendingReminderDraft.kind === 'missing_time') {
      const pendingSchedule = parseReminderScheduleOnly(content)
      if (pendingSchedule) {
        parsedReminderIntent = {
          kind: 'create',
          draft: {
            title: pendingReminderDraft.title,
            prompt: pendingReminderDraft.prompt,
            speechText: pendingReminderDraft.speechText,
            action: pendingReminderDraft.action,
            enabled: pendingReminderDraft.enabled,
            schedule: pendingSchedule,
          },
        }
      } else {
        shouldClearPendingDraft = true
      }
    } else {
      const pendingPrompt = parseReminderPromptOnly(content, pendingReminderDraft.partialPrompt)
      if (pendingPrompt) {
        parsedReminderIntent = {
          kind: 'create',
          draft: buildReminderDraftFromPrompt(pendingPrompt, pendingReminderDraft.schedule),
        }
      } else {
        shouldClearPendingDraft = true
      }
    }
  }

  if (
    parsedReminderIntent
    && parsedReminderIntent.kind !== 'clarify_time'
    && parsedReminderIntent.kind !== 'clarify_prompt'
  ) {
    shouldClearPendingDraft = true
  }

  return {
    intent: parsedReminderIntent,
    shouldClearPendingDraft,
  }
}

export function createLocalReminderActionRunner(dependencies: LocalReminderActionDependencies) {
  return async function runLocalReminderAction(options: LocalReminderActionOptions) {
    const parsedIntent = options.intent
    if (!parsedIntent) {
      return false
    }

    const appendReminderDebugEvent = (
      title: string,
      detail: string,
      tone: DebugConsoleEventDraft['tone'] = 'info',
      relatedTaskId?: string,
    ) => {
      dependencies.ctx.appendDebugConsoleEvent({
        source: 'reminder',
        title,
        detail,
        tone,
        relatedTaskId,
      })
    }

    const speakContentSafely = (text: string) => (
      options.fromVoice && dependencies.ctx.suppressVoiceReplyRef.current
        ? ''
        : text
    )

    const finishVoiceTurn = (detail: string) => {
      if (!options.fromVoice) {
        return
      }

      dependencies.ctx.updateVoicePipeline('reply_received', detail, options.content)
      dependencies.ctx.appendVoiceTrace('Local task handled', `#${options.traceLabel} ${shorten(detail, 36)}`, 'success')
    }

    const maybeResumeVoice = () => {
      if (options.shouldResumeContinuousVoice) {
        dependencies.ctx.scheduleVoiceRestart(t('chat.reminder.voice_resume_hint'), 520, true)
      }
    }

    appendReminderDebugEvent(
      'Local reminder intent matched',
      `${options.fromVoice ? 'voice' : 'text'} / ${shorten(options.content, 48)}`,
    )
    dependencies.setAssistantActivity('scheduling')

    try {
      if (parsedIntent.kind === 'list') {
        const tasks = dependencies.ctx.reminderTasksRef.current
        const taskCount = tasks.length

        await dependencies.pushCompanionNotice({
          chatContent: buildReminderTaskDigest(tasks),
          bubbleContent: taskCount
            ? t('chat.reminder.list.bubble_with_count', { count: taskCount })
            : t('chat.reminder.list.bubble_empty'),
          speechContent: speakContentSafely(
            taskCount
              ? t('chat.reminder.list.speech_with_count', { count: taskCount })
              : t('chat.reminder.list.speech_empty'),
          ),
          autoHideMs: 14_000,
        })

        finishVoiceTurn(taskCount
          ? t('chat.reminder.list.trace_with_count', { count: taskCount })
          : t('chat.reminder.list.trace_empty'))
        appendReminderDebugEvent(
          'Task center listed',
          taskCount ? `Current task count: ${taskCount}` : 'No saved tasks right now',
          'success',
        )
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'clarify_time') {
        dependencies.setPendingReminderDraft({
          kind: 'missing_time',
          ...parsedIntent.draft,
        })

        const clarificationMessage = options.fromVoice
          ? t('chat.reminder.clarify_time.voice', { title: parsedIntent.draft.title })
          : t('chat.reminder.clarify_time.text', { title: parsedIntent.draft.title })

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            t('chat.reminder.clarify_time.speech', { title: parsedIntent.draft.title }),
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(t('chat.reminder.clarify_time.trace', { title: parsedIntent.draft.title }))
        appendReminderDebugEvent(
          'Waiting for reminder time',
          `${parsedIntent.draft.title} / ${shorten(parsedIntent.originalText, 36)}`,
          'info',
        )
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'clarify_prompt') {
        dependencies.setPendingReminderDraft({
          kind: 'missing_prompt',
          schedule: parsedIntent.draft.schedule,
          enabled: parsedIntent.draft.enabled,
          partialPrompt: parsedIntent.draft.partialPrompt,
        })

        const promptPreview = `${parsedIntent.draft.partialPrompt}...`
        const clarificationMessage = options.fromVoice
          ? t('chat.reminder.clarify_prompt.voice', { preview: promptPreview })
          : t('chat.reminder.clarify_prompt.text', { preview: promptPreview })

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            t('chat.reminder.clarify_prompt.speech', { partial: parsedIntent.draft.partialPrompt }),
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(t('chat.reminder.clarify_prompt.trace', { preview: promptPreview }))
        appendReminderDebugEvent(
          'Waiting for reminder content',
          `${promptPreview} / ${shorten(parsedIntent.originalText, 36)}`,
          'info',
        )
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'create') {
        dependencies.clearPendingReminderDraft()
        const createdTask = dependencies.ctx.addReminderTask(parsedIntent.draft)
        if (!createdTask) {
          throw new Error(t('chat.reminder.create.failed'))
        }

        const scheduleSummary = formatReminderScheduleSummaryForUi(createdTask, getLocale())
        const nextRunLabel = formatReminderNextRunLabel(createdTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            t('chat.reminder.create.chat_title', { title: createdTask.title }),
            t('chat.reminder.create.plan_line', { summary: scheduleSummary }),
            nextRunLabel ? t('chat.reminder.create.first_run_line', { label: nextRunLabel }) : '',
            t('chat.reminder.create.content_line', { content: createdTask.prompt }),
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? t('chat.reminder.create.bubble_with_next', { title: createdTask.title, label: nextRunLabel })
            : t('chat.reminder.create.bubble_without_next', { title: createdTask.title, summary: scheduleSummary }),
          speechContent: speakContentSafely(
            nextRunLabel
              ? t('chat.reminder.create.speech_with_next', { title: createdTask.title, label: nextRunLabel })
              : t('chat.reminder.create.speech_without_next', { title: createdTask.title, summary: scheduleSummary }),
          ),
        })

        finishVoiceTurn(t('chat.reminder.create.trace', { title: createdTask.title }))
        appendReminderDebugEvent(
          'Created local reminder',
          nextRunLabel
            ? `${createdTask.title} / ${scheduleSummary} / First run ${nextRunLabel}`
            : `${createdTask.title} / ${scheduleSummary}`,
          'success',
          createdTask.id,
        )
        maybeResumeVoice()
        return true
      }

      const matchedTask = findBestReminderTaskMatch(
        dependencies.ctx.reminderTasksRef.current,
        parsedIntent.targetText,
      )

      if (!matchedTask) {
        const missingTaskMessage = t('chat.reminder.not_found.chat', { target: parsedIntent.targetText })

        await dependencies.pushCompanionNotice({
          chatContent: missingTaskMessage,
          bubbleContent: missingTaskMessage,
          speechContent: speakContentSafely(
            t('chat.reminder.not_found.speech', { target: parsedIntent.targetText }),
          ),
          autoHideMs: 10_000,
        })

        finishVoiceTurn(t('chat.reminder.not_found.trace', { target: parsedIntent.targetText }))
        appendReminderDebugEvent('Matching task not found', parsedIntent.targetText, 'error')
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'remove') {
        const removedTask = dependencies.ctx.removeReminderTask(matchedTask.id) ?? matchedTask

        await dependencies.pushCompanionNotice({
          chatContent: t('chat.reminder.remove.chat', { title: removedTask.title }),
          bubbleContent: t('chat.reminder.remove.bubble', { title: removedTask.title }),
          speechContent: speakContentSafely(t('chat.reminder.remove.speech', { title: removedTask.title })),
        })

        finishVoiceTurn(t('chat.reminder.remove.trace', { title: removedTask.title }))
        appendReminderDebugEvent('Removed local reminder', removedTask.title, 'success', removedTask.id)
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'toggle') {
        const updatedTask = dependencies.ctx.updateReminderTask(matchedTask.id, {
          enabled: parsedIntent.enabled,
        }) ?? {
          ...matchedTask,
          enabled: parsedIntent.enabled,
        }
        const actionLabel = parsedIntent.enabled
          ? t('chat.reminder.toggle.enabled_label')
          : t('chat.reminder.toggle.paused_label')
        const nextRunLabel = formatReminderNextRunLabel(updatedTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            t('chat.reminder.toggle.chat_title', { action: actionLabel, title: updatedTask.title }),
            t('chat.reminder.create.plan_line', { summary: formatReminderScheduleSummaryForUi(updatedTask, getLocale()) }),
            nextRunLabel ? t('chat.reminder.toggle.next_run_line', { label: nextRunLabel }) : '',
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? t('chat.reminder.toggle.bubble_with_next', { action: actionLabel, title: updatedTask.title, label: nextRunLabel })
            : t('chat.reminder.toggle.bubble_without_next', { action: actionLabel, title: updatedTask.title }),
          speechContent: speakContentSafely(
            nextRunLabel
              ? t('chat.reminder.toggle.speech_with_next', { action: actionLabel, title: updatedTask.title, label: nextRunLabel })
              : t('chat.reminder.toggle.speech_without_next', { action: actionLabel, title: updatedTask.title }),
          ),
        })

        finishVoiceTurn(t('chat.reminder.toggle.trace', { action: actionLabel, title: updatedTask.title }))
        appendReminderDebugEvent(
          parsedIntent.enabled ? 'Enabled local reminder' : 'Paused local reminder',
          nextRunLabel ? `${updatedTask.title} / Next run ${nextRunLabel}` : updatedTask.title,
          'success',
          updatedTask.id,
        )
        maybeResumeVoice()
        return true
      }

      const updatedTask = dependencies.ctx.updateReminderTask(matchedTask.id, parsedIntent.updates) ?? {
        ...matchedTask,
        ...parsedIntent.updates,
      }
      const updatedSummary = formatReminderScheduleSummaryForUi(updatedTask, getLocale())
      const nextRunLabel = formatReminderNextRunLabel(updatedTask.nextRunAt)

      await dependencies.pushCompanionNotice({
        chatContent: [
          t('chat.reminder.update.chat_title', { title: updatedTask.title }),
          t('chat.reminder.create.plan_line', { summary: updatedSummary }),
          nextRunLabel ? t('chat.reminder.toggle.next_run_line', { label: nextRunLabel }) : '',
          t('chat.reminder.create.content_line', { content: updatedTask.prompt }),
        ].filter(Boolean).join('\n'),
        bubbleContent: nextRunLabel
          ? t('chat.reminder.update.bubble_with_next', { title: updatedTask.title, label: nextRunLabel })
          : t('chat.reminder.update.bubble_without_next', { title: updatedTask.title, summary: updatedSummary }),
        speechContent: speakContentSafely(
          nextRunLabel
            ? t('chat.reminder.update.speech_with_next', { title: updatedTask.title, label: nextRunLabel })
            : t('chat.reminder.update.speech_without_next', { title: updatedTask.title }),
        ),
      })

      finishVoiceTurn(t('chat.reminder.update.trace', { title: updatedTask.title }))
      appendReminderDebugEvent(
        'Updated local reminder',
        nextRunLabel
          ? `${updatedTask.title} / ${updatedSummary} / Next run ${nextRunLabel}`
          : `${updatedTask.title} / ${updatedSummary}`,
        'success',
        updatedTask.id,
      )
      maybeResumeVoice()
      return true
    } finally {
      dependencies.syncAssistantActivity()
    }
  }
}
