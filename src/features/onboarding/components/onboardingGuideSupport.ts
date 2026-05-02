import {
  isSenseVoiceSpeechInputProvider,
  isSpeechOutputKeyless,
} from '../../../lib/audioProviders'
import { pickTranslatedUiText } from '../../../lib/uiLanguage'
import type { AppSettings, TranslationKey, UiLanguage } from '../../../types'
import type { OnboardingStep, OnboardingStepId } from './guideSteps'

// Step meta as translation-key tuples. The component builds the final
// localized list at render time so language switches reflow the stepper.
const ONBOARDING_STEP_KEYS: Array<{
  id: OnboardingStep['id']
  titleKey: TranslationKey
  descriptionKey: TranslationKey
}> = [
  // SB 243 / NY companion-AI / EU AI Act require an initial "clear
  // and conspicuous" disclosure before chat begins. Step 0 is the
  // place where the user can't have skipped it accidentally.
  { id: 'ai_disclosure', titleKey: 'onboarding.step.ai_disclosure.title', descriptionKey: 'onboarding.step.ai_disclosure.description' },
  { id: 'welcome', titleKey: 'onboarding.step.welcome.title', descriptionKey: 'onboarding.step.welcome.description' },
  { id: 'text', titleKey: 'onboarding.step.text.title', descriptionKey: 'onboarding.step.text.description' },
  { id: 'voice', titleKey: 'onboarding.step.voice.title', descriptionKey: 'onboarding.step.voice.description' },
  { id: 'companion', titleKey: 'onboarding.step.companion.title', descriptionKey: 'onboarding.step.companion.description' },
]

export function buildOnboardingSteps(uiLanguage: UiLanguage): OnboardingStep[] {
  return ONBOARDING_STEP_KEYS.map(({ id, titleKey, descriptionKey }) => ({
    id,
    title: pickTranslatedUiText(uiLanguage, titleKey),
    description: pickTranslatedUiText(uiLanguage, descriptionKey),
  }))
}

export function getOnboardingFinishHint(
  draft: AppSettings,
  textProviderRequiresApiKey: boolean,
  uiLanguage: UiLanguage,
) {
  if (textProviderRequiresApiKey && !draft.apiKey.trim()) {
    return pickTranslatedUiText(uiLanguage, 'onboarding.finish_hint.missing_api_key')
  }

  return pickTranslatedUiText(uiLanguage, 'onboarding.finish_hint.default')
}

export function getOnboardingStepError(
  draft: AppSettings,
  stepId: OnboardingStepId,
  uiLanguage: UiLanguage,
) {
  const ti = (key: TranslationKey) => pickTranslatedUiText(uiLanguage, key)

  if (stepId === 'welcome') {
    if (!draft.userName.trim()) return ti('onboarding.error.welcome.no_user_name')
    if (!draft.companionName.trim()) return ti('onboarding.error.welcome.no_companion_name')
    return null
  }

  if (stepId === 'text') {
    if (!draft.apiBaseUrl.trim()) return ti('onboarding.error.text.no_api_base')
    if (!draft.model.trim()) return ti('onboarding.error.text.no_model')
    return null
  }

  if (stepId === 'voice') {
    if (draft.speechInputEnabled) {
      if (!draft.speechInputProviderId.trim()) return ti('onboarding.error.voice.no_input_provider')
      if (
        !isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
        && !draft.speechInputApiBaseUrl.trim()
      ) {
        return ti('onboarding.error.voice.no_input_api_base')
      }
    }

    if (draft.speechOutputEnabled) {
      if (!draft.speechOutputProviderId.trim()) return ti('onboarding.error.voice.no_output_provider')
      if (
        !isSpeechOutputKeyless(draft.speechOutputProviderId)
        && !draft.speechOutputApiBaseUrl.trim()
      ) {
        return ti('onboarding.error.voice.no_output_api_base')
      }
    }

    return null
  }

  return null
}

export function sanitizeOnboardingSettings(
  draft: AppSettings,
  fallback: AppSettings,
) {
  return {
    ...draft,
    companionName: draft.companionName.trim() || fallback.companionName,
    userName: draft.userName.trim() || fallback.userName,
    apiBaseUrl: draft.apiBaseUrl.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
    speechInputApiBaseUrl: draft.speechInputApiBaseUrl.trim(),
    speechInputApiKey: draft.speechInputApiKey.trim(),
    speechOutputApiBaseUrl: draft.speechOutputApiBaseUrl.trim(),
    speechOutputApiKey: draft.speechOutputApiKey.trim(),
    speechOutputVoice: draft.speechOutputVoice.trim(),
  }
}
