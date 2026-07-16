import { useMemo, useState } from 'react'
import { applyCharacterProfile, createCharacterProfile, removeCharacterProfile, syncCurrentToProfile, updateCharacterProfile } from '../character/profiles'
import { buildCodexPetCreatorPrompt } from '../pet'
import { syncWakeWordWithCompanionNameChange } from '../hearing/companionWakeWordSync'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks'
import { savePendingGreeting } from '../../lib/storage/pendingGreeting'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { CharacterProfile } from '../../types'
import type { ChatSectionV3Props } from './ChatSectionV3'
import { SettingsV3Empty, SettingsV3Field, SettingsV3Notice, SettingsV3Toolbar } from './SettingsV3Primitives'

const COMMUNITY_SOURCES = [
  ['https://codex-pet.com/', 'settings.chat.codex_pet_source_gallery'],
  ['https://codex-pet.org/', 'settings.chat.codex_pet_source_directory'],
  ['https://codexpets.net/gallery', 'settings.chat.codex_pet_source_checked'],
  ['https://openpets.app/pets', 'settings.chat.codex_pet_source_verified'],
  ['https://openpets.dev/', 'settings.chat.codex_pet_source_openpets'],
  ['https://codingpets.com/', 'settings.chat.codex_pet_source_downloads'],
  ['https://www.getyourownpet.com/', 'settings.chat.codex_pet_source_petforge'],
  ['https://spritesheep.com/', 'settings.chat.codex_pet_source_sprite_editor'],
  ['https://www.codingpets.dev/', 'settings.chat.codex_pet_source_generator'],
] as const

type StatusMessage = { ok: boolean; message: string } | null
type PackageOutput = NonNullable<ChatSectionV3Props['assembledCreatorKitPackage']>

