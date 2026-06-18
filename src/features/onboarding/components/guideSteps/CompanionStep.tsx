import { useCallback, useMemo, useState } from 'react'
import { apiProviderRequiresApiKey } from '../../../../lib/apiProviders'
import {
  isSenseVoiceSpeechInputProvider,
  isSpeechOutputKeyless,
} from '../../../../lib/audioProviders'
import { RELATIONSHIP_OPTIONS } from '../../../../lib/relationshipTypes'
import {
  pickTranslatedUiText,
  pickTranslatedUiTextOrFallback,
} from '../../../../lib/uiLanguage'
import type {
  AppSettings,
  ChatMessage,
  PlatformProfile,
  ServiceConnectionResponse,
} from '../../../../types'
import {
  buildCompanionReadiness,
  type CompanionReadinessStatus,
} from '../../companionReadiness'
import {
  buildM1FirstRunAuditInput,
  buildM1FirstRunEvidenceReport,
  resolveM1FirstRunActionMessageKeys,
  type M1FirstRunEvidenceReport,
} from '../../firstRunAuditInput'
import type { PetModelDefinition } from '../../../pet'
import type { OnboardingDraftSetter } from './types'

type CompanionStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
  petModelPresets: PetModelDefinition[]
  selectedPetModel: PetModelDefinition | undefined
  launchOnStartupSupported: boolean
  finishHint: string
  platformProfile: PlatformProfile
  textConnectionResult?: ServiceConnectionResponse | null
  chatMessageSummaries?: Array<Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>>
}

function getModelSetupMessageKey(
  report: M1FirstRunEvidenceReport,
): Parameters<typeof pickTranslatedUiText>[1] {
  if (!report.modelSetup.connectionChecked) return 'onboarding.first_run_evidence.model.needs_check'
  if (report.modelSetup.providerReachable === false) return 'onboarding.first_run_evidence.model.unreachable'
  if (report.modelSetup.modelAvailable === false) return 'onboarding.first_run_evidence.model.unavailable'
  if (report.modelSetup.blockedReasonIds.length > 0) return 'onboarding.first_run_evidence.model.needs_repair'
  return 'onboarding.first_run_evidence.model.ready'
}

function getConversationMessageKey(
  report: M1FirstRunEvidenceReport,
): Parameters<typeof pickTranslatedUiText>[1] {
  if (!report.firstConversation.attempted) return 'onboarding.first_run_evidence.conversation.missing'
  if (!report.firstConversation.succeeded) return 'onboarding.first_run_evidence.conversation.failed'
  if (report.firstConversation.latencyWithinBudget === false) {
    return 'onboarding.first_run_evidence.conversation.slow'
  }
  return 'onboarding.first_run_evidence.conversation.ready'
}

function getNextActionMessageKey(
  report: M1FirstRunEvidenceReport,
): Parameters<typeof pickTranslatedUiText>[1] {
  if (report.nextActions.length === 0) return 'onboarding.first_run_evidence.next.done'
  if (report.nextActions.includes('check-text-provider-connection')) {
    return 'onboarding.first_run_evidence.next.test_model'
  }
  if (
    report.nextActions.includes('run-first-conversation-smoke')
    || report.nextActions.includes('retry-first-conversation-after-model-repair')
  ) {
    return 'onboarding.first_run_evidence.next.first_message'
  }
  if (report.modelSetup.repairActionIds.length > 0) {
    return 'onboarding.first_run_evidence.next.repair_model'
  }
  return 'onboarding.first_run_evidence.next.review'
}

