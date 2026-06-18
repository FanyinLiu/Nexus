import type { BracketKind } from './bracketScheduler.ts'
import type { UiLanguage } from '../../types'

type CareOutcome = 'fired' | 'skipped' | 'error'

function isChinese(uiLanguage: UiLanguage): boolean {
  return String(uiLanguage).startsWith('zh')
}

export function formatAwayCareVisibleReason(input: {
  hasLastUserMessage: boolean
  outcome: CareOutcome
  reason: string
  thresholdMinutes: number
  uiLanguage: UiLanguage
}): string {
  const zh = isChinese(input.uiLanguage)
  if (input.outcome === 'error') {
    return zh
      ? 'Nexus 想发送离开关怀，但系统通知没有送达。'
      : 'Nexus tried to send an away check-in, but the notification did not go through.'
  }
  if (input.outcome === 'fired') {
    return zh
      ? `你已经离开超过 ${input.thresholdMinutes} 分钟，所以 Nexus 轻轻出现了一下。`
      : `You had been away for more than ${input.thresholdMinutes} minutes, so Nexus showed up gently.`
  }
  if (input.reason === 'panel_open') {
    return zh
      ? '设置面板已经打开，所以 Nexus 保持安静。'
      : 'Nexus stayed quiet because the settings panel was already open.'
  }
  if (input.reason === 'no_activity_yet' || !input.hasLastUserMessage) {
    return zh
      ? '还没有可参考的近期对话，所以 Nexus 没有贸然打扰。'
      : 'Nexus stayed quiet because there was no recent user message to anchor a check-in.'
  }
  if (input.reason === 'below_threshold') {
    return zh
      ? `离开的时间还没到 ${input.thresholdMinutes} 分钟，Nexus 先不打扰。`
      : `Nexus stayed quiet because the away threshold of ${input.thresholdMinutes} minutes was not reached.`
  }
  if (input.reason === 'in_cooldown') {
    return zh
      ? '上一条关怀还在冷却时间里，所以 Nexus 没有重复出现。'
      : 'Nexus stayed quiet because the previous check-in was still cooling down.'
  }
  if (input.reason === 'quiet_hours') {
    return zh
      ? '当前处于安静时间，所以 Nexus 没有弹出关怀。'
      : 'Nexus stayed quiet because quiet hours were active.'
  }
  return zh
    ? '这次离开关怀被静默规则拦截了。'
    : 'This away check-in was blocked by a quiet rule.'
}

export function formatBracketCareVisibleReason(input: {
  bracket?: BracketKind
  deliveredErrand: boolean
  outcome: CareOutcome
  reason: string
  uiLanguage: UiLanguage
}): string {
  const zh = isChinese(input.uiLanguage)
  if (input.outcome === 'error') {
    return zh
      ? 'Nexus 想发送早晚关怀，但系统通知没有送达。'
      : 'Nexus tried to send the daily bracket, but the notification did not go through.'
  }
  if (input.outcome === 'fired') {
    if (input.deliveredErrand) {
      return zh
        ? '有一件已完成事项适合在早间关怀里交还给你。'
        : 'A completed errand was ready to hand back during the morning check-in.'
    }
    return input.bracket === 'evening'
      ? (zh ? '现在是晚间回顾窗口，所以 Nexus 做了一次轻量收束。' : 'It was the evening reflection window, so Nexus made a light check-in.')
      : (zh ? '现在是早间开启窗口，所以 Nexus 做了一次轻量问候。' : 'It was the morning start window, so Nexus made a light check-in.')
  }
  if (input.reason === 'panel_open') {
    return zh
      ? '设置面板已经打开，所以早晚关怀保持安静。'
      : 'The daily bracket stayed quiet because the settings panel was already open.'
  }
  if (input.reason === 'outside_windows') {
    return zh
      ? '现在不在早间或晚间关怀窗口内。'
      : 'It was outside the morning and evening bracket windows.'
  }
  if (input.reason === 'morning_already_fired_today') {
    return zh
      ? '今天早间关怀已经出现过一次，所以不重复打扰。'
      : 'The morning bracket already fired today, so Nexus did not repeat it.'
  }
  if (input.reason === 'evening_already_fired_today') {
    return zh
      ? '今天晚间关怀已经出现过一次，所以不重复打扰。'
      : 'The evening bracket already fired today, so Nexus did not repeat it.'
  }
  if (input.reason === 'too_close_to_other_bracket') {
    return zh
      ? '两次早晚关怀离得太近，所以 Nexus 跳过了这次。'
      : 'The daily brackets were too close together, so Nexus skipped this one.'
  }
  if (input.reason === 'relationship_type_opted_out') {
    return zh
      ? '当前关系模式偏安静陪伴，所以 Nexus 跳过早晚关怀。'
      : 'The current relationship mode prefers quiet companionship, so Nexus skipped the daily bracket.'
  }
  return zh
    ? '这次早晚关怀被静默规则拦截了。'
    : 'This daily bracket was blocked by a quiet rule.'
}

