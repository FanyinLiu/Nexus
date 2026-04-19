import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { PANEL_SCENE_MODE_OPTIONS } from '../../features/panelScene'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, PetWindowState, UiLanguage } from '../../types'

type WindowSectionProps = {
  active: boolean
  draft: AppSettings
  petWindowState: PetWindowState
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
  updateWindowState: (partial: Partial<PetWindowState>) => Promise<void> | void
  windowStatusMessage: string | null
}

export const WindowSection = memo(function WindowSection({
  active,
  draft,
  petWindowState,
  setDraft,
  uiLanguage,
  updateWindowState,
  windowStatusMessage,
}: WindowSectionProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)

  return (
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.window.title')}</h4>
          <p className="settings-drawer__hint">{ti('settings.window.note')}</p>
        </div>
        {windowStatusMessage ? (
          <p className="settings-section__note">
            {windowStatusMessage}
          </p>
        ) : null}
      </div>

      <label className="settings-toggle">
        <span>{ti('settings.window.launch_on_startup')}</span>
        <input
          type="checkbox"
          checked={draft.launchOnStartup}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              launchOnStartup: event.target.checked,
            }))
          }
        />
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.launch_note')}</p>

      <label className="settings-toggle">
        <span>{petWindowState.isPinned ? ti('settings.window.pinned_on_top') : ti('settings.window.free_window')}</span>
        <input
          type="checkbox"
          checked={petWindowState.isPinned}
          onChange={() => void updateWindowState({ isPinned: !petWindowState.isPinned })}
        />
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.pinned_note')}</p>

      <label className="settings-toggle">
        <span>{petWindowState.clickThrough ? ti('settings.window.click_through_enabled') : ti('settings.window.interactive')}</span>
        <input
          type="checkbox"
          checked={petWindowState.clickThrough}
          onChange={() => void updateWindowState({ clickThrough: !petWindowState.clickThrough })}
        />
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.click_through_note')}</p>

      <label className="settings-section__field">
        <span>聊天面板背景</span>
        <select
          value={draft.panelSceneMode}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              panelSceneMode: event.target.value as typeof prev.panelSceneMode,
            }))
          }
        >
          {PANEL_SCENE_MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">
        「按时间自动切换」会每 10 分钟根据本机时钟选清晨 / 正午 / 午后 / 黄昏 / 夜晚之一；选固定场景会一直停留在该氛围里。
      </p>
    </section>
  )
})
