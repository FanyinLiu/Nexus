import {
  buildReminderDraftFromPrompt,
  buildReminderTaskDigest,
  findBestReminderTaskMatch,
  parseReminderIntent,
  parseReminderPromptOnly,
  parseReminderScheduleOnly,
  type ParsedReminderIntent,
} from '../../features/reminders/parseReminderIntent.ts'
import { formatReminderScheduleSummary } from '../../features/reminders/schedule.ts'
import { shorten } from '../../lib/common'
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
  resetToolPlannerContext: () => void
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
        dependencies.ctx.scheduleVoiceRestart('The local task is done. You can keep talking.', 520, true)
      }
    }

    dependencies.resetToolPlannerContext()
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
            ? `There are ${taskCount} local tasks right now. I have listed them in chat.`
            : 'The local task center is still empty.',
          speechContent: speakContentSafely(
            taskCount
              ? `Okay. There are ${taskCount} local tasks right now. I have listed them for you.`
              : 'Okay. The local task center is still empty.',
          ),
          autoHideMs: 14_000,
        })

        finishVoiceTurn(taskCount ? `Task center listed: ${taskCount} tasks` : 'Task center is empty')
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
          ? `I know you want a reminder for "${parsedIntent.draft.title}", but the time is still unclear. You can add something like "in five minutes" or "tonight at nine".`
          : `I know you want to create "${parsedIntent.draft.title}", but it still needs a specific time. You can add something like "in five minutes" or "tonight at nine".`

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            `Okay. I know you want a reminder for ${parsedIntent.draft.title}, but the time is still unclear. You can say something like in five minutes, or tonight at nine.`,
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(`Waiting for reminder time: ${parsedIntent.draft.title}`)
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
          ? `I only caught the first half of the reminder content: "${promptPreview}". You can finish it with something like "drink water" or "check the weather".`
          : `The reminder content is still incomplete. Right now I only have "${promptPreview}". You can finish it with something like "drink water" or "check the weather".`

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            `Okay. I only caught the first half of the reminder content: ${parsedIntent.draft.partialPrompt}. You can finish it with something like drink water.`,
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(`Waiting for reminder content: ${promptPreview}`)
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
          throw new Error('Failed to create the local task.')
        }

        const scheduleSummary = formatReminderScheduleSummary(createdTask)
        const nextRunLabel = formatReminderNextRunLabel(createdTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            `Created local task: ${createdTask.title}`,
            `Schedule: ${scheduleSummary}`,
            nextRunLabel ? `First run: ${nextRunLabel}` : '',
            `Content: ${createdTask.prompt}`,
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? `Saved "${createdTask.title}". It will first run at ${nextRunLabel}.`
            : `Saved "${createdTask.title}". ${scheduleSummary}.`,
          speechContent: speakContentSafely(
            nextRunLabel
              ? `Okay. I saved ${createdTask.title}. It will first run at ${nextRunLabel}.`
              : `Okay. I saved ${createdTask.title}. ${scheduleSummary}.`,
          ),
        })

        finishVoiceTurn(`Created task: ${createdTask.title}`)
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
        const missingTaskMessage = `I could not find a local task that matches "${parsedIntent.targetText}". You can try saying "show task center" first.`

        await dependencies.pushCompanionNotice({
          chatContent: missingTaskMessage,
          bubbleContent: missingTaskMessage,
          speechContent: speakContentSafely(
            `Okay. I could not find a local task that matches ${parsedIntent.targetText}.`,
          ),
          autoHideMs: 10_000,
        })

        finishVoiceTurn(`Task not found: ${parsedIntent.targetText}`)
        appendReminderDebugEvent('Matching task not found', parsedIntent.targetText, 'error')
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'remove') {
        const removedTask = dependencies.ctx.removeReminderTask(matchedTask.id) ?? matchedTask

        await dependencies.pushCompanionNotice({
          chatContent: `Removed local task: ${removedTask.title}`,
          bubbleContent: `Removed "${removedTask.title}".`,
          speechContent: speakContentSafely(`Okay. I removed ${removedTask.title}.`),
        })

        finishVoiceTurn(`Removed task: ${removedTask.title}`)
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
        const actionLabel = parsedIntent.enabled ? 'enabled' : 'paused'
        const nextRunLabel = formatReminderNextRunLabel(updatedTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} local task: ${updatedTask.title}`,
            `Schedule: ${formatReminderScheduleSummary(updatedTask)}`,
            nextRunLabel ? `Next run: ${nextRunLabel}` : '',
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} "${updatedTask.title}". Next run: ${nextRunLabel}.`
            : `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} "${updatedTask.title}".`,
          speechContent: speakContentSafely(
            nextRunLabel
              ? `Okay. I ${actionLabel === 'enabled' ? 'enabled' : 'paused'} ${updatedTask.title}. Next run: ${nextRunLabel}.`
              : `Okay. I ${actionLabel === 'enabled' ? 'enabled' : 'paused'} ${updatedTask.title}.`,
          ),
        })

        finishVoiceTurn(`${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} task: ${updatedTask.title}`)
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
      const updatedSummary = formatReminderScheduleSummary(updatedTask)
      const nextRunLabel = formatReminderNextRunLabel(updatedTask.nextRunAt)

      await dependencies.pushCompanionNotice({
        chatContent: [
          `Updated local task: ${updatedTask.title}`,
          `Schedule: ${updatedSummary}`,
          nextRunLabel ? `Next run: ${nextRunLabel}` : '',
          `Content: ${updatedTask.prompt}`,
        ].filter(Boolean).join('\n'),
        bubbleContent: nextRunLabel
          ? `Updated "${updatedTask.title}". Next run: ${nextRunLabel}.`
          : `Updated "${updatedTask.title}". ${updatedSummary}.`,
        speechContent: speakContentSafely(
          nextRunLabel
            ? `Okay. I updated ${updatedTask.title}. Next run: ${nextRunLabel}.`
            : `Okay. I updated ${updatedTask.title}.`,
        ),
      })

      finishVoiceTurn(`Updated task: ${updatedTask.title}`)
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
