import type { TranslationKey } from '../../types'
import type {
  Image4CompanionActivityState,
  Image4CompanionState,
} from './image4CompanionState'

export const IMAGE4_ACTIVITY_LABEL_KEYS: Record<Image4CompanionActivityState, TranslationKey> = {
  idle: 'panel.activity.idle',
  context_available: 'panel.activity.context_available',
  preparing_reply: 'panel.activity.preparing_reply',
  speaking: 'panel.activity.speaking',
  done: 'panel.activity.done',
  needs_confirmation: 'panel.activity.needs_confirmation',
  blocked: 'panel.activity.blocked',
}

export function resolveImage4ActivityLabelKey(
  state: Pick<Image4CompanionState, 'activityState' | 'mode'>,
): TranslationKey {
  return state.mode === 'resting'
    ? 'panel.activity.quiet'
    : IMAGE4_ACTIVITY_LABEL_KEYS[state.activityState]
}
