import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PetModelDefinition } from '../../features/pet'
import {
  applyCharacterProfile,
  createCharacterProfile,
  removeCharacterProfile,
  updateCharacterProfile,
} from '../../features/character/profiles'
import type { AppSettings, CharacterProfile } from '../../types'

type StatusMessage = {
  ok: boolean
  message: string
} | null

type ChatSectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  setCloneName: Dispatch<SetStateAction<string>>
  petModelPresets: PetModelDefinition[]
  importingPetModel: boolean
  petModelStatus: StatusMessage
  onImportPetModel: () => void
}

export const ChatSection = memo(function ChatSection({
  active,
  draft,
  setDraft,
  setCloneName,
  petModelPresets,
  importingPetModel,
  petModelStatus,
  onImportPetModel,
}: ChatSectionProps) {
  const petModel = petModelPresets.find((preset) => preset.id === draft.petModelId) ?? petModelPresets[0]

  function handleSaveAsProfile() {
    const profile = createCharacterProfile(draft, draft.companionName)
    setDraft((prev) => ({
      ...prev,
      characterProfiles: [...prev.characterProfiles, profile],
      activeCharacterProfileId: profile.id,
    }))
  }

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

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>角色与设定</h4>
          <p className="settings-drawer__hint">
            创建多个角色档案，每个角色包含独立的名字、提示词、Live2D 模型和语音设置。
          </p>
        </div>
      </div>

      {draft.characterProfiles.length > 0 ? (
        <div className="settings-drawer__card">
          <div className="settings-section__title-row">
            <div>
              <h5>角色档案</h5>
              <p className="settings-drawer__hint">点击切换角色，当前角色的修改会自动保存到档案中。</p>
            </div>
            <div className="settings-page__meta">
              <span>{`${draft.characterProfiles.length} 个角色`}</span>
            </div>
          </div>

          <div className="settings-choice-grid" role="list">
            {draft.characterProfiles.map((profile) => {
              const isActive = draft.activeCharacterProfileId === profile.id
              const profileModel = petModelPresets.find((p) => p.id === profile.petModelId)

              return (
                <div key={profile.id} className={`settings-choice-card ${isActive ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className="settings-choice-card__body"
                    aria-pressed={isActive}
                    onClick={() => handleSwitchProfile(profile)}
                  >
                    <span className="settings-choice-card__header">
                      <strong>{profile.label || profile.companionName}</strong>
                    </span>
                    <span className="settings-choice-card__description">
                      {profileModel?.label ?? profile.petModelId}
                      {profile.speechOutputVoice ? ` · ${profile.speechOutputVoice}` : ''}
                    </span>
                  </button>
                  <div className="settings-choice-card__actions">
                    <input
                      className="settings-choice-card__label-input"
                      value={profile.label}
                      placeholder={profile.companionName}
                      onChange={(event) => handleUpdateProfileLabel(profile.id, event.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-inline-delete"
                      onClick={() => handleDeleteProfile(profile.id)}
                      title="删除此角色"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <label>
        <span>角色名字</span>
        <input
          value={draft.companionName}
          onChange={(event) => {
            const nextName = event.target.value
            setDraft((prev) => ({ ...prev, companionName: nextName }))
            setCloneName((current) => current || `${nextName} 音色`)
          }}
        />
      </label>

      <label>
        <span>你的名字</span>
        <input
          value={draft.userName}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, userName: event.target.value }))
          }
        />
      </label>

      <label>
        <span>陪伴体提示词</span>
        <textarea
          rows={6}
          value={draft.systemPrompt}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, systemPrompt: event.target.value }))
          }
        />
      </label>

      <p className="settings-drawer__hint">
        这里定义的是角色的长期说话边界。建议重点写语气、关系感和回答风格，不要塞过长的一次性任务指令。
      </p>

      <label>
        <span>角色模型</span>
        <select
          value={draft.petModelId}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, petModelId: event.target.value }))
          }
        >
          {petModelPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-choice-field settings-choice-field--pet-model">
        <span className="settings-choice-field__label">角色模型</span>
        <div className="settings-choice-grid" role="list">
          {petModelPresets.map((preset) => {
            const selected = draft.petModelId === preset.id

            return (
              <button
                key={preset.id}
                type="button"
                className={`settings-choice-card ${selected ? 'is-active' : ''}`}
                aria-pressed={selected}
                onClick={() =>
                  setDraft((prev) => ({ ...prev, petModelId: preset.id }))
                }
              >
                <span className="settings-choice-card__header">
                  <strong>{preset.label}</strong>
                </span>
                <span className="settings-choice-card__description">
                  {preset.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="settings-inline-row">
        <button
          type="button"
          className="ghost-button"
          onClick={onImportPetModel}
          disabled={importingPetModel}
        >
          {importingPetModel ? '导入模型中...' : '导入本地 Live2D 模型'}
        </button>

        <button
          type="button"
          className="ghost-button"
          onClick={handleSaveAsProfile}
        >
          保存为角色档案
        </button>
      </div>

      <p className="settings-drawer__hint">
        {petModel?.description ?? ''}
        {' '}选择 `.model3.json` 文件后，应用会把整套模型复制到本地目录，后续切换不需要重新打包。
      </p>

      {petModelStatus ? (
        <div className={petModelStatus.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}>
          {petModelStatus.message}
        </div>
      ) : null}
    </section>
  )
})
