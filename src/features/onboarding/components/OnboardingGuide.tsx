import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalFocusTrap } from '../../../hooks/useModalFocusTrap'
import {
  apiProviderRequiresApiKey,
} from '../../../lib/apiProviders'
import type { ApiProviderPreset } from '../../../lib/apiProviders'
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
  applyOnboardingStepRepairDraft,
  buildOnboardingSteps,
  getOnboardingFinishHint,
  getOnboardingStepIssue,
  sanitizeOnboardingSettings,
  type OnboardingStepIssue,
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
  onTestTextConnection?: (settings: AppSettings) => Promise<import('../../../components/settingsDrawerSupport').ConnectionResult>
}

export function OnboardingGuide({
  open,
  view,
  settings,
  platformProfile,
  petModelPresets,
  onDismiss,
  onSave,
  onTestTextConnection,
}: OnboardingGuideProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<OnboardingStepIssue | null>(null)
  const [repairNotice, setRepairNotice] = useState<string | null>(null)
  const [textConnectionVerified, setTextConnectionVerified] = useState(false)
  // Lives here (not in TextStep) because inactive steps unmount: the picked
  // tab must survive Next/Back. null = untouched, TextStep derives the
  // language default.
  const [textProviderRegion, setTextProviderRegion] = useState<ApiProviderPreset['region'] | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const stepperItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  useModalFocusTrap(dialogRef, open)
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)

  const onboardingSteps = useMemo(() => buildOnboardingSteps(draft.uiLanguage), [draft.uiLanguage])
  const step = onboardingSteps[stepIndex] ?? onboardingSteps[0]
  const lastStepIndex = onboardingSteps.length - 1
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
    setRepairNotice(null)
    setTextConnectionVerified(false)
    window.requestAnimationFrame(() => {
      dialogRef.current?.focus()
    })
  }, [open, settings])

  useEffect(() => {
    if (!open || saving) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDismiss()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss, open, saving])

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

  useEffect(() => {
    if (!open) return

    window.requestAnimationFrame(() => {
      stepperItemRefs.current[stepIndex]?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    })
  }, [open, stepIndex])

  function updateDraftFromStep(next: Parameters<typeof setDraft>[0]) {
    setDraft(next)
    setError(null)
    setRepairNotice(null)
  }

  function applyTextProviderPreset(providerId: string) {
    setTextConnectionVerified(false)
    setDraft((current) => switchTextProvider(current, providerId))
    setError(null)
    setRepairNotice(null)
  }

  function applySpeechInputPreset(providerId: string) {
    setDraft((current) => switchSpeechInputProvider(current, providerId))
    setError(null)
    setRepairNotice(null)
  }

  function applySpeechOutputPreset(providerId: string) {
    setDraft((current) => switchSpeechOutputProvider(current, providerId))
    setError(null)
    setRepairNotice(null)
  }

  function applyOnboardingRepair(repair: OnboardingStepIssue['repair']) {
    if (!repair) return
    if (step.id === 'text') {
      setTextConnectionVerified(false)
    }
    const nextDraft = applyOnboardingStepRepairDraft(draft, repair)
    const remainingIssue = getOnboardingStepIssue(nextDraft, step.id, nextDraft.uiLanguage)
    setDraft(nextDraft)
    if (remainingIssue) {
      setError(remainingIssue)
      setRepairNotice(null)
      return
    }
    setError(null)
    setRepairNotice(ti('onboarding.repair.applied_text_defaults'))
  }

  function goNextStep() {
    const nextError = getOnboardingStepIssue(draft, step.id, draft.uiLanguage)
    if (nextError) {
      setError(nextError)
      return
    }

    setError(null)
    setRepairNotice(null)
    setStepIndex((current) => Math.min(lastStepIndex, current + 1))
  }

  async function handleFinish() {
    const nextError = getOnboardingStepIssue(draft, step.id, draft.uiLanguage)
    if (nextError) {
      setError(nextError)
      return
    }

    setSaving(true)
    setError(null)
    setRepairNotice(null)

    try {
      await onSave(sanitizeOnboardingSettings(draft, settings))
      // Reaching the finish step implies the user clicked through the
      // ai_disclosure step at the start. Record the consent timestamp
      // for SB 243 / NY / EU AI Act compliance audit. Idempotent —
      // re-running onboarding does not overwrite the earlier ack.
      recordDisclosureAck()
      onDismiss()
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : ti('onboarding.save_failed') })
    } finally {
      setSaving(false)
    }
  }

  async function testOnboardingTextConnection(nextDraft: AppSettings) {
    if (!onTestTextConnection) {
      return { ok: false, message: ti('settings.test_connection.unsupported') }
    }

    try {
      const result = await onTestTextConnection(nextDraft)
      setTextConnectionVerified(result.ok)
      return result
    } catch (caught) {
      setTextConnectionVerified(false)
      throw caught
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
            setDraft={updateDraftFromStep}
          />
        )
      case 'text':
        return (
          <TextStep
            draft={draft}
            setDraft={updateDraftFromStep}
            onApplyTextProviderPreset={applyTextProviderPreset}
            regionTab={textProviderRegion}
            onRegionTabChange={setTextProviderRegion}
            onTestConnection={onTestTextConnection ? testOnboardingTextConnection : undefined}
            onTextConnectionConfigChanged={() => setTextConnectionVerified(false)}
          />
        )
      case 'voice':
        return (
          <VoiceStep
            draft={draft}
            setDraft={updateDraftFromStep}
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
            setDraft={updateDraftFromStep}
            petModelPresets={petModelPresets}
            selectedPetModel={selectedPetModel}
            launchOnStartupSupported={platformProfile.startup.supported}
            finishHint={finishHint}
            textConnectionVerified={textConnectionVerified}
          />
        )
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className={`onboarding-backdrop onboarding-backdrop--${view}`}>
      <section
        ref={dialogRef}
        className={`onboarding-card onboarding-card--${view}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-dialog-title"
        aria-describedby="onboarding-dialog-description"
        tabIndex={-1}
      >
        <div className="onboarding-card__header">
          <div>
            <p className="eyebrow">{ti('onboarding.eyebrow')}</p>
            <h2 id="onboarding-dialog-title">{ti('onboarding.title')}</h2>
            <p id="onboarding-dialog-description" className="onboarding-card__copy">
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
              ref={(node) => {
                stepperItemRefs.current[index] = node
              }}
              type="button"
              className={`onboarding-stepper__item ${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-complete' : ''}`}
              aria-current={index === stepIndex ? 'step' : undefined}
              onClick={() => {
                if (index > stepIndex) return
                setStepIndex(index)
                setError(null)
                setRepairNotice(null)
              }}
              disabled={index > stepIndex || saving}
              title={item.title}
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

            {error ? (
              <div
                className="settings-test-result is-error"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                <p>{error.message}</p>
                {error.recommendation ? (
                  <p className="settings-test-result__recommendation">{error.recommendation}</p>
                ) : null}
                {error.repair ? (
                  <button
                    type="button"
                    className="ghost-button settings-test-result__action"
                    onClick={() => applyOnboardingRepair(error.repair)}
                    disabled={saving}
                  >
                    {error.repair.label}
                  </button>
                ) : null}
              </div>
            ) : null}
            {!error && repairNotice ? (
              <div
                className="settings-test-result is-success"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <p>{repairNotice}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="onboarding-card__actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setStepIndex((current) => Math.max(0, current - 1))
              setError(null)
              setRepairNotice(null)
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
