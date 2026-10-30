import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { RELATIONSHIP_OPTIONS } from '../../lib/relationshipTypes.ts'
import { ChatStudioV3 } from './ChatStudioV3.tsx'
import type { PetModelDefinition } from '../pet'
import { pickTranslatedUiText, pickTranslatedUiTextOrFallback } from '../../lib/uiLanguage.ts'
import { setCompanionNameWithWakeWordSync } from '../hearing/companionWakeWordSync.ts'
import type { AppSettings, CompanionRelationshipType } from '../../types'
import type { ConfirmFn } from '../../components/useConfirm.ts'
import { CompanionThemePicker } from '../../components/CompanionThemePicker.tsx'
import {
  SettingsV3Disclosure,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
} from './SettingsV3Primitives.tsx'
import './settings-v3-collection.css'
import './chat-section-v3.css'

type StatusMessage = {
  ok: boolean
  message: string
  recommendation?: string
} | null

export type ChatSectionV3Props = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  confirm: ConfirmFn
  petModelPresets: PetModelDefinition[]
  importingPetModel: boolean
  petModelStatus: StatusMessage
  onImportPetModel: () => void
  surface?: 'full' | 'rest'
}

export const ChatSectionV3 = memo(function ChatSectionV3(props: ChatSectionV3Props) {
  const { draft, setDraft, petModelPresets } = props
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(draft.uiLanguage, key, params)
  const translatePetText = (value: string | undefined) =>
    pickTranslatedUiTextOrFallback(draft.uiLanguage, value)
  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]
  const petModelLabel = translatePetText(petModel?.label)
    || petModel?.label
    || ti('settings.chat.live2d_model')
  const importStatus = props.petModelStatus
  const rest = props.surface === 'rest'
  function selectRelationshipType(value: CompanionRelationshipType) {
    setDraft((prev) => ({ ...prev, companionRelationshipType: value }))
  }

  return (
    <SettingsV3Page className="settings-v3-chat">
      {rest ? null : (
        <>
          <SettingsV3Section title={ti('settings.appearance.label')}>
            <CompanionThemePicker
              themeId={draft.themeId}
              colorScheme={draft.themeColorScheme}
              language={draft.uiLanguage}
              onChange={(next) => setDraft((prev) => ({
                ...prev,
                themeId: next.themeId,
                themeColorScheme: next.colorScheme,
              }))}
            />
          </SettingsV3Section>
          <SettingsV3Section title={ti('settings.chat.companion_name')}>
            <div className="settings-v3-editor settings-v3-chat-identity">
              <SettingsV3Field label={ti('settings.chat.companion_name')}>
                <input
                  value={draft.companionName}
                  onChange={(event) => setDraft((prev) => setCompanionNameWithWakeWordSync(prev, event.target.value))}
                />
              </SettingsV3Field>
              <SettingsV3Field label={ti('settings.chat.user_name')}>
                <input
                  value={draft.userName}
                  onChange={(event) => setDraft((prev) => ({ ...prev, userName: event.target.value }))}
                />
              </SettingsV3Field>
            </div>
          </SettingsV3Section>
          <SettingsV3Section title={ti('settings.chat.live2d_model')} description={ti('settings.chat.model_import_hint')}>
            <SettingsV3Row icon="image" label={petModelLabel} hint={translatePetText(petModel?.description)}>
              <SettingsV3Field label={ti('settings.chat.live2d_model')}>
                <select
                  aria-label={ti('settings.chat.live2d_model')}
                  value={draft.petModelId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, petModelId: event.target.value }))}
                >
                  {petModelPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {translatePetText(preset.label) || preset.label}
                    </option>
                  ))}
                </select>
              </SettingsV3Field>
            </SettingsV3Row>
          </SettingsV3Section>
          <SettingsV3Section title={ti('settings.chat.relationship_type_label')}>
            <div className="settings-v3-choice-grid" role="radiogroup" aria-label={ti('settings.chat.relationship_type_label')}>
              {RELATIONSHIP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="settings-v3-choice"
                  data-selected={draft.companionRelationshipType === option.value ? 'true' : undefined}
                  role="radio"
                  aria-checked={draft.companionRelationshipType === option.value}
                  onClick={() => selectRelationshipType(option.value)}
                >
                  {ti(option.labelKey)}
                </button>
              ))}
            </div>
          </SettingsV3Section>
        </>
      )}

      <SettingsV3Section title={ti('settings.chat.live2d_model')} description={ti('settings.chat.model_import_hint')}>
        <SettingsV3Row icon="image" label={ti('settings.chat.import_model')} hint={ti('settings.chat.model_import_hint')}>
          <button
            type="button"
            className="settings-v3-action"
            disabled={props.importingPetModel}
            onClick={props.onImportPetModel}
          >
            {props.importingPetModel ? ti('settings.chat.importing_model') : ti('settings.chat.import_model')}
          </button>
        </SettingsV3Row>
      </SettingsV3Section>

      <SettingsV3Disclosure
        title={ti('settings.chat.system_prompt')}
        description={ti('settings.chat.system_prompt_hint')}
      >
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.chat.system_prompt')}>
            <textarea
              rows={5}
              value={draft.systemPrompt}
              onChange={(event) => setDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))}
            />
          </SettingsV3Field>
        </div>
      </SettingsV3Disclosure>

      {importStatus ? (
        <SettingsV3Notice
          tone={importStatus.ok ? 'success' : 'error'}
          title={importStatus.message}
          announce
        >
          {importStatus.recommendation}
        </SettingsV3Notice>
      ) : null}

      <SettingsV3Disclosure
        title={ti('settings.chat.profiles')}
        description={ti('settings.chat.model_import_hint')}
      >
        <ChatStudioV3 {...props} />
      </SettingsV3Disclosure>

      {rest ? null : (
        <SettingsV3Disclosure title={ti('settings.chat.character_voice')} description={ti('settings.chat.character_voice_hint')}>
          <SettingsV3Field label={ti('settings.chat.speaking_instructions')} hint={ti('settings.chat.speaking_instructions_placeholder')}>
            <textarea
              rows={3}
              value={draft.speechOutputInstructions}
              placeholder={ti('settings.chat.speaking_instructions_placeholder')}
              onChange={(event) => setDraft((prev) => ({ ...prev, speechOutputInstructions: event.target.value }))}
            />
          </SettingsV3Field>
        </SettingsV3Disclosure>
      )}

      <SettingsV3Disclosure title={ti('settings.chat.vts_title')} description={ti('settings.chat.vts_hint')}>
        <SettingsV3Row label={ti('settings.chat.vts_enabled')} hint={ti('settings.chat.vts_hint')}>
          <SettingsV3Switch
            label={ti('settings.chat.vts_enabled')}
            checked={draft.vtsEnabled}
            onChange={(vtsEnabled) => setDraft((prev) => ({ ...prev, vtsEnabled }))}
          />
        </SettingsV3Row>
        {draft.vtsEnabled ? (
          <SettingsV3Field label={ti('settings.chat.vts_port')}>
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.vtsPort}
              onChange={(event) => setDraft((prev) => ({ ...prev, vtsPort: Number(event.target.value) || 8001 }))}
            />
          </SettingsV3Field>
        ) : null}
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
