import {
  isSenseVoiceSpeechInputProvider,
  isSpeechOutputKeyless,
} from '../../../lib/audioProviders.ts'
import { pickTranslatedUiText } from '../../../lib/uiLanguage.ts'
import type { AppSettings } from '../../../types/app.ts'
import type { TranslationKey, UiLanguage } from '../../../types/i18n.ts'
import {
  runConnectionPreflight,
  type ConnectionPreflightRepair,
} from '../../models/connectionPreflight.ts'
import type { OnboardingStep, OnboardingStepId } from './guideSteps/types.ts'

export type OnboardingStepRepair = {
  label: string
  patch: ConnectionPreflightRepair
}

export type OnboardingStepIssue = {
  message: string
  recommendation?: string
  repair?: OnboardingStepRepair
}

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

function getTextConnectionPreflightFailure(
  draft: AppSettings,
  uiLanguage: UiLanguage,
  options: { skipMissingApiKey?: boolean } = {},
) {
  return runConnectionPreflight({
    providerId: draft.apiProviderId,
    apiKey: draft.apiKey,
    apiBaseUrl: draft.apiBaseUrl,
    model: draft.model,
    uiLanguage,
    skipMissingApiKey: options.skipMissingApiKey,
  })
}

function formatOnboardingIssue(issue: OnboardingStepIssue) {
  return issue.recommendation
    ? `${issue.message} ${issue.recommendation}`
    : issue.message
}

export function getOnboardingFinishHint(
  draft: AppSettings,
  textProviderRequiresApiKey: boolean,
  uiLanguage: UiLanguage,
) {
  if (textProviderRequiresApiKey && !draft.apiKey.trim()) {
    const preflightFail = getTextConnectionPreflightFailure(draft, uiLanguage)
    const repairHint = preflightFail?.status === 'needs_key'
      ? preflightFail.recommendation
      : undefined
    const baseHint = pickTranslatedUiText(uiLanguage, 'onboarding.finish_hint.missing_api_key')
    return repairHint ? `${baseHint} ${repairHint}` : baseHint
  }

  return pickTranslatedUiText(uiLanguage, 'onboarding.finish_hint.default')
}

export function getOnboardingStepError(
  draft: AppSettings,
  stepId: OnboardingStepId,
  uiLanguage: UiLanguage,
) {
  const issue = getOnboardingStepIssue(draft, stepId, uiLanguage)
  return issue ? formatOnboardingIssue(issue) : null
}

export function getOnboardingStepIssue(
  draft: AppSettings,
  stepId: OnboardingStepId,
  uiLanguage: UiLanguage,
): OnboardingStepIssue | null {
  const ti = (key: TranslationKey) => pickTranslatedUiText(uiLanguage, key)

  if (stepId === 'welcome') {
    if (!draft.userName.trim()) return { message: ti('onboarding.error.welcome.no_user_name') }
    if (!draft.companionName.trim()) return { message: ti('onboarding.error.welcome.no_companion_name') }
    return null
  }

  if (stepId === 'text') {
    const preflightFail = getTextConnectionPreflightFailure(draft, uiLanguage, {
      skipMissingApiKey: true,
    })
    if (preflightFail && preflightFail.status !== 'needs_key') {
      return {
        message: preflightFail.message,
        recommendation: preflightFail.recommendation,
        repair: preflightFail.repair
          ? {
              label: ti('onboarding.repair.apply_text_defaults'),
              patch: preflightFail.repair,
            }
          : undefined,
      }
    }
    return null
  }

  if (stepId === 'voice') {
    if (draft.speechInputEnabled) {
      if (!draft.speechInputProviderId.trim()) {
        return { message: ti('onboarding.error.voice.no_input_provider') }
      }
      if (
        !isSenseVoiceSpeechInputProvider(draft.speechInputProviderId)
        && !draft.speechInputApiBaseUrl.trim()
      ) {
        return { message: ti('onboarding.error.voice.no_input_api_base') }
      }
    }

    if (draft.speechOutputEnabled) {
      if (!draft.speechOutputProviderId.trim()) {
        return { message: ti('onboarding.error.voice.no_output_provider') }
      }
      if (
        !isSpeechOutputKeyless(draft.speechOutputProviderId)
        && !draft.speechOutputApiBaseUrl.trim()
      ) {
        return { message: ti('onboarding.error.voice.no_output_api_base') }
      }
    }

    return null
  }

  return null
}

export function applyOnboardingStepRepairDraft(
  draft: AppSettings,
  repair: OnboardingStepRepair,
): AppSettings {
  return {
    ...draft,
    ...repair.patch,
  }
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
