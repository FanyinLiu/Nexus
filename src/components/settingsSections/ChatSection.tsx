import { memo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
  SpritePetAnimationState,
} from '../../features/pet'
import {
  SPRITE_PET_ANIMATION_STATES,
  buildCodexPetCreatorPrompt,
} from '../../features/pet'
import { SpritePetCanvas } from '../../features/pet/components/SpritePetCanvas'
import { PetControlIcon } from '../PetControlIcon'
import {
  applyCharacterProfile,
  createCharacterProfile,
  removeCharacterProfile,
  syncCurrentToProfile,
  updateCharacterProfile,
} from '../../features/character/profiles'
import { RELATIONSHIP_OPTIONS } from '../../lib/relationshipTypes'
import {
  pickTranslatedUiText,
  pickTranslatedUiTextOrFallback,
} from '../../lib/uiLanguage'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks'
import { TextField } from '../settingsFields'
import {
  getChoiceRadioId,
  getChoiceTabIndex,
  handleChoiceRadioKeyDown,
} from '../choiceRadioNav'
import type { AppSettings, CharacterProfile, CompanionRelationshipType } from '../../types'
import type { TranslationKey } from '../../types/i18n'

type StatusMessage = {
  ok: boolean
  message: string
} | null

type ChatSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  petModelPresets: PetModelDefinition[]
  importingPetModel: boolean
  petModelStatus: StatusMessage
  codexPetCatalog: CodexPetGalleryCatalogResult | null
  codexPetCatalogLoading: boolean
  codexPetCatalogStatus: StatusMessage
  creatingCreatorKit: boolean
  inspectingCreatorKit: boolean
  creatorKitInspection: SpritePetCreatorKitInspection | null
  assemblingCreatorKit: boolean
  lastCreatorKitDirectory: string
  lastCreatorKitSourceRowsDirectory: string
  assembledCreatorKitPackage: {
    packageDirectory: string
    manifestPath: string
    visualAuditPath?: string
    archivePath?: string
  } | null
  generatedSpritePetPackage: {
    packageDirectory: string
    manifestPath: string
    visualAuditPath?: string
    archivePath?: string
  } | null
  onImportPetModel: () => void
  onImportCodexPetGallery: (input: string) => void
  onLoadCodexPetGallery: (query?: string) => void
  onCreateCodexPetCreatorKit: (payload: {
    displayName?: string
    concept?: string
  }) => void
  onInspectCodexPetCreatorKit: () => void
  onAssembleCodexPetCreatorKit: () => void
  onInstallCodexPetCreatorKitToCodex: () => void
  onInstallGeneratedSpritePetPackageToCodex: () => void
  onOpenCodexPetCreatorKitPath: (payload: {
    kitDirectory: string
    targetPath: string
    mode?: 'open' | 'reveal'
  }) => void
  onCreateSpritePetFromImage: () => void
}

const CODEX_PET_COMMUNITY_LINKS: Array<{ href: string; labelKey: TranslationKey }> = [
  {
    href: 'https://codex-pet.com/',
    labelKey: 'settings.chat.codex_pet_source_gallery',
  },
  {
    href: 'https://codex-pet.org/',
    labelKey: 'settings.chat.codex_pet_source_directory',
  },
  {
    href: 'https://codexpets.net/gallery',
    labelKey: 'settings.chat.codex_pet_source_checked',
  },
  {
    href: 'https://openpets.app/pets',
    labelKey: 'settings.chat.codex_pet_source_verified',
  },
  {
    href: 'https://openpets.dev/',
    labelKey: 'settings.chat.codex_pet_source_openpets',
  },
  {
    href: 'https://codingpets.com/',
    labelKey: 'settings.chat.codex_pet_source_downloads',
  },
  {
    href: 'https://www.getyourownpet.com/',
    labelKey: 'settings.chat.codex_pet_source_petforge',
  },
  {
    href: 'https://spritesheep.com/',
    labelKey: 'settings.chat.codex_pet_source_sprite_editor',
  },
  {
    href: 'https://www.codingpets.dev/',
    labelKey: 'settings.chat.codex_pet_source_generator',
  },
]

function joinCreatorKitPath(kitDirectory: string, relativePath: string) {
  const separator = kitDirectory.includes('\\') ? '\\' : '/'
  const base = kitDirectory.replace(/[\\/]+$/u, '')
  return `${base}${separator}${relativePath.split('/').join(separator)}`
}

const PROFILE_RADIO_GROUP_ID = 'settings-chat-profile'
const RELATIONSHIP_RADIO_GROUP_ID = 'settings-chat-relationship'
const PET_MODEL_RADIO_GROUP_ID = 'settings-chat-pet-model'
const SPRITE_PREVIEW_RADIO_GROUP_ID = 'settings-chat-sprite-preview'

