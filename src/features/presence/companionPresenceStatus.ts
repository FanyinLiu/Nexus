import type {
  AssistantRuntimeActivity,
  FocusState,
  TranslationKey,
  VoiceState,
} from '../../types/index.ts'

type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string

export type CompanionPresenceStatusState =
  | 'resting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'away'
  | 'quiet'

export type CompanionPresenceStatusInput = {
  assistantActivity?: AssistantRuntimeActivity
  chatBusy?: boolean
  focusState?: FocusState
  now?: Date
  quietHoursEnd?: number
  quietHoursStart?: number
  quietReason?: string | null
  voiceState: VoiceState
}

export type CompanionPresenceStatus = {
  chipLabel: string
  quietReason: string | null
  state: CompanionPresenceStatusState
  statusLabel: string
  statusLabelKey: TranslationKey
}

function hasText(value: string | null | undefined): value is string {
  return Boolean(value?.trim())
}

function normalizeHour(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null
  const hour = Math.trunc(value as number)
  if (hour < 0 || hour > 23) return null
  return hour
}

function isInsideQuietHours(
  now: Date,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  const quietStart = normalizeHour(start)
  const quietEnd = normalizeHour(end)
  if (quietStart === null || quietEnd === null || quietStart === quietEnd) return false

  const hour = now.getHours()
  if (quietStart > quietEnd) return hour >= quietStart || hour < quietEnd
  return hour >= quietStart && hour < quietEnd
}

function chipKeyForState(state: CompanionPresenceStatusState): TranslationKey {
  if (state === 'resting') return 'panel.chip.resting'
  if (state === 'listening') return 'panel.chip.listening'
  if (state === 'speaking') return 'panel.chip.speaking'
  if (state === 'away') return 'panel.chip.away'
  if (state === 'quiet') return 'panel.chip.quiet'
  return 'panel.chip.thinking'
}

function activityStatusKey(activity: AssistantRuntimeActivity | undefined): TranslationKey {
  if (activity === 'searching') return 'panel.status.searching'
  if (activity === 'summarizing') return 'panel.status.summarizing'
  if (activity === 'scheduling') return 'panel.status.scheduling'
  return 'panel.status.thinking'
}

export function resolveCompanionPresenceStatus(
  input: CompanionPresenceStatusInput,
  ti: Translator,
): CompanionPresenceStatus {
  const assistantActivity = input.assistantActivity ?? 'idle'
  let state: CompanionPresenceStatusState = 'resting'
  let statusLabelKey: TranslationKey = 'panel.status.resting'
  let params: Record<string, string | number> | undefined
  let quietReason: string | null = null

  if (input.voiceState === 'speaking') {
    state = 'speaking'
    statusLabelKey = 'panel.status.speaking'
  } else if (input.voiceState === 'listening') {
    state = 'listening'
    statusLabelKey = 'panel.status.listening'
  } else if (input.voiceState === 'processing' || input.chatBusy || assistantActivity !== 'idle') {
    state = 'thinking'
    statusLabelKey = activityStatusKey(assistantActivity)
  } else if (hasText(input.quietReason)) {
    state = 'quiet'
    quietReason = input.quietReason.trim()
    statusLabelKey = 'panel.status.quiet_with_reason'
    params = { reason: quietReason }
  } else if (input.focusState === 'locked') {
    state = 'quiet'
    quietReason = ti('panel.status.quiet_locked_reason')
    statusLabelKey = 'panel.status.quiet_with_reason'
    params = { reason: quietReason }
  } else if (isInsideQuietHours(
    input.now ?? new Date(),
    input.quietHoursStart,
    input.quietHoursEnd,
  )) {
    state = 'quiet'
    quietReason = ti('panel.status.quiet_hours_reason')
    statusLabelKey = 'panel.status.quiet_with_reason'
    params = { reason: quietReason }
  } else if (input.focusState === 'away') {
    state = 'away'
    statusLabelKey = 'panel.status.away'
  }

  return {
    chipLabel: ti(chipKeyForState(state)),
    quietReason,
    state,
    statusLabel: ti(statusLabelKey, params),
    statusLabelKey,
  }
}
