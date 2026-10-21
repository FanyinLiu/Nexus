import { useState } from 'react'
import { applyCharacterProfile, createCharacterProfile, removeCharacterProfile, syncCurrentToProfile, updateCharacterProfile } from '../character/profiles.ts'
import { syncWakeWordWithCompanionNameChange } from '../hearing/companionWakeWordSync.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { loadLorebookEntries, saveLorebookEntries } from '../../lib/storage/lorebooks.ts'
import { savePendingGreeting } from '../../lib/storage/pendingGreeting.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { CharacterProfile } from '../../types'
import type { ChatSectionV3Props } from './ChatSectionV3.tsx'
import { SettingsV3Empty, SettingsV3Notice, SettingsV3Toolbar } from './SettingsV3Primitives.tsx'

type StatusMessage = { ok: boolean; message: string } | null

export function ChatStudioV3(props: ChatSectionV3Props) {
  const { draft, setDraft } = props
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => pickTranslatedUiText(draft.uiLanguage, key, params)
  const [importingCard, setImportingCard] = useState(false)
  const [cardStatus, setCardStatus] = useState<StatusMessage>(null)
  const activeProfile = draft.characterProfiles.find((profile) => profile.id === draft.activeCharacterProfileId)

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
        </SettingsV3Toolbar>
        {cardStatus ? <SettingsV3Notice tone={cardStatus.ok ? 'success' : 'error'} title={cardStatus.message} announce /> : null}
      </div>
    </div>
  )
}