function joinKitPath(base: string, relative: string) {
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/u, '')}${separator}${relative.split('/').join(separator)}`
}

export function ChatStudioV3(props: ChatSectionV3Props) {
  const { draft, setDraft } = props
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => pickTranslatedUiText(draft.uiLanguage, key, params)
  const [importingCard, setImportingCard] = useState(false)
  const [cardStatus, setCardStatus] = useState<StatusMessage>(null)
  const [galleryInput, setGalleryInput] = useState('')
  const [galleryQuery, setGalleryQuery] = useState('')
  const [kitName, setKitName] = useState('')
  const [kitConcept, setKitConcept] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptCopied, setPromptCopied] = useState(false)
  const activeProfile = draft.characterProfiles.find((profile) => profile.id === draft.activeCharacterProfileId)
  const generatedPrompt = useMemo(() => buildCodexPetCreatorPrompt({ displayName: kitName.trim(), concept: kitConcept.trim() }), [kitConcept, kitName])

  function createProfile() {
    const profile = createCharacterProfile(draft, draft.companionName)
    setDraft((previous) => ({ ...previous, characterProfiles: [...previous.characterProfiles, profile], activeCharacterProfileId: profile.id }))
  }

  function selectProfile(profile: CharacterProfile) {
    setDraft((previous) => applyCharacterProfile(previous, profile))
  }

  function renameProfile(profileId: string, label: string) {
    setDraft((previous) => ({ ...previous, characterProfiles: updateCharacterProfile(previous.characterProfiles, profileId, { label }) }))
  }

  function deleteProfile(profileId: string) {
    setDraft((previous) => ({
      ...previous,
      characterProfiles: removeCharacterProfile(previous.characterProfiles, profileId),
      activeCharacterProfileId: previous.activeCharacterProfileId === profileId ? '' : previous.activeCharacterProfileId,
    }))
  }

  async function importCharacterCard() {
    if (!window.desktopPet?.personaImportCard) return
    setImportingCard(true)
    setCardStatus(null)
    try {
      const result = await window.desktopPet.personaImportCard()
      if (!result) return
      const profile: CharacterProfile = {
        id: result.profile.id,
        label: result.profile.label,
        companionName: result.profile.companionName,
        systemPrompt: result.profile.systemPrompt,
        petModelId: result.profile.petModelId || draft.petModelId,
      }
      setDraft((previous) => syncWakeWordWithCompanionNameChange(previous, {
        ...previous,
        companionName: profile.companionName,
        systemPrompt: profile.systemPrompt,
        characterProfiles: [...previous.characterProfiles, profile],
        activeCharacterProfileId: profile.id,
      }))
      if (result.lorebookEntries.length) saveLorebookEntries([...loadLorebookEntries(), ...result.lorebookEntries])
      if (result.greeting) savePendingGreeting(result.greeting)
      setCardStatus({ ok: true, message: ti('settings.chat.import_card_success', { name: profile.companionName, count: result.lorebookEntries.length }) })
    } catch (error) {
      setCardStatus({ ok: false, message: ti('settings.chat.import_card_error', { error: getRedactedLogErrorMessage(error) }) })
    } finally {
      setImportingCard(false)
    }
  }

  async function copyPrompt() {
    const value = prompt || generatedPrompt
    setPrompt(value)
    setPromptCopied(false)
    try {
      await navigator.clipboard?.writeText(value)
      setPromptCopied(true)
    } catch {
      setPromptCopied(false)
    }
  }

  function PackageResult({ output, generated = false }: { output: PackageOutput; generated?: boolean }) {
    const open = (targetPath: string, mode: 'open' | 'reveal' = 'open') => props.onOpenCodexPetCreatorKitPath({ kitDirectory: output.packageDirectory, targetPath, mode })
    return (
      <div className="settings-v3-studio-output" role="status" aria-live="polite">
        <strong>{ti('settings.chat.codex_pet_creator_final_package')}</strong>
        <code>{output.packageDirectoryDisplay ?? output.packageDirectory}</code>
        <SettingsV3Toolbar>
          <button type="button" onClick={() => open(output.packageDirectory)}>{ti('settings.chat.codex_pet_creator_open_final_package')}</button>
          {output.archivePath ? <button type="button" onClick={() => open(output.archivePath ?? '', 'reveal')}>{ti('settings.chat.codex_pet_creator_open_archive')}</button> : null}
          <button type="button" onClick={generated ? props.onInstallGeneratedSpritePetPackageToCodex : props.onInstallCodexPetCreatorKitToCodex}>{ti('settings.chat.codex_pet_creator_install_codex')}</button>
        </SettingsV3Toolbar>
      </div>
    )
  }

  return (
    <div className="settings-v3-studio">
      <div className="settings-v3-studio__head">
        <div><strong>{ti('settings.chat.profiles')}</strong><span>{ti('settings.chat.profiles_hint')}</span></div>
        <SettingsV3Toolbar>
          <button type="button" onClick={() => setDraft((previous) => syncCurrentToProfile(previous))} disabled={!activeProfile}>{ti('settings.chat.update_profile')}</button>
          <button type="button" onClick={createProfile}>{ti('settings.chat.new_profile')}</button>
        </SettingsV3Toolbar>
      </div>

      {draft.characterProfiles.length ? (
        <ul className="settings-v3-collection settings-v3-profile-list" aria-label={ti('settings.chat.profiles')}>
          {draft.characterProfiles.map((profile) => {
            const selected = profile.id === draft.activeCharacterProfileId
            const model = props.petModelPresets.find((preset) => preset.id === profile.petModelId)
            return (
              <li className="settings-v3-collection-row" key={profile.id} data-selected={selected ? 'true' : undefined}>
                <button type="button" className="settings-v3-collection-row__main" aria-pressed={selected} onClick={() => selectProfile(profile)}>
                  <span className="settings-v3-collection-row__title">{profile.label || profile.companionName}</span>
                  <span className="settings-v3-collection-row__preview">{model?.label || profile.petModelId}{profile.speechOutputVoice ? ` · ${profile.speechOutputVoice}` : ''}</span>
                </button>
                <div className="settings-v3-profile-list__actions">
                  <input value={profile.label} placeholder={profile.companionName} aria-label={`${ti('settings.chat.profiles')}: ${profile.companionName}`} onChange={(event) => renameProfile(profile.id, event.target.value)} />
                  <button
                    type="button"
                    className="settings-v3-action is-danger"
                    onClick={() => void props.confirm({
                      title: ti('settings.chat.delete_profile'),
                      message: `${ti('settings.chat.delete_profile')}: ${profile.label || profile.companionName}`,
                      confirmLabel: ti('settings.chat.delete_profile'),
                      tone: 'danger',
                    }).then((accepted) => { if (accepted) deleteProfile(profile.id) })}
                    aria-label={`${ti('settings.chat.delete_profile')}: ${profile.companionName}`}
                  >×</button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : <SettingsV3Empty title={ti('settings.chat.no_profile_selected')} description={ti('settings.chat.profiles_hint')} />}

      <div className="settings-v3-studio__actions">
        <SettingsV3Toolbar>
          <button type="button" onClick={() => void importCharacterCard()} disabled={importingCard}>{importingCard ? ti('settings.chat.importing_card') : ti('settings.chat.import_card')}</button>
          <button type="button" onClick={props.onImportPetModel} disabled={props.importingPetModel}>{props.importingPetModel ? ti('settings.chat.importing_model') : ti('settings.chat.import_model')}</button>
          <button type="button" onClick={props.onCreateSpritePetFromImage} disabled={props.importingPetModel}>{ti('settings.chat.create_sprite_pet_from_image')}</button>
        </SettingsV3Toolbar>
        {cardStatus ? <SettingsV3Notice tone={cardStatus.ok ? 'success' : 'error'} title={cardStatus.message} announce /> : null}
      </div>

      {props.generatedSpritePetPackage ? <PackageResult output={props.generatedSpritePetPackage} generated /> : null}

      <section className="settings-v3-studio-pane" aria-labelledby="settings-v3-gallery-title">
        <header><strong id="settings-v3-gallery-title">{ti('settings.chat.codex_pet_import')}</strong><span>{ti('settings.chat.codex_pet_import_hint')}</span></header>
        <nav className="settings-v3-source-links" aria-label={ti('settings.chat.codex_pet_sources')}>
          {COMMUNITY_SOURCES.map(([href, label]) => <a key={href} href={href} target="_blank" rel="noreferrer">{ti(label)} ↗</a>)}
        </nav>
        <div className="settings-v3-studio-fields">
          <SettingsV3Field label={ti('settings.chat.codex_pet_import')}><input value={galleryInput} placeholder={ti('settings.chat.codex_pet_placeholder')} onChange={(event) => setGalleryInput(event.target.value)} /></SettingsV3Field>
          <button type="button" className="settings-v3-action" disabled={props.importingPetModel || !galleryInput.trim()} onClick={() => props.onImportCodexPetGallery(galleryInput.trim())}>{ti('settings.chat.import_codex_pet')}</button>
        </div>
        <div className="settings-v3-studio-fields">
          <SettingsV3Field label={ti('settings.chat.codex_pet_catalog_search_label')}><input value={galleryQuery} placeholder={ti('settings.chat.codex_pet_catalog_query_placeholder')} onChange={(event) => setGalleryQuery(event.target.value)} /></SettingsV3Field>
          <button type="button" className="settings-v3-action" disabled={props.codexPetCatalogLoading} onClick={() => props.onLoadCodexPetGallery(galleryQuery.trim())}>{props.codexPetCatalogLoading ? ti('settings.chat.codex_pet_catalog_loading') : ti('settings.chat.codex_pet_catalog_load')}</button>
        </div>
        {props.codexPetCatalogStatus ? <SettingsV3Notice tone={props.codexPetCatalogStatus.ok ? 'success' : 'error'} title={props.codexPetCatalogStatus.message} announce /> : null}
        {props.codexPetCatalog?.pets.length ? (
          <ul className="settings-v3-collection">
            {props.codexPetCatalog.pets.map((pet) => (
              <li key={`${pet.sourceName ?? 'gallery'}:${pet.slug}`} className="settings-v3-collection-row">
                <div className="settings-v3-collection-row__main"><span className="settings-v3-collection-row__title">{pet.displayName}</span><span className="settings-v3-collection-row__preview">{pet.description || `${pet.sourceName ?? ''} · ${pet.slug}`}</span></div>
                <button type="button" className="settings-v3-action" disabled={props.importingPetModel} onClick={() => props.onImportCodexPetGallery(pet.downloadUrl || pet.sourceUrl)}>{ti('settings.chat.codex_pet_catalog_import')}</button>
              </li>
            ))}
          </ul>
        ) : props.codexPetCatalog ? <SettingsV3Empty title={ti('settings.chat.codex_pet_catalog_empty')} /> : null}
      </section>

      <section className="settings-v3-studio-pane" aria-labelledby="settings-v3-creator-title">
        <header><strong id="settings-v3-creator-title">{ti('settings.chat.codex_pet_creator')}</strong><span>{ti('settings.chat.codex_pet_creator_hint')}</span></header>
        <div className="settings-v3-editor settings-v3-studio__kit-fields">
          <SettingsV3Field label={ti('settings.chat.codex_pet_creator_name_label')}><input value={kitName} placeholder={ti('settings.chat.codex_pet_creator_name_placeholder')} onChange={(event) => setKitName(event.target.value)} /></SettingsV3Field>
          <SettingsV3Field label={ti('settings.chat.codex_pet_creator_concept_label')}><input value={kitConcept} placeholder={ti('settings.chat.codex_pet_creator_concept_placeholder')} onChange={(event) => setKitConcept(event.target.value)} /></SettingsV3Field>
        </div>
        <SettingsV3Toolbar>
          <button type="button" disabled={!kitName.trim() && !kitConcept.trim()} onClick={() => { setPrompt(generatedPrompt); setPromptCopied(false) }}>{ti('settings.chat.codex_pet_creator_prompt')}</button>
          <button type="button" disabled={props.creatingCreatorKit || (!kitName.trim() && !kitConcept.trim())} onClick={() => props.onCreateCodexPetCreatorKit({ displayName: kitName.trim(), concept: kitConcept.trim() })}>{props.creatingCreatorKit ? ti('settings.chat.codex_pet_creator_creating') : ti('settings.chat.codex_pet_creator_create')}</button>
          <button type="button" disabled={props.inspectingCreatorKit} onClick={props.onInspectCodexPetCreatorKit}>{props.inspectingCreatorKit ? ti('settings.chat.codex_pet_creator_checking') : ti('settings.chat.codex_pet_creator_check')}</button>
          <button type="button" disabled={props.assemblingCreatorKit} onClick={props.onAssembleCodexPetCreatorKit}>{props.assemblingCreatorKit ? ti('settings.chat.codex_pet_creator_assembling') : ti('settings.chat.codex_pet_creator_assemble')}</button>
        </SettingsV3Toolbar>
        {prompt ? <SettingsV3Field label={ti('settings.chat.codex_pet_creator_prompt')}><textarea readOnly value={prompt} /><button type="button" className="settings-v3-action" onClick={() => void copyPrompt()}>{promptCopied ? ti('settings.chat.codex_pet_creator_copied') : ti('settings.chat.codex_pet_creator_copy_prompt')}</button></SettingsV3Field> : null}
        {props.lastCreatorKitDirectory ? (
          <div className="settings-v3-studio-output">
            <code>{props.lastCreatorKitDirectoryDisplay || props.lastCreatorKitDirectory}</code>
            <SettingsV3Toolbar>
              <button type="button" onClick={() => props.onOpenCodexPetCreatorKitPath({ kitDirectory: props.lastCreatorKitDirectory, targetPath: props.lastCreatorKitDirectory, mode: 'open' })}>{ti('settings.chat.codex_pet_creator_open_kit')}</button>
              <button type="button" onClick={() => props.onOpenCodexPetCreatorKitPath({ kitDirectory: props.lastCreatorKitDirectory, targetPath: joinKitPath(props.lastCreatorKitDirectory, 'references/style-samples.md'), mode: 'open' })}>{ti('settings.chat.codex_pet_creator_open_style_samples')}</button>
              {props.lastCreatorKitSourceRowsDirectory ? <button type="button" onClick={() => props.onOpenCodexPetCreatorKitPath({ kitDirectory: props.lastCreatorKitDirectory, targetPath: props.lastCreatorKitSourceRowsDirectory, mode: 'open' })}>{ti('settings.chat.codex_pet_creator_open_source_rows')}</button> : null}
            </SettingsV3Toolbar>
          </div>
        ) : null}
        {props.assembledCreatorKitPackage ? <PackageResult output={props.assembledCreatorKitPackage} /> : null}
        {props.creatorKitInspection ? (
          <div className="settings-v3-studio-output" role="status">
            <strong>{props.creatorKitInspection.displayName}</strong>
            <span>{props.creatorKitInspection.ready ? ti('settings.chat.codex_pet_creator_ready') : ti('settings.chat.codex_pet_creator_missing_count', { ready: props.creatorKitInspection.readyCount, total: props.creatorKitInspection.rows.length })}</span>
            <div className="settings-v3-chip-line">{props.creatorKitInspection.rows.map((row) => <span key={`${row.row}-${row.state}`} data-warning={!row.ready || row.warnings?.length ? 'true' : undefined}>{row.row} {row.state}{row.warnings?.length ? ' !' : ''}</span>)}</div>
            <SettingsV3Toolbar>
              {props.creatorKitInspection.contactSheetPath ? <button type="button" onClick={() => props.onOpenCodexPetCreatorKitPath({ kitDirectory: props.creatorKitInspection?.kitDirectory ?? '', targetPath: props.creatorKitInspection?.contactSheetPath ?? '', mode: 'reveal' })}>{ti('settings.chat.codex_pet_creator_show_qa')}</button> : null}
              {props.creatorKitInspection.motionPreviewPath ? <button type="button" onClick={() => props.onOpenCodexPetCreatorKitPath({ kitDirectory: props.creatorKitInspection?.kitDirectory ?? '', targetPath: props.creatorKitInspection?.motionPreviewPath ?? '', mode: 'open' })}>{ti('settings.chat.codex_pet_creator_open_preview')}</button> : null}
            </SettingsV3Toolbar>
          </div>
        ) : null}
      </section>
    </div>
  )
}