const SPRITE_PREVIEW_STATE_LABELS: Record<SpritePetAnimationState, Record<AppSettings['uiLanguage'], string>> = {
  idle: {
    'zh-CN': '待机',
    'zh-TW': '待機',
    'en-US': 'Idle',
    ja: '待機',
    ko: '대기',
  },
  'running-right': {
    'zh-CN': '向右跑',
    'zh-TW': '向右跑',
    'en-US': 'Run right',
    ja: '右走行',
    ko: '오른쪽',
  },
  'running-left': {
    'zh-CN': '向左跑',
    'zh-TW': '向左跑',
    'en-US': 'Run left',
    ja: '左走行',
    ko: '왼쪽',
  },
  waving: {
    'zh-CN': '招手',
    'zh-TW': '揮手',
    'en-US': 'Wave',
    ja: '手振り',
    ko: '인사',
  },
  jumping: {
    'zh-CN': '跳跃',
    'zh-TW': '跳躍',
    'en-US': 'Jump',
    ja: 'ジャンプ',
    ko: '점프',
  },
  failed: {
    'zh-CN': '失败',
    'zh-TW': '失敗',
    'en-US': 'Failed',
    ja: '失敗',
    ko: '실패',
  },
  waiting: {
    'zh-CN': '等待',
    'zh-TW': '等待',
    'en-US': 'Wait',
    ja: '待機中',
    ko: '기다림',
  },
  running: {
    'zh-CN': '跑动',
    'zh-TW': '跑動',
    'en-US': 'Run',
    ja: '走行',
    ko: '달리기',
  },
  review: {
    'zh-CN': '复查',
    'zh-TW': '檢視',
    'en-US': 'Review',
    ja: '確認',
    ko: '검토',
  },
}

function getSpritePreviewStateLabel(state: SpritePetAnimationState, uiLanguage: AppSettings['uiLanguage']) {
  return SPRITE_PREVIEW_STATE_LABELS[state][uiLanguage]
}

