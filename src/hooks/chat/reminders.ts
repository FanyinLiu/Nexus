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
        dependencies.ctx.scheduleVoiceRestart('本地任务已完成，你可以继续说。', 520, true)
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
            ? `现在有 ${taskCount} 个本地任务，已经列在聊天记录里了。`
            : '本地任务中心还没有任务。',
          speechContent: speakContentSafely(
            taskCount
              ? `好的，现在有 ${taskCount} 个本地任务，已经列出来了。`
              : '好的，本地任务中心还没有任务。',
          ),
          autoHideMs: 14_000,
        })

        finishVoiceTurn(taskCount ? `任务中心已列出：${taskCount} 个任务` : '任务中心为空')
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
          ? `我知道你想设置"${parsedIntent.draft.title}"的提醒，但时间还没说清楚。你可以补上，比如"五分钟后"或"今晚九点"。`
          : `想创建"${parsedIntent.draft.title}"的提醒，还需要一个具体时间。你可以补上，比如"五分钟后"或"今晚九点"。`

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            `好的，我知道你想设置${parsedIntent.draft.title}的提醒，但时间还没说清楚。你可以说五分钟后，或者今晚九点。`,
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(`等待补充提醒时间：${parsedIntent.draft.title}`)
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
          ? `我只听到了提醒内容的前半部分："${promptPreview}"。你可以把后面补上，比如"喝水"或"查天气"。`
          : `提醒内容还不完整，目前只有"${promptPreview}"。你可以把后面补上，比如"喝水"或"查天气"。`

        await dependencies.pushCompanionNotice({
          chatContent: clarificationMessage,
          bubbleContent: clarificationMessage,
          speechContent: speakContentSafely(
            `好的，我只听到了提醒内容的前半部分：${parsedIntent.draft.partialPrompt}。你可以把后面补上，比如喝水。`,
          ),
          autoHideMs: 12_000,
        })

        finishVoiceTurn(`等待补充提醒内容：${promptPreview}`)
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
          throw new Error('创建本地任务失败。')
        }

        const scheduleSummary = formatReminderScheduleSummary(createdTask)
        const nextRunLabel = formatReminderNextRunLabel(createdTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            `已创建本地任务：${createdTask.title}`,
            `计划：${scheduleSummary}`,
            nextRunLabel ? `首次执行：${nextRunLabel}` : '',
            `内容：${createdTask.prompt}`,
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? `已保存"${createdTask.title}"，首次执行时间：${nextRunLabel}。`
            : `已保存"${createdTask.title}"。${scheduleSummary}。`,
          speechContent: speakContentSafely(
            nextRunLabel
              ? `好的，已保存${createdTask.title}，首次执行时间：${nextRunLabel}。`
              : `好的，已保存${createdTask.title}。${scheduleSummary}。`,
          ),
        })

        finishVoiceTurn(`已创建任务：${createdTask.title}`)
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
        const missingTaskMessage = `没有找到匹配"${parsedIntent.targetText}"的本地任务。你可以先说"查看任务中心"看看有哪些任务。`

        await dependencies.pushCompanionNotice({
          chatContent: missingTaskMessage,
          bubbleContent: missingTaskMessage,
          speechContent: speakContentSafely(
            `好的，没有找到匹配${parsedIntent.targetText}的本地任务。`,
          ),
          autoHideMs: 10_000,
        })

        finishVoiceTurn(`未找到任务：${parsedIntent.targetText}`)
        appendReminderDebugEvent('Matching task not found', parsedIntent.targetText, 'error')
        maybeResumeVoice()
        return true
      }

      if (parsedIntent.kind === 'remove') {
        const removedTask = dependencies.ctx.removeReminderTask(matchedTask.id) ?? matchedTask

        await dependencies.pushCompanionNotice({
          chatContent: `已删除本地任务：${removedTask.title}`,
          bubbleContent: `已删除"${removedTask.title}"。`,
          speechContent: speakContentSafely(`好的，已删除${removedTask.title}。`),
        })

        finishVoiceTurn(`已删除任务：${removedTask.title}`)
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
        const actionLabel = parsedIntent.enabled ? '已启用' : '已暂停'
        const nextRunLabel = formatReminderNextRunLabel(updatedTask.nextRunAt)

        await dependencies.pushCompanionNotice({
          chatContent: [
            `${actionLabel}本地任务：${updatedTask.title}`,
            `计划：${formatReminderScheduleSummary(updatedTask)}`,
            nextRunLabel ? `下次执行：${nextRunLabel}` : '',
          ].filter(Boolean).join('\n'),
          bubbleContent: nextRunLabel
            ? `${actionLabel}"${updatedTask.title}"。下次执行：${nextRunLabel}。`
            : `${actionLabel}"${updatedTask.title}"。`,
          speechContent: speakContentSafely(
            nextRunLabel
              ? `好的，${actionLabel}${updatedTask.title}。下次执行：${nextRunLabel}。`
              : `好的，${actionLabel}${updatedTask.title}。`,
          ),
        })

        finishVoiceTurn(`${actionLabel}任务：${updatedTask.title}`)
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
          `已更新本地任务：${updatedTask.title}`,
          `计划：${updatedSummary}`,
          nextRunLabel ? `下次执行：${nextRunLabel}` : '',
          `内容：${updatedTask.prompt}`,
        ].filter(Boolean).join('\n'),
        bubbleContent: nextRunLabel
          ? `已更新"${updatedTask.title}"。下次执行：${nextRunLabel}。`
          : `已更新"${updatedTask.title}"。${updatedSummary}。`,
        speechContent: speakContentSafely(
          nextRunLabel
            ? `好的，已更新${updatedTask.title}。下次执行：${nextRunLabel}。`
            : `好的，已更新${updatedTask.title}。`,
        ),
      })

      finishVoiceTurn(`已更新任务：${updatedTask.title}`)
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
