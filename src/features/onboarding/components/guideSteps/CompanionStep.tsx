import { apiProviderRequiresApiKey } from '../../../../lib/apiProviders'
import { isSenseVoiceSpeechInputProvider } from '../../../../lib/audioProviders'
import { RELATIONSHIP_OPTIONS } from '../../../../lib/relationshipTypes'
import { pickTranslatedUiText } from '../../../../lib/uiLanguage'
import type { AppSettings } from '../../../../types'
import {
  buildCompanionReadiness,
  type CompanionReadinessStatus,
} from '../../companionReadiness'
import type { PetModelDefinition } from '../../../pet'
import type { OnboardingDraftSetter } from './types'

type CompanionStepProps = {
  draft: AppSettings
  setDraft: OnboardingDraftSetter
  petModelPresets: PetModelDefinition[]
  selectedPetModel: PetModelDefinition | undefined
  finishHint: string
}

export function CompanionStep({
  draft,
  setDraft,
  petModelPresets,
  selectedPetModel,
  finishHint,
}: CompanionStepProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) =>
    pickTranslatedUiText(draft.uiLanguage, key)
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
    continuousVoiceModeEnabled: draft.continuousVoiceModeEnabled,
  })
  const readinessStatusKey: Record<CompanionReadinessStatus, Parameters<typeof pickTranslatedUiText>[1]> = {
    ready: 'onboarding.readiness.ready',
    warning: 'onboarding.readiness.warning',
    blocked: 'onboarding.readiness.blocked',
  }

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
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="onboarding-summary">
        <strong>{ti('onboarding.companion.current_label')}</strong>
        <p>
          {selectedPetModel
            ? `${selectedPetModel.label} · ${selectedPetModel.description}`
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

      <p className="onboarding-tip onboarding-tip--strong">{finishHint}</p>
    </div>
  )
}