export const ChatSection = memo(function ChatSection({
  active,
  draft,
  setDraft,
  petModelPresets,
  importingPetModel,
  petModelStatus,
  codexPetCatalog,
  codexPetCatalogLoading,
  codexPetCatalogStatus,
  creatingCreatorKit,
  inspectingCreatorKit,
  creatorKitInspection,
  assemblingCreatorKit,
  lastCreatorKitDirectory,
  lastCreatorKitSourceRowsDirectory,
  assembledCreatorKitPackage,
  generatedSpritePetPackage,
  onImportPetModel,
  onImportCodexPetGallery,
  onLoadCodexPetGallery,
  onCreateCodexPetCreatorKit,
  onInspectCodexPetCreatorKit,
  onAssembleCodexPetCreatorKit,
  onInstallCodexPetCreatorKitToCodex,
  onInstallGeneratedSpritePetPackageToCodex,
  onOpenCodexPetCreatorKitPath,
  onCreateSpritePetFromImage,
}: ChatSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) =>
    pickTranslatedUiText(draft.uiLanguage, key, params)

  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]
  const translatePetText = (value: string | undefined) => pickTranslatedUiTextOrFallback(draft.uiLanguage, value)
  const spritePetLabel = translatePetText(petModel?.label) || petModel?.label || ti('settings.chat.sprite_pet_fallback_label')

  function handleCreateProfile() {
    const profile = createCharacterProfile(draft, draft.companionName)
    setDraft((prev) => ({
      ...prev,
      characterProfiles: [...prev.characterProfiles, profile],
      activeCharacterProfileId: profile.id,
    }))
  }

  function handleUpdateCurrentProfile() {
    setDraft((prev) => syncCurrentToProfile(prev))
  }

  const hasActiveProfile = Boolean(
    draft.activeCharacterProfileId &&
      draft.characterProfiles.some((p) => p.id === draft.activeCharacterProfileId),
  )

  function handleSwitchProfile(profile: CharacterProfile) {
    setDraft((prev) => applyCharacterProfile(prev, profile))
  }

  function handleDeleteProfile(profileId: string) {
    setDraft((prev) => ({
      ...prev,
      characterProfiles: removeCharacterProfile(prev.characterProfiles, profileId),
      activeCharacterProfileId: prev.activeCharacterProfileId === profileId
        ? ''
        : prev.activeCharacterProfileId,
    }))
  }

  function handleUpdateProfileLabel(profileId: string, label: string) {
    setDraft((prev) => ({
      ...prev,
      characterProfiles: updateCharacterProfile(prev.characterProfiles, profileId, { label }),
    }))
  }

  const [importingCard, setImportingCard] = useState(false)
  const [cardStatus, setCardStatus] = useState<StatusMessage>(null)
  const [codexPetInput, setCodexPetInput] = useState('')
  const [codexPetCatalogQuery, setCodexPetCatalogQuery] = useState('')
  const [creatorKitName, setCreatorKitName] = useState('')
  const [creatorKitConcept, setCreatorKitConcept] = useState('')
  const [creatorPromptText, setCreatorPromptText] = useState('')
  const [creatorPromptCopied, setCreatorPromptCopied] = useState(false)
  const [spritePreviewState, setSpritePreviewState] = useState<SpritePetAnimationState>('idle')
  const creatorStyleSamplesPath = lastCreatorKitDirectory
    ? joinCreatorKitPath(lastCreatorKitDirectory, 'references/style-samples.md')
    : ''

  function buildCreatorPromptFromInput() {
    return buildCodexPetCreatorPrompt({
      displayName: creatorKitName.trim(),
      concept: creatorKitConcept.trim(),
    })
  }

  function handleShowCreatorPrompt() {
    setCreatorPromptText(buildCreatorPromptFromInput())
    setCreatorPromptCopied(false)
  }

  async function handleCopyCreatorPrompt() {
    const prompt = creatorPromptText || buildCreatorPromptFromInput()
    setCreatorPromptText(prompt)
    setCreatorPromptCopied(false)

    if (!navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(prompt)
      setCreatorPromptCopied(true)
    } catch {
      setCreatorPromptCopied(false)
    }
  }

  async function handleImportCard() {
    if (!window.desktopPet?.personaImportCard) return
    setImportingCard(true)
    setCardStatus(null)
    try {
      const result = await window.desktopPet.personaImportCard()
      if (!result) { setImportingCard(false); return }

      const profile: CharacterProfile = {
        id: result.profile.id,
        label: result.profile.label,
        companionName: result.profile.companionName,
        systemPrompt: result.profile.systemPrompt,
        petModelId: result.profile.petModelId || draft.petModelId,
      }

      setDraft((prev) => ({
        ...prev,
        companionName: profile.companionName,
        systemPrompt: profile.systemPrompt,
        characterProfiles: [...prev.characterProfiles, profile],
        activeCharacterProfileId: profile.id,
      }))

      if (result.lorebookEntries.length) {
        const existing = loadLorebookEntries()
        saveLorebookEntries([...existing, ...result.lorebookEntries])
      }

      setCardStatus({
        ok: true,
        message: ti('settings.chat.import_card_success', {
          name: profile.companionName,
          count: result.lorebookEntries.length,
        }),
      })
    } catch (err) {
      setCardStatus({
        ok: false,
        message: ti('settings.chat.import_card_error', {
          error: err instanceof Error ? err.message : String(err),
        }),
      })
    } finally {
      setImportingCard(false)
    }
  }

  const profileCount = draft.characterProfiles.length
  const profileCountLabel = ti('settings.chat.profiles_label', { count: profileCount })
  const profileChoiceIds = draft.characterProfiles.map((profile) => profile.id)
  const relationshipChoiceIds = RELATIONSHIP_OPTIONS.map((option) => option.value)
  const petModelChoiceIds = petModelPresets.map((preset) => preset.id)
  const spritePreviewChoiceIds = SPRITE_PET_ANIMATION_STATES

  function selectProfileById(profileId: string) {
    const profile = draft.characterProfiles.find((item) => item.id === profileId)
    if (profile) handleSwitchProfile(profile)
  }

  function selectRelationshipType(value: CompanionRelationshipType) {
    setDraft((prev) => ({
      ...prev,
      companionRelationshipType: value,
    }))
  }

  function selectPetModelById(petModelId: string) {
    setDraft((prev) => ({ ...prev, petModelId }))
  }

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      {profileCount > 0 ? (
        <div className="settings-drawer__card">
          <div className="settings-section__title-row">
            <div>
              <h5>{ti('settings.chat.profiles')}</h5>
              <p className="settings-drawer__hint">
                {ti('settings.chat.profiles_hint')}
              </p>
            </div>
            <div className="settings-page__meta">
              <span>{profileCountLabel}</span>
            </div>
          </div>

          <div
            className="settings-choice-grid"
            role="radiogroup"
            aria-label={ti('settings.chat.profiles')}
          >
            {draft.characterProfiles.map((profile) => {
              const isActive = draft.activeCharacterProfileId === profile.id
              const profileModel = petModelPresets.find((p) => p.id === profile.petModelId)
              const profileDisplayName = profile.label || profile.companionName

              return (
                <div key={profile.id} className={`settings-choice-card ${isActive ? 'is-active' : ''}`}>
                  <button
                    id={getChoiceRadioId(PROFILE_RADIO_GROUP_ID, profile.id)}
                    type="button"
                    className="settings-choice-card__body"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={getChoiceTabIndex(profile.id, draft.activeCharacterProfileId, profileChoiceIds)}
                    onClick={() => selectProfileById(profile.id)}
                    onKeyDown={(event) =>
                      handleChoiceRadioKeyDown(
                        event,
                        profileChoiceIds,
                        profile.id,
                        PROFILE_RADIO_GROUP_ID,
                        selectProfileById,
                      )}
                  >
                    <span className="settings-choice-card__header">
                      <strong>{profileDisplayName}</strong>
                    </span>
                    <span className="settings-choice-card__description">
                      {translatePetText(profileModel?.label) || profile.petModelId}
                      {profile.speechOutputVoice ? ` · ${profile.speechOutputVoice}` : ''}
                    </span>
                  </button>
                  <div className="settings-choice-card__actions">
                    <input
                      className="settings-choice-card__label-input"
                      value={profile.label}
                      placeholder={profile.companionName}
                      aria-label={`${ti('settings.chat.profiles')}: ${profileDisplayName}`}
                      onChange={(event) => handleUpdateProfileLabel(profile.id, event.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-inline-delete"
                      onClick={() => handleDeleteProfile(profile.id)}
                      aria-label={`${ti('settings.chat.delete_profile')}: ${profileDisplayName}`}
                      title={`${ti('settings.chat.delete_profile')}: ${profileDisplayName}`}
                    >
                      <PetControlIcon name="close" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="settings-control-grid settings-chat-identity-grid">
        <div className="settings-control-card settings-chat-identity-field">
          <TextField
            label={ti('settings.chat.companion_name')}
            field="companionName"
            draft={draft}
            setDraft={setDraft}
          />
        </div>

        <div className="settings-control-card settings-chat-identity-field">
          <TextField
            label={ti('settings.chat.user_name')}
            field="userName"
            draft={draft}
            setDraft={setDraft}
          />
        </div>
      </div>

      <div className="settings-mini-group settings-chat-relationship-card">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.chat.relationship_type_label')}</h5>
          <span>{ti('settings.chat.relationship_type_hint')}</span>
        </div>
        <div
          className="onboarding-relationship__options"
          role="radiogroup"
          aria-label={ti('settings.chat.relationship_type_label')}
        >
          {RELATIONSHIP_OPTIONS.map((opt) => {
            const isActive = draft.companionRelationshipType === opt.value
            return (
              <button
                id={getChoiceRadioId(RELATIONSHIP_RADIO_GROUP_ID, opt.value)}
                key={opt.value}
                type="button"
                className={`onboarding-relationship__chip${isActive ? ' is-active' : ''}`}
                role="radio"
                aria-checked={isActive}
                tabIndex={getChoiceTabIndex(opt.value, draft.companionRelationshipType, relationshipChoiceIds)}
                onClick={() => selectRelationshipType(opt.value)}
                onKeyDown={(event) =>
                  handleChoiceRadioKeyDown(
                    event,
                    relationshipChoiceIds,
                    opt.value,
                    RELATIONSHIP_RADIO_GROUP_ID,
                    selectRelationshipType,
                  )}
              >
                {ti(opt.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="settings-mini-group">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.chat.system_prompt')}</h5>
          <span>{ti('settings.chat.system_prompt_hint')}</span>
        </div>
        <textarea
          className="settings-chat-system-prompt"
          aria-label={ti('settings.chat.system_prompt')}
          rows={4}
          value={draft.systemPrompt}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))
          }
        />
      </div>

      <div className="settings-pet-studio__top">
        <div className="settings-mini-group settings-choice-field settings-choice-field--pet-model settings-pet-model-card">
          <div className="settings-mini-group__head">
            <h5>{ti('settings.chat.live2d_model')}</h5>
            <span>{translatePetText(petModel?.description)}</span>
          </div>
          <div
            className="settings-choice-grid"
            role="radiogroup"
            aria-label={ti('settings.chat.live2d_model')}
          >
            {petModelPresets.map((preset) => {
              const selected = draft.petModelId === preset.id

              return (
                <button
                  id={getChoiceRadioId(PET_MODEL_RADIO_GROUP_ID, preset.id)}
                  key={preset.id}
                  type="button"
                  className={`settings-choice-card ${selected ? 'is-active' : ''}`}
                  role="radio"
                  aria-checked={selected}
                  tabIndex={getChoiceTabIndex(preset.id, draft.petModelId, petModelChoiceIds)}
                  onClick={() => selectPetModelById(preset.id)}
                  onKeyDown={(event) =>
                    handleChoiceRadioKeyDown(
                      event,
                      petModelChoiceIds,
                      preset.id,
                      PET_MODEL_RADIO_GROUP_ID,
                      selectPetModelById,
                    )}
                >
                  <span className="settings-choice-card__header">
                    <strong>{translatePetText(preset.label)}</strong>
                  </span>
                  <span className="settings-choice-card__description">
                    {translatePetText(preset.description)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {petModel.spriteAtlas ? (
          <div className="settings-mini-group settings-sprite-preview settings-pet-preview-card">
            <div className="settings-mini-group__head">
              <h5>{ti('settings.chat.codex_pet_runtime_preview')}</h5>
              <span>{ti('settings.chat.codex_pet_runtime_preview_hint')}</span>
            </div>
            <div className="settings-sprite-preview__body">
              <div className="settings-sprite-preview__stage">
                <SpritePetCanvas
                  atlas={petModel.spriteAtlas}
                  mood="idle"
                  overrideState={spritePreviewState}
                  placement="panel-card"
                  label={spritePetLabel}
                />
              </div>
              <div
                className="settings-sprite-preview__states"
                role="radiogroup"
                aria-label={ti('settings.chat.codex_pet_runtime_preview')}
              >
                {SPRITE_PET_ANIMATION_STATES.map((state) => {
                  const stateLabel = getSpritePreviewStateLabel(state, draft.uiLanguage)

                  return (
                    <button
                      id={getChoiceRadioId(SPRITE_PREVIEW_RADIO_GROUP_ID, state)}
                      key={state}
                      type="button"
                      className={state === spritePreviewState ? 'is-active' : ''}
                      role="radio"
                      aria-checked={state === spritePreviewState}
                      tabIndex={getChoiceTabIndex(state, spritePreviewState, spritePreviewChoiceIds)}
                      title={state}
                      onClick={() => setSpritePreviewState(state)}
                      onKeyDown={(event) =>
                        handleChoiceRadioKeyDown(
                          event,
                          spritePreviewChoiceIds,
                          state,
                          SPRITE_PREVIEW_RADIO_GROUP_ID,
                          setSpritePreviewState,
                        )}
                    >
                      <span className="settings-sprite-preview__state-label">{stateLabel}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <details className="settings-mini-group settings-chat-advanced-card">
        <summary className="settings-mini-group__head">
          <div>
            <h5>{ti('settings.chat.character_voice')}</h5>
            <span>{ti('settings.chat.character_voice_hint')}</span>
          </div>
        </summary>

        <label className="settings-control-card settings-chat-advanced-field">
          <span>{ti('settings.chat.voice_id')}</span>
          <input
            value={draft.speechOutputVoice}
            placeholder={ti('settings.chat.voice_id_placeholder')}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, speechOutputVoice: event.target.value }))
            }
          />
        </label>

        <label className="settings-control-card settings-chat-advanced-field">
          <span>{ti('settings.chat.speaking_instructions')}</span>
          <textarea
            rows={3}
            value={draft.speechOutputInstructions}
            placeholder={ti('settings.chat.speaking_instructions_placeholder')}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, speechOutputInstructions: event.target.value }))
            }
          />
        </label>
      </details>

      <details className="settings-mini-group settings-chat-advanced-card">
        <summary className="settings-mini-group__head">
          <div>
            <h5>{ti('settings.chat.vts_title')}</h5>
            <span>{ti('settings.chat.vts_hint')}</span>
          </div>
        </summary>
        <div className="settings-control-card settings-chat-advanced-control">
          <label className="settings-toggle">
            <span>{ti('settings.chat.vts_enabled')}</span>
            <input
              type="checkbox"
              checked={draft.vtsEnabled}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, vtsEnabled: event.target.checked }))
              }
            />
          </label>
        </div>
        {draft.vtsEnabled ? (
          <label className="settings-control-card settings-chat-advanced-field">
            <span>{ti('settings.chat.vts_port')}</span>
            <input
              type="number"
              value={draft.vtsPort}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, vtsPort: Number(event.target.value) || 8001 }))
              }
            />
          </label>
        ) : null}
      </details>

      <div className="settings-pet-tools">
      <div className="settings-inline-row settings-pet-action-row">
        <button
          type="button"
          className="ghost-button"
          onClick={handleImportCard}
          disabled={importingCard}
        >
          {importingCard
            ? ti('settings.chat.importing_card')
            : ti('settings.chat.import_card')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onImportPetModel}
          disabled={importingPetModel}
        >
          {importingPetModel
            ? ti('settings.chat.importing_model')
            : ti('settings.chat.import_model')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={onCreateSpritePetFromImage}
          disabled={importingPetModel}
        >
          {importingPetModel
            ? ti('settings.chat.importing_model')
            : ti('settings.chat.create_sprite_pet_from_image')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={handleUpdateCurrentProfile}
          disabled={!hasActiveProfile}
          title={hasActiveProfile
            ? ti('settings.chat.update_profile_title')
            : ti('settings.chat.no_profile_selected')}
        >
          {ti('settings.chat.update_profile')}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={handleCreateProfile}
          title={ti('settings.chat.new_profile_title')}
        >
          {ti('settings.chat.new_profile')}
        </button>
      </div>

      <p className="settings-mini-group__note">
        {ti('settings.chat.model_import_hint')}
      </p>

      {generatedSpritePetPackage ? (
        <div className="settings-pet-kit-status" role="status" aria-live="polite" aria-atomic="true">
          <div className="settings-pet-kit-status__head">
            <strong>{ti('settings.chat.codex_pet_creator_final_package')}</strong>
            <span>{ti('settings.chat.codex_pet_creator_final_package_hint')}</span>
          </div>
          <div className="settings-pet-kit-output">
            <p className="settings-mini-group__note">
              <code>{generatedSpritePetPackage.packageDirectory}</code>
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onOpenCodexPetCreatorKitPath({
                kitDirectory: generatedSpritePetPackage.packageDirectory,
                targetPath: generatedSpritePetPackage.packageDirectory,
                mode: 'open',
              })}
            >
              {ti('settings.chat.codex_pet_creator_open_final_package')}
            </button>
          </div>
          {generatedSpritePetPackage.archivePath ? (
            <div className="settings-pet-kit-output">
              <p className="settings-mini-group__note">
                <span>{ti('settings.chat.codex_pet_creator_archive')}</span>{' '}
                <code>{generatedSpritePetPackage.archivePath}</code>
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: generatedSpritePetPackage.packageDirectory,
                  targetPath: generatedSpritePetPackage.archivePath ?? '',
                  mode: 'reveal',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_archive')}
              </button>
            </div>
          ) : null}
          <div className="settings-inline-row">
            <button
              type="button"
              className="ghost-button"
              onClick={onInstallGeneratedSpritePetPackageToCodex}
            >
              {ti('settings.chat.codex_pet_creator_install_codex')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="settings-pet-workflow-grid">
      <div className="settings-mini-group settings-pet-workflow-card settings-pet-workflow-card--community">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.chat.codex_pet_import')}</h5>
          <span>{ti('settings.chat.codex_pet_import_hint')}</span>
        </div>
        <div
          className="settings-community-links"
          aria-label={ti('settings.chat.codex_pet_sources')}
        >
          <span className="settings-community-links__label">{ti('settings.chat.codex_pet_sources')}</span>
          {CODEX_PET_COMMUNITY_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="settings-community-links__text">{ti(link.labelKey)}</span>
              <PetControlIcon name="external-link" />
            </a>
          ))}
        </div>
        <div className="settings-inline-row">
          <input
            aria-label={ti('settings.chat.codex_pet_import')}
            value={codexPetInput}
            placeholder={ti('settings.chat.codex_pet_placeholder')}
            onChange={(event) => setCodexPetInput(event.target.value)}
          />
          <button
            type="button"
            className="ghost-button"
            onClick={() => onImportCodexPetGallery(codexPetInput.trim())}
            disabled={importingPetModel || !codexPetInput.trim()}
          >
            {importingPetModel
              ? ti('settings.chat.importing_model')
              : ti('settings.chat.import_codex_pet')}
          </button>
        </div>
        <div className="settings-inline-row">
          <input
            aria-label={ti('settings.chat.codex_pet_catalog_search_label')}
            value={codexPetCatalogQuery}
            placeholder={ti('settings.chat.codex_pet_catalog_query_placeholder')}
            onChange={(event) => setCodexPetCatalogQuery(event.target.value)}
          />
          <button
            type="button"
            className="ghost-button"
            onClick={() => onLoadCodexPetGallery(codexPetCatalogQuery.trim())}
            disabled={codexPetCatalogLoading}
          >
            {codexPetCatalogLoading
              ? ti('settings.chat.codex_pet_catalog_loading')
              : ti('settings.chat.codex_pet_catalog_load')}
          </button>
        </div>
        {codexPetCatalogStatus ? (
          <div
            className={codexPetCatalogStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
            role={codexPetCatalogStatus.ok ? 'status' : 'alert'}
            aria-live={codexPetCatalogStatus.ok ? 'polite' : 'assertive'}
            aria-atomic="true"
          >
            {codexPetCatalogStatus.message}
          </div>
        ) : null}
        {codexPetCatalog && codexPetCatalog.pets.length === 0 ? (
          <p className="settings-mini-group__note">
            {ti('settings.chat.codex_pet_catalog_empty')}
          </p>
        ) : null}
        {codexPetCatalog && codexPetCatalog.pets.length > 0 ? (
          <div className="settings-pet-gallery-list">
            {codexPetCatalog.pets.map((pet) => (
              <article key={`${pet.sourceName ?? 'codex-pet.com'}:${pet.slug}`} className="settings-pet-gallery-item">
                <div className="settings-pet-gallery-item__body">
                  <strong>{pet.displayName}</strong>
                  <code>{pet.sourceName ? `${pet.sourceName} · ${pet.slug}` : pet.slug}</code>
                  {pet.description ? (
                    <p>{pet.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onImportCodexPetGallery(pet.downloadUrl || pet.sourceUrl)}
                  disabled={importingPetModel}
                >
                  {ti('settings.chat.codex_pet_catalog_import')}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="settings-mini-group settings-pet-workflow-card settings-pet-workflow-card--creator">
        <div className="settings-mini-group__head">
          <h5>{ti('settings.chat.codex_pet_creator')}</h5>
          <span>{ti('settings.chat.codex_pet_creator_hint')}</span>
        </div>
        <div className="settings-inline-row">
          <input
            aria-label={ti('settings.chat.codex_pet_creator_name_label')}
            value={creatorKitName}
            placeholder={ti('settings.chat.codex_pet_creator_name_placeholder')}
            onChange={(event) => setCreatorKitName(event.target.value)}
          />
          <input
            aria-label={ti('settings.chat.codex_pet_creator_concept_label')}
            value={creatorKitConcept}
            placeholder={ti('settings.chat.codex_pet_creator_concept_placeholder')}
            onChange={(event) => setCreatorKitConcept(event.target.value)}
          />
        </div>
        <div className="settings-inline-row settings-pet-creator-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={handleShowCreatorPrompt}
            disabled={!creatorKitName.trim() && !creatorKitConcept.trim()}
          >
            {ti('settings.chat.codex_pet_creator_prompt')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onCreateCodexPetCreatorKit({
              displayName: creatorKitName.trim(),
              concept: creatorKitConcept.trim(),
            })}
            disabled={creatingCreatorKit || (!creatorKitName.trim() && !creatorKitConcept.trim())}
          >
            {creatingCreatorKit
              ? ti('settings.chat.codex_pet_creator_creating')
              : ti('settings.chat.codex_pet_creator_create')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onInspectCodexPetCreatorKit}
            disabled={inspectingCreatorKit}
          >
            {inspectingCreatorKit
              ? ti('settings.chat.codex_pet_creator_checking')
              : ti('settings.chat.codex_pet_creator_check')}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onAssembleCodexPetCreatorKit}
            disabled={assemblingCreatorKit}
          >
            {assemblingCreatorKit
              ? ti('settings.chat.codex_pet_creator_assembling')
              : ti('settings.chat.codex_pet_creator_assemble')}
          </button>
        </div>
        {lastCreatorKitDirectory ? (
          <div className="settings-pet-kit-output">
            <p className="settings-mini-group__note">
              {ti('settings.chat.codex_pet_creator_current_kit')} <code>{lastCreatorKitDirectory}</code>
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onOpenCodexPetCreatorKitPath({
                kitDirectory: lastCreatorKitDirectory,
                targetPath: lastCreatorKitDirectory,
                mode: 'open',
              })}
            >
              {ti('settings.chat.codex_pet_creator_open_kit')}
            </button>
            {creatorStyleSamplesPath ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: lastCreatorKitDirectory,
                  targetPath: creatorStyleSamplesPath,
                  mode: 'open',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_style_samples')}
              </button>
            ) : null}
            {lastCreatorKitSourceRowsDirectory ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: lastCreatorKitDirectory,
                  targetPath: lastCreatorKitSourceRowsDirectory,
                  mode: 'open',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_source_rows')}
              </button>
            ) : null}
          </div>
        ) : null}
        {creatorPromptText ? (
          <div className="settings-pet-creator-prompt">
            <textarea
              readOnly
              aria-label={ti('settings.chat.codex_pet_creator_prompt')}
              value={creatorPromptText}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleCopyCreatorPrompt()}
            >
              {creatorPromptCopied
                ? ti('settings.chat.codex_pet_creator_copied')
                : ti('settings.chat.codex_pet_creator_copy_prompt')}
            </button>
          </div>
        ) : null}
        {assembledCreatorKitPackage ? (
          <div className="settings-pet-kit-status" role="status" aria-live="polite" aria-atomic="true">
            <div className="settings-pet-kit-status__head">
              <strong>{ti('settings.chat.codex_pet_creator_final_package')}</strong>
              <span>{ti('settings.chat.codex_pet_creator_final_package_hint')}</span>
            </div>
            <div className="settings-pet-kit-output">
              <p className="settings-mini-group__note">
                <code>{assembledCreatorKitPackage.packageDirectory}</code>
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => onOpenCodexPetCreatorKitPath({
                  kitDirectory: lastCreatorKitDirectory,
                  targetPath: assembledCreatorKitPackage.packageDirectory,
                  mode: 'open',
                })}
              >
                {ti('settings.chat.codex_pet_creator_open_final_package')}
              </button>
            </div>
            {assembledCreatorKitPackage.archivePath ? (
              <div className="settings-pet-kit-output">
                <p className="settings-mini-group__note">
                  <span>{ti('settings.chat.codex_pet_creator_archive')}</span>{' '}
                  <code>{assembledCreatorKitPackage.archivePath}</code>
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onOpenCodexPetCreatorKitPath({
                    kitDirectory: lastCreatorKitDirectory,
                    targetPath: assembledCreatorKitPackage.archivePath ?? '',
                    mode: 'reveal',
                  })}
                >
                  {ti('settings.chat.codex_pet_creator_open_archive')}
                </button>
              </div>
            ) : null}
            <div className="settings-inline-row">
              <button
                type="button"
                className="ghost-button"
                onClick={onInstallCodexPetCreatorKitToCodex}
              >
                {ti('settings.chat.codex_pet_creator_install_codex')}
              </button>
            </div>
          </div>
        ) : null}
        {creatorKitInspection ? (
          <div className="settings-pet-kit-status" role="status" aria-live="polite" aria-atomic="true">
            <div className="settings-pet-kit-status__head">
              <strong>{creatorKitInspection.displayName}</strong>
              <span>
                {creatorKitInspection.ready
                  ? ti('settings.chat.codex_pet_creator_ready')
                  : ti('settings.chat.codex_pet_creator_missing_count', {
                      ready: creatorKitInspection.readyCount,
                      total: creatorKitInspection.rows.length,
                    })}
              </span>
            </div>
            <div className="settings-pet-kit-rows">
              {creatorKitInspection.rows.map((row) => (
                <span
                  key={`${row.row}-${row.state}`}
                  className={!row.ready ? 'is-missing' : row.warnings?.length ? 'is-warning' : 'is-ready'}
                  title={row.warnings?.join('\n') || undefined}
                >
                  {row.row} {row.state}
                  {row.warnings?.length ? ' !' : ''}
                </span>
              ))}
            </div>
            {creatorKitInspection.contactSheetPath ? (
              <div className="settings-pet-kit-output">
                <p className="settings-mini-group__note">
                  {ti('settings.chat.codex_pet_creator_contact_sheet')} <code>{creatorKitInspection.contactSheetPath}</code>
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onOpenCodexPetCreatorKitPath({
                    kitDirectory: creatorKitInspection.kitDirectory,
                    targetPath: creatorKitInspection.contactSheetPath ?? '',
                    mode: 'reveal',
                  })}
                >
                  {ti('settings.chat.codex_pet_creator_show_qa')}
                </button>
              </div>
            ) : null}
            {creatorKitInspection.motionPreviewPath ? (
              <div className="settings-pet-kit-output">
                <p className="settings-mini-group__note">
                  {ti('settings.chat.codex_pet_creator_motion_preview')} <code>{creatorKitInspection.motionPreviewPath}</code>
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onOpenCodexPetCreatorKitPath({
                    kitDirectory: creatorKitInspection.kitDirectory,
                    targetPath: creatorKitInspection.motionPreviewPath ?? '',
                    mode: 'open',
                  })}
                >
                  {ti('settings.chat.codex_pet_creator_open_preview')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      </div>
      </div>

      {petModelStatus ? (
        <div
          className={petModelStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
          role={petModelStatus.ok ? 'status' : 'alert'}
          aria-live={petModelStatus.ok ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {petModelStatus.message}
        </div>
      ) : null}

      {cardStatus ? (
        <div
          className={cardStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
          role={cardStatus.ok ? 'status' : 'alert'}
          aria-live={cardStatus.ok ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {cardStatus.message}
        </div>
      ) : null}
    </section>
  )
})