export function CompanionStep({
  draft,
  setDraft,
  petModelPresets,
  selectedPetModel,
  launchOnStartupSupported,
  finishHint,
  platformProfile,
  textConnectionResult = null,
  chatMessageSummaries = [],
}: CompanionStepProps) {
  const [m1CopyState, setM1CopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
  const translatePetText = (value: string | undefined) => pickTranslatedUiTextOrFallback(draft.uiLanguage, value)
  const readiness = buildCompanionReadiness({
    userName: draft.userName,
    companionName: draft.companionName,
    apiBaseUrl: draft.apiBaseUrl,
    apiKey: draft.apiKey,
    model: draft.model,
    textProviderRequiresApiKey: apiProviderRequiresApiKey(draft.apiProviderId),
    petModelAvailable: Boolean(selectedPetModel),
    speechInputEnabled: draft.speechInputEnabled,
    speechInputProviderId: draft.speechInputProviderId,
    speechInputApiBaseUrl: draft.speechInputApiBaseUrl,
    speechInputUsesLocalRuntime: isSenseVoiceSpeechInputProvider(draft.speechInputProviderId),
    speechOutputEnabled: draft.speechOutputEnabled,
    speechOutputProviderId: draft.speechOutputProviderId,
    speechOutputApiBaseUrl: draft.speechOutputApiBaseUrl,
    speechOutputRequiresApiBaseUrl: !isSpeechOutputKeyless(draft.speechOutputProviderId),
    continuousVoiceModeEnabled: draft.continuousVoiceModeEnabled,
    autonomyNotificationsEnabled: draft.autonomyNotificationsEnabled,
    macosMessageWatcherEnabled: draft.macosMessageWatcherEnabled,
    autonomyNotificationMessagePreviewEnabled: draft.autonomyNotificationMessagePreviewEnabled,
    telegramAnnounceMessagePreview: draft.telegramAnnounceMessagePreview,
    discordAnnounceMessagePreview: draft.discordAnnounceMessagePreview,
  })
  const readinessStatusKey: Record<CompanionReadinessStatus, Parameters<typeof pickTranslatedUiText>[1]> = {
    ready: 'onboarding.readiness.ready',
    warning: 'onboarding.readiness.warning',
    blocked: 'onboarding.readiness.blocked',
  }
  const m1Report = useMemo(() => buildM1FirstRunEvidenceReport(
    buildM1FirstRunAuditInput({
      companionHealth: {
        platformProfile,
        petModel: selectedPetModel,
        settings: draft,
        voicePipeline: {
          detail: 'Onboarding preview.',
          step: 'idle',
          updatedAt: 'onboarding-preview',
        },
        voiceState: 'idle',
      },
      textConnectionResult,
      chatMessages: chatMessageSummaries,
    }),
    new Date().toISOString(),
    'runtime-onboarding-summary',
  ), [
    chatMessageSummaries,
    draft,
    platformProfile,
    selectedPetModel,
    textConnectionResult,
  ])
  const m1Status = m1Report.ok ? 'ready' : 'warning'
  const m1ActionMessageKeys = useMemo(
    () => resolveM1FirstRunActionMessageKeys(m1Report, 3),
    [m1Report],
  )
  const m1CopyLabel = m1CopyState === 'copied'
    ? ti('onboarding.first_run_evidence.copy_copied')
    : m1CopyState === 'failed'
      ? ti('onboarding.first_run_evidence.copy_failed')
      : ti('onboarding.first_run_evidence.copy')

  const handleCopyM1Report = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setM1CopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(m1Report, null, 2))
      setM1CopyState('copied')
    } catch {
      setM1CopyState('failed')
    }

    window.setTimeout(() => {
      setM1CopyState('idle')
    }, 1800)
  }, [m1Report])

  return (
    <div className="onboarding-grid onboarding-grid--stack">
      <label>
        <span>{ti('onboarding.companion.model_label')}</span>
        <select
          value={draft.petModelId}
          onChange={(event) => setDraft((current) => ({
            ...current,
            petModelId: event.target.value,
          }))}
          disabled={!petModelPresets.length}
        >
          {petModelPresets.map((model) => (
                <option key={model.id} value={model.id}>
              {translatePetText(model.label)}
                </option>
              ))}
        </select>
      </label>

      <div className="onboarding-summary">
        <strong>{ti('onboarding.companion.current_label')}</strong>
        <p>
          {selectedPetModel
            ? `${translatePetText(selectedPetModel.label)} · ${translatePetText(selectedPetModel.description)}`
            : ti('onboarding.companion.no_models')}
        </p>
      </div>

      <div className="onboarding-relationship">
        <span className="onboarding-relationship__label">
          {ti('onboarding.companion.relationship_label')}
        </span>
        <div className="onboarding-relationship__options">
          {RELATIONSHIP_OPTIONS.map((opt) => {
            const isActive = draft.companionRelationshipType === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                className={`onboarding-relationship__chip${isActive ? ' is-active' : ''}`}
                onClick={() => setDraft((current) => ({
                  ...current,
                  companionRelationshipType: opt.value,
                }))}
              >
                {ti(opt.labelKey)}
              </button>
            )
          })}
        </div>
        <small className="onboarding-relationship__hint">
          {ti('onboarding.companion.relationship_hint')}
        </small>
      </div>

      <div className="onboarding-grid onboarding-grid--two">
        <label className="onboarding-toggle">
          <span>{ti('onboarding.companion.enable_continuous_voice')}</span>
          <input
            type="checkbox"
            checked={draft.continuousVoiceModeEnabled}
            onChange={(event) => setDraft((current) => ({
              ...current,
              continuousVoiceModeEnabled: event.target.checked,
            }))}
          />
        </label>

        <label className="onboarding-toggle">
          <span>{ti('onboarding.companion.launch_on_startup')}</span>
          <input
            type="checkbox"
            checked={draft.launchOnStartup}
            disabled={!launchOnStartupSupported}
            onChange={(event) => setDraft((current) => ({
              ...current,
              launchOnStartup: event.target.checked,
            }))}
          />
        </label>
      </div>

      <div className={`onboarding-readiness onboarding-readiness--${readiness.status}`}>
        <div className="onboarding-readiness__header">
          <strong>{ti('onboarding.readiness.title')}</strong>
          <span className={`onboarding-readiness__status onboarding-readiness__status--${readiness.status}`}>
            {ti(readinessStatusKey[readiness.status])}
          </span>
        </div>
        <p>{ti(readiness.summaryKey)}</p>
        <ul className="onboarding-readiness__list">
          {readiness.items.map((item) => (
            <li
              key={item.id}
              className={`onboarding-readiness__item onboarding-readiness__item--${item.status}`}
            >
              <span className="onboarding-readiness__dot" aria-hidden="true" />
              <span>{ti(item.messageKey)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`onboarding-first-run onboarding-first-run--${m1Status}`}>
        <div className="onboarding-readiness__header">
          <strong>{ti('onboarding.first_run_evidence.title')}</strong>
          <div className="onboarding-first-run__actions">
            <span className={`onboarding-readiness__status onboarding-readiness__status--${m1Status}`}>
              {m1Report.ok
                ? ti('onboarding.first_run_evidence.ready')
                : ti('onboarding.first_run_evidence.needs_work')}
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleCopyM1Report()}
            >
              {m1CopyLabel}
            </button>
          </div>
        </div>
        <p>{ti('onboarding.first_run_evidence.description')}</p>
        <ul className="onboarding-readiness__list">
          <li
            className={`onboarding-readiness__item onboarding-readiness__item--${
              m1Report.modelSetup.blockedReasonIds.length === 0 ? 'ready' : 'warning'
            }`}
          >
            <span className="onboarding-readiness__dot" aria-hidden="true" />
            <span>{ti(getModelSetupMessageKey(m1Report))}</span>
          </li>
          <li
            className={`onboarding-readiness__item onboarding-readiness__item--${
              m1Report.firstConversation.evidencePresent ? 'ready' : 'warning'
            }`}
          >
            <span className="onboarding-readiness__dot" aria-hidden="true" />
            <span>{ti(getConversationMessageKey(m1Report))}</span>
          </li>
          <li className="onboarding-readiness__item onboarding-readiness__item--ready">
            <span className="onboarding-readiness__dot" aria-hidden="true" />
            <span>{ti('onboarding.first_run_evidence.privacy')}</span>
          </li>
          <li className={`onboarding-readiness__item onboarding-readiness__item--${m1Report.ok ? 'ready' : 'warning'}`}>
            <span className="onboarding-readiness__dot" aria-hidden="true" />
            <span>{ti(getNextActionMessageKey(m1Report))}</span>
          </li>
        </ul>
        {m1ActionMessageKeys.length > 0 ? (
          <ul className="onboarding-first-run__repair-list">
            {m1ActionMessageKeys.map((key) => (
              <li key={key} className="onboarding-first-run__repair-item">
                {ti(key)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="onboarding-tip onboarding-tip--strong">{finishHint}</p>
    </div>
  )
}
