import { useEffect, useMemo, useState } from 'react'
import {
  apiProviderRequiresApiKey,
  getApiProviderPreset,
} from '../../../lib/apiProviders'
import {
  getFallbackSpeechOutputVoices,
  getSpeechInputModelOptions,
  getSpeechInputProviderPreset,
  getSpeechOutputModelOptions,
  getSpeechOutputProviderPreset,
  isVolcengineSpeechOutputProvider,
} from '../../../lib/audioProviders'
import {
  switchSpeechInputProvider,
  switchSpeechOutputProvider,
} from '../../../lib/speechProviderProfiles'
import { switchTextProvider } from '../../../lib/textProviderProfiles'
import type { AppSettings, PlatformProfile, WindowView } from '../../../types'
import type { PetModelDefinition } from '../../pet'
import {
  AiDisclosureStep,
  CompanionStep,
  TextStep,
  VoiceStep,
  WelcomeStep,
} from './guideSteps'
import { recordDisclosureAck } from '../../safety/disclosureState'
import {
  buildOnboardingSteps,
  getOnboardingFinishHint,
  getOnboardingStepError,
  sanitizeOnboardingSettings,
} from './onboardingGuideSupport'
import { pickTranslatedUiText } from '../../../lib/uiLanguage'

export type OnboardingGuideProps = {
  open: boolean
  view: WindowView
  settings: AppSettings
  platformProfile: PlatformProfile
  petModelPresets: PetModelDefinition[]
  onDismiss: () => void
  onSave: (settings: AppSettings) => Promise<void>
}

export function OnboardingGuide({
  open,
  view,
  settings,
  platformProfile,
  petModelPresets,
  onDismiss,
  onSave,
}: OnboardingGuideProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)

  const onboardingSteps = useMemo(() => buildOnboardingSteps(draft.uiLanguage), [draft.uiLanguage])
  const step = onboardingSteps[stepIndex] ?? onboardingSteps[0]
  const lastStepIndex = onboardingSteps.length - 1
  const textProvider = getApiProviderPreset(draft.apiProviderId)
  const speechInputProvider = getSpeechInputProviderPreset(draft.speechInputProviderId)
  const speechOutputProvider = getSpeechOutputProviderPreset(draft.speechOutputProviderId)
  const speechInputModelOptions = getSpeechInputModelOptions(draft.speechInputProviderId)
  const speechOutputModelOptions = getSpeechOutputModelOptions(draft.speechOutputProviderId)
  const speechOutputVoiceOptions = getFallbackSpeechOutputVoices(draft.speechOutputProviderId)
  const isVolcengineSpeechOutput = isVolcengineSpeechOutputProvider(draft.speechOutputProviderId)
  const selectedPetModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]
  const finishHint = getOnboardingFinishHint(
    draft,
    apiProviderRequiresApiKey(draft.apiProviderId),
    draft.uiLanguage,
  )

  useEffect(() => {
    if (!open) return

    setDraft(settings)
    setStepIndex(0)
    setSaving(false)
    setError(null)
  }, [open, settings])

  useEffect(() => {
    if (!petModelPresets.length) return

    setDraft((current) => (
      petModelPresets.some((preset) => preset.id === current.petModelId)
        ? current
        : {
            ...current,
            petModelId: petModelPresets[0].id,
          }
    ))
  }, [petModelPresets])

  function applyTextProviderPreset(providerId: string) {
    setDraft((current) => switchTextProvider(current, providerId))
  }

  function applySpeechInputPreset(providerId: string) {
    setDraft((current) => switchSpeechInputProvider(current, providerId))
  }

  function applySpeechOutputPreset(providerId: string) {
    setDraft((current) => switchSpeechOutputProvider(current, providerId))
  }

  function goNextStep() {
    const nextError = getOnboardingStepError(draft, step.id, draft.uiLanguage)
    if (nextError) {
      setError(nextError)
      return
    }

    setError(null)
    setStepIndex((current) => Math.min(lastStepIndex, current + 1))
  }

  async function handleFinish() {
    const nextError = getOnboardingStepError(draft, step.id, draft.uiLanguage)
    if (nextError) {
      setError(nextError)
      return
    }

    setSaving(true)
    setError(null)

    try {
      await onSave(sanitizeOnboardingSettings(draft, settings))
      // Reaching the finish step implies the user clicked through the
      // ai_disclosure step at the start. Record the consent timestamp
      // for SB 243 / NY / EU AI Act compliance audit. Idempotent —
      // re-running onboarding does not overwrite the earlier ack.
      recordDisclosureAck()
      onDismiss()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ti('onboarding.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  function renderStepContent() {
    switch (step.id) {
      case 'ai_disclosure':
        return <AiDisclosureStep draft={draft} />
      case 'welcome':
        return (
          <WelcomeStep
            draft={draft}
            setDraft={setDraft}
          />
        )
      case 'text':
        return (
          <TextStep
            draft={draft}
            setDraft={setDraft}
            textProvider={textProvider}
            onApplyTextProviderPreset={applyTextProviderPreset}
          />
        )
      case 'voice':
        return (
          <VoiceStep
            draft={draft}
            setDraft={setDraft}
            speechInputProvider={speechInputProvider}
            speechOutputProvider={speechOutputProvider}
            speechInputModelOptions={speechInputModelOptions}
            speechOutputModelOptions={speechOutputModelOptions}
            speechOutputVoiceOptions={speechOutputVoiceOptions}
            isVolcengineSpeechOutput={isVolcengineSpeechOutput}
            onApplySpeechInputPreset={applySpeechInputPreset}
            onApplySpeechOutputPreset={applySpeechOutputPreset}
          />
        )
      case 'companion':
      default:
        return (
          <CompanionStep
            draft={draft}
            setDraft={setDraft}
            petModelPresets={petModelPresets}
            selectedPetModel={selectedPetModel}
            launchOnStartupSupported={platformProfile.startup.supported}
            finishHint={finishHint}
          />
        )
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className={`onboarding-backdrop onboarding-backdrop--${view}`}>
      <section className={`onboarding-card onboarding-card--${view}`}>
        <div className="onboarding-card__header">
          <div>
            <p className="eyebrow">{ti('onboarding.eyebrow')}</p>
            <h2>{ti('onboarding.title')}</h2>
            <p className="onboarding-card__copy">
              {ti('onboarding.body')}
            </p>
          </div>

          <button className="ghost-button" type="button" onClick={onDismiss} disabled={saving}>
            {ti('onboarding.dismiss')}
          </button>
        </div>

        <div className="onboarding-stepper">
          {onboardingSteps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`onboarding-stepper__item ${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-complete' : ''}`}
              onClick={() => {
                if (index > stepIndex) return
                setStepIndex(index)
                setError(null)
              }}
              disabled={index > stepIndex || saving}
            >
              <span>{index + 1}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </div>

        <div className="onboarding-card__body">
          <div className="onboarding-section">
            <div className="onboarding-section__intro">
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>

            {renderStepContent()}

            {error ? <div className="settings-test-result is-error">{error}</div> : null}
          </div>
        </div>

        <div className="onboarding-card__actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setStepIndex((current) => Math.max(0, current - 1))
              setError(null)
            }}
            disabled={stepIndex === 0 || saving}
          >
            {ti('onboarding.prev')}
          </button>

          {stepIndex < lastStepIndex ? (
            <button className="primary-button" type="button" onClick={goNextStep} disabled={saving}>
              {ti('onboarding.next')}
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => void handleFinish()} disabled={saving}>
              {saving ? ti('onboarding.finishing') : ti('onboarding.finish')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
