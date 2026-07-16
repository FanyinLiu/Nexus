import { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/onboarding-guide-shell.css'
import '../styles/onboarding-guide-responsive.css'
import '../styles/onboarding-guide-calm.css'
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
  getNextConnectionResultExpiryMs,
  isConnectionVerificationCurrent,
  type ConnectionVerificationRecord,
} from '../../models/connectionTestFreshness'
import {
  AiDisclosureStep,
  CompanionStep,
  MessageActionDemoStep,
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
  // Store fingerprint/evidence/checkedAt so readiness is derived from the
  // current draft + wall clock (not a sticky boolean that outlives the TTL).
  const [textConnectionVerification, setTextConnectionVerification] = useState<ConnectionVerificationRecord | null>(null)
  const [verificationFreshnessTick, setVerificationFreshnessTick] = useState(0)
  // Lives here (not in TextStep) because inactive steps unmount: the picked
  // tab must survive Next/Back. null = untouched, TextStep derives the
  // language default.
  const [textProviderRegion, setTextProviderRegion] = useState<ApiProviderPreset['region'] | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  useModalFocusTrap(dialogRef, open)
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)

  const onboardingSteps = useMemo(() => buildOnboardingSteps(draft.uiLanguage), [draft.uiLanguage])
  const step = onboardingSteps[stepIndex] ?? onboardingSteps[0]
  const isAiDisclosureStep = step.id === 'ai_disclosure'
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
  // Derived at render time from the verification record + current draft + wall clock
  // (not a sticky boolean, not memoized). Timer/focus updates bump
  // verificationFreshnessTick only to force a re-render so this call re-evaluates
  // TTL even when the record and draft object references are unchanged.
  const textConnectionVerified = isConnectionVerificationCurrent(
    textConnectionVerification,
    'text',
    draft,
  )

  useEffect(() => {
    if (!open) return

    setDraft(settings)
    setStepIndex(0)
    setSaving(false)
    setError(null)
    setRepairNotice(null)
    setTextConnectionVerification(null)
    setVerificationFreshnessTick(0)
    window.requestAnimationFrame(() => {
      dialogRef.current?.focus()
    })
  }, [open, settings])

  useEffect(() => {
    if (!open || !textConnectionVerification?.ok) return undefined
    const nextExpiry = getNextConnectionResultExpiryMs([textConnectionVerification])
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(
      () => setVerificationFreshnessTick((current) => current + 1),
      Math.max(0, nextExpiry - Date.now()) + 25,
    )
    return () => window.clearTimeout(timer)
  }, [open, textConnectionVerification, verificationFreshnessTick])

  useEffect(() => {
    if (!open) return undefined
    const refreshOnReturn = () => setVerificationFreshnessTick((current) => current + 1)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshOnReturn()
    }
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [open])

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

  function updateDraftFromStep(next: Parameters<typeof setDraft>[0]) {
    setDraft(next)
    setError(null)
    setRepairNotice(null)
  }

  function applyTextProviderPreset(providerId: string) {
    setTextConnectionVerification(null)
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
      setTextConnectionVerification(null)
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
    return onTestTextConnection(nextDraft)
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
            onTextConnectionVerificationChange={setTextConnectionVerification}
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
      case 'message_action_demo':
        return <MessageActionDemoStep uiLanguage={draft.uiLanguage} />
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
    <div className={`onboarding-backdrop onboarding-backdrop--${view} onboarding-backdrop--calm ${isAiDisclosureStep ? 'onboarding-backdrop--disclosure' : ''}`}>
      <section
        ref={dialogRef}
        className={`onboarding-card onboarding-card--${view} onboarding-card--calm ${isAiDisclosureStep ? 'onboarding-card--disclosure' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-dialog-title"
        aria-describedby="onboarding-dialog-description"
        tabIndex={-1}
      >
        <div className={`onboarding-card__header onboarding-card__header--calm ${isAiDisclosureStep ? 'onboarding-card__header--disclosure' : ''}`}>
          <p className="onboarding-disclosure__progress">
            {stepIndex + 1} / {onboardingSteps.length} · {ti('onboarding.eyebrow')}
          </p>

          <button
            className="onboarding-disclosure__dismiss"
            type="button"
            onClick={onDismiss}
            disabled={saving}
          >
            {ti('onboarding.dismiss')}
          </button>
        </div>

        <div className="onboarding-card__body">
          <div className={`onboarding-section ${isAiDisclosureStep ? 'onboarding-section--disclosure' : ''}`}>
            {isAiDisclosureStep ? null : (
              <div className="onboarding-section__intro">
                <h2 id="onboarding-dialog-title">{step.title}</h2>
                <p id="onboarding-dialog-description">{step.description}</p>
              </div>
            )}

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

        <div className={`onboarding-card__actions onboarding-card__actions--calm ${isAiDisclosureStep ? 'onboarding-card__actions--disclosure' : ''}`}>
          {isAiDisclosureStep ? null : (
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
          )}

          {stepIndex < lastStepIndex ? (
            <button className="primary-button" type="button" onClick={goNextStep} disabled={saving}>
              {isAiDisclosureStep ? ti('onboarding.ai_disclosure.continue_note') : ti('onboarding.next')}
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
