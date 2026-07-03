import type { TranslationKey } from '../../types/i18n'

export type OnboardingMessageActionDemoStepId =
  | 'received'
  | 'hint'
  | 'decide'

export type OnboardingMessageActionDemoActionId =
  | 'snooze'
  | 'mark_important'
  | 'draft_reply'

export type OnboardingMessageActionDemoStep = {
  id: OnboardingMessageActionDemoStepId
  labelKey: TranslationKey
  descriptionKey: TranslationKey
}

export type OnboardingMessageActionDemoAction = {
  id: OnboardingMessageActionDemoActionId
  labelKey: TranslationKey
}

export type OnboardingMessageActionDemo = {
  sourceLabelKey: TranslationKey
  sourceValueKey: TranslationKey
  titleKey: TranslationKey
  introKey: TranslationKey
  privacyNoteKey: TranslationKey
  steps: readonly OnboardingMessageActionDemoStep[]
  actions: readonly OnboardingMessageActionDemoAction[]
}

export function buildOnboardingMessageActionDemo(): OnboardingMessageActionDemo {
  return {
    sourceLabelKey: 'onboarding.message_action_demo.source_label',
    sourceValueKey: 'onboarding.message_action_demo.source_value',
    titleKey: 'onboarding.message_action_demo.title',
    introKey: 'onboarding.message_action_demo.intro',
    privacyNoteKey: 'onboarding.message_action_demo.privacy_note',
    steps: [
      {
        id: 'received',
        labelKey: 'onboarding.message_action_demo.step.received.label',
        descriptionKey: 'onboarding.message_action_demo.step.received.description',
      },
      {
        id: 'hint',
        labelKey: 'onboarding.message_action_demo.step.hint.label',
        descriptionKey: 'onboarding.message_action_demo.step.hint.description',
      },
      {
        id: 'decide',
        labelKey: 'onboarding.message_action_demo.step.decide.label',
        descriptionKey: 'onboarding.message_action_demo.step.decide.description',
      },
    ],
    actions: [
      {
        id: 'snooze',
        labelKey: 'onboarding.message_action_demo.action.snooze',
      },
      {
        id: 'mark_important',
        labelKey: 'onboarding.message_action_demo.action.mark_important',
      },
      {
        id: 'draft_reply',
        labelKey: 'onboarding.message_action_demo.action.draft_reply',
      },
    ],
  }
}
