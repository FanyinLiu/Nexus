import { memo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
  SpritePetAnimationState,
} from '../../features/pet'
import {
  buildCodexPetCreatorPrompt,
} from '../../features/pet'
import {
  applyCharacterProfile,
  createCharacterProfile,
  removeCharacterProfile,
  syncCurrentToProfile,
  updateCharacterProfile,
} from '../../features/character/profiles'
import {
  pickTranslatedUiText,
  pickTranslatedUiTextOrFallback,
} from '../../lib/uiLanguage'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks'
import { savePendingGreeting } from '../../lib/storage/pendingGreeting'
import { TextField } from '../settingsFields'
import type { AppSettings, CharacterProfile, CompanionRelationshipType } from '../../types'
import {
  setCompanionNameWithWakeWordSync,
  syncWakeWordWithCompanionNameChange,
} from '../../features/hearing/companionWakeWordSync.ts'
import { CharacterProfilePanel } from './chat/CharacterProfilePanel'
import { RelationshipPanel } from './chat/RelationshipPanel'
import { PetModelPicker } from './chat/PetModelPicker'
import { PetMotionModeToggle } from './chat/PetMotionModeToggle'
import { CodexPetGalleryPanel } from './chat/CodexPetGalleryPanel'
import { SpriteCreatorKitPanel } from './chat/SpriteCreatorKitPanel'

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
  lastCreatorKitDirectoryDisplay: string
  lastCreatorKitSourceRowsDirectory: string
  lastCreatorKitSourceRowsDirectoryDisplay: string
  assembledCreatorKitPackage: {
    packageDirectory: string
    packageDirectoryDisplay?: string
    manifestPath: string
    manifestPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
  } | null
  generatedSpritePetPackage: {
    packageDirectory: string
    packageDirectoryDisplay?: string
    manifestPath: string
    manifestPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
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
  lastCreatorKitDirectoryDisplay,
  lastCreatorKitSourceRowsDirectory,
  lastCreatorKitSourceRowsDirectoryDisplay,
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

      setDraft((prev) => syncWakeWordWithCompanionNameChange(prev, {
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

      // Stash the card's greeting so the companion opens the next empty
      // conversation with it (consumed once by the chat layer).
      if (result.greeting) {
        savePendingGreeting(result.greeting)
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
          error: getRedactedLogErrorMessage(err),
        }),
      })
    } finally {
      setImportingCard(false)
    }
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
      <CharacterProfilePanel
        draft={draft}
        petModelPresets={petModelPresets}
        ti={ti}
        translatePetText={translatePetText}
        onSelectProfile={handleSwitchProfile}
        onDeleteProfile={handleDeleteProfile}
        onUpdateProfileLabel={handleUpdateProfileLabel}
      />

      <div className="settings-control-grid settings-chat-identity-grid">
        <div className="settings-control-card settings-chat-identity-field">
          <TextField
            label={ti('settings.chat.companion_name')}
            field="companionName"
            draft={draft}
            setDraft={setDraft}
            updateDraft={setCompanionNameWithWakeWordSync}
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

      <RelationshipPanel
        draft={draft}
        ti={ti}
        onSelectRelationshipType={selectRelationshipType}
      />

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
        <div className="settings-control-card settings-chat-advanced-control">
          <label className="settings-toggle">
            <span>{ti('settings.chat.profile_persona_in_chat')}</span>
            <input
              type="checkbox"
              checked={draft.profilePersonaInChatEnabled}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  profilePersonaInChatEnabled: event.target.checked,
                }))
              }
            />
          </label>
          <p className="settings-drawer__hint">
            {ti('settings.chat.profile_persona_in_chat_hint')}
          </p>
        </div>
      </div>

      <PetModelPicker
        draft={draft}
        petModel={petModel}
        petModelPresets={petModelPresets}
        spritePreviewState={spritePreviewState}
        setSpritePreviewState={setSpritePreviewState}
        spritePetLabel={spritePetLabel}
        ti={ti}
        translatePetText={translatePetText}
        onSelectPetModel={selectPetModelById}
      />

      <PetMotionModeToggle isSpriteAvatar={Boolean(petModel?.spriteAtlas)} ti={ti} />

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
              <code>{generatedSpritePetPackage.packageDirectoryDisplay ?? generatedSpritePetPackage.packageDirectory}</code>
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
                <code>{generatedSpritePetPackage.archivePathDisplay ?? generatedSpritePetPackage.archivePath}</code>
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
      <CodexPetGalleryPanel
        codexPetInput={codexPetInput}
        setCodexPetInput={setCodexPetInput}
        codexPetCatalogQuery={codexPetCatalogQuery}
        setCodexPetCatalogQuery={setCodexPetCatalogQuery}
        codexPetCatalog={codexPetCatalog}
        codexPetCatalogLoading={codexPetCatalogLoading}
        codexPetCatalogStatus={codexPetCatalogStatus}
        importingPetModel={importingPetModel}
        ti={ti}
        onImportCodexPetGallery={onImportCodexPetGallery}
        onLoadCodexPetGallery={onLoadCodexPetGallery}
      />

      <SpriteCreatorKitPanel
        creatorKitName={creatorKitName}
        setCreatorKitName={setCreatorKitName}
        creatorKitConcept={creatorKitConcept}
        setCreatorKitConcept={setCreatorKitConcept}
        creatorPromptText={creatorPromptText}
        creatorPromptCopied={creatorPromptCopied}
        creatingCreatorKit={creatingCreatorKit}
        inspectingCreatorKit={inspectingCreatorKit}
        creatorKitInspection={creatorKitInspection}
        assemblingCreatorKit={assemblingCreatorKit}
        lastCreatorKitDirectory={lastCreatorKitDirectory}
        lastCreatorKitDirectoryDisplay={lastCreatorKitDirectoryDisplay}
        lastCreatorKitSourceRowsDirectory={lastCreatorKitSourceRowsDirectory}
        lastCreatorKitSourceRowsDirectoryDisplay={lastCreatorKitSourceRowsDirectoryDisplay}
        assembledCreatorKitPackage={assembledCreatorKitPackage}
        ti={ti}
        onShowCreatorPrompt={handleShowCreatorPrompt}
        onCopyCreatorPrompt={() => void handleCopyCreatorPrompt()}
        onCreateCodexPetCreatorKit={onCreateCodexPetCreatorKit}
        onInspectCodexPetCreatorKit={onInspectCodexPetCreatorKit}
        onAssembleCodexPetCreatorKit={onAssembleCodexPetCreatorKit}
        onInstallCodexPetCreatorKitToCodex={onInstallCodexPetCreatorKitToCodex}
        onOpenCodexPetCreatorKitPath={onOpenCodexPetCreatorKitPath}
      />
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