export function formatOpenArcCareVisibleReason(input: {
  milestoneDay?: number
  openArcCount: number
  outcome: CareOutcome
  reason: string
  uiLanguage: UiLanguage
}): string {
  const zh = isChinese(input.uiLanguage)
  if (input.outcome === 'error') {
    return zh
      ? 'Nexus 想跟进一个未完事项，但系统通知没有送达。'
      : 'Nexus tried to follow up on an open arc, but the notification did not go through.'
  }
  if (input.outcome === 'fired') {
    return typeof input.milestoneDay === 'number'
      ? (zh ? `一个未完事项到了第 ${input.milestoneDay} 天的轻量跟进点。` : `An open arc reached its day ${input.milestoneDay} check-in.`)
      : (zh ? '一个未完事项到了适合轻量跟进的时间。' : 'An open arc reached a good moment for a light check-in.')
  }
  if (input.reason === 'quiet-hours') {
    return zh
      ? '当前处于安静时间，所以未完事项跟进被跳过。'
      : 'The open-arc check-in stayed quiet because quiet hours were active.'
  }
  if (input.reason === 'no-arcs') {
    return zh
      ? '当前没有开放中的事项需要跟进。'
      : 'There were no open arcs to follow up on.'
  }
  if (input.reason === 'all-checked-in') {
    return zh
      ? `已有 ${input.openArcCount} 个开放事项，但都还没到新的跟进点。`
      : `${input.openArcCount} open arc(s) were already caught up on check-ins.`
  }
  if (input.reason === 'no-milestone-due') {
    return zh
      ? '开放事项还没到下一个跟进里程碑。'
      : 'No open arc had reached its next check-in milestone yet.'
  }
  if (input.reason === 'arc_missing') {
    return zh
      ? '原本要跟进的事项已经不存在，所以 Nexus 跳过了。'
      : 'The arc selected for follow-up was no longer available.'
  }
  return zh
    ? '这次未完事项跟进被静默规则拦截了。'
    : 'This open-arc check-in was blocked by a quiet rule.'
}

export function formatFutureCapsuleCareVisibleReason(input: {
  outcome: CareOutcome
  reason: string
  uiLanguage: UiLanguage
}): string {
  const zh = isChinese(input.uiLanguage)
  if (input.outcome === 'error') {
    return zh
      ? 'Nexus 想递送未来胶囊，但系统通知没有送达。'
      : 'Nexus tried to deliver a future capsule, but the notification did not go through.'
  }
  if (input.outcome === 'fired') {
    return zh
      ? '有一个未来胶囊到了你设定的递送时间。'
      : 'A future capsule reached its scheduled delivery time.'
  }
  if (input.reason === 'no_due_capsule') {
    return zh
      ? '当前没有到期的未来胶囊，所以 Nexus 保持安静。'
      : 'No future capsule was due, so Nexus stayed quiet.'
  }
  return zh
    ? '这次未来胶囊递送被静默规则拦截了。'
    : 'This future-capsule delivery was blocked by a quiet rule.'
}
