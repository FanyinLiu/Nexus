import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PanelSceneMode } from '../../features/panelScene'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, PetWindowState, TranslationKey, UiLanguage } from '../../types'

// Panel scene mode options resolved to i18n keys at render time so the
// dropdown labels actually change when the user switches UI language.
const PANEL_SCENE_OPTIONS: Array<{ id: PanelSceneMode; labelKey: TranslationKey }> = [
  { id: 'off', labelKey: 'settings.window.panel_scene.off' },
  { id: 'auto', labelKey: 'settings.window.panel_scene.auto' },
  { id: 'morning', labelKey: 'settings.window.panel_scene.morning' },
  { id: 'noon', labelKey: 'settings.window.panel_scene.noon' },
  { id: 'afternoon', labelKey: 'settings.window.panel_scene.afternoon' },
  { id: 'dusk', labelKey: 'settings.window.panel_scene.dusk' },
  { id: 'night', labelKey: 'settings.window.panel_scene.night' },
]

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

      <label>
        <span>{ti('settings.window.panel_scene_label')}</span>
        <select
          value={draft.panelSceneMode}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              panelSceneMode: event.target.value as typeof prev.panelSceneMode,
            }))
          }
        >
          {PANEL_SCENE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {ti(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.panel_scene_hint')}</p>

      <label className="settings-toggle">
        <span>{ti('settings.window.ambient_weather_toggle')}</span>
        <input
          type="checkbox"
          checked={draft.ambientWeatherEnabled}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              ambientWeatherEnabled: event.target.checked,
            }))
          }
        />
      </label>

      {draft.ambientWeatherEnabled ? (
        <label>
          <span>{ti('settings.window.ambient_weather_location_label')}</span>
          <input
            value={draft.toolWeatherDefaultLocation}
            placeholder={ti('settings.window.ambient_weather_location_placeholder')}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                toolWeatherDefaultLocation: event.target.value,
              }))
            }
          />
        </label>
      ) : null}

      <p className="settings-drawer__hint">{ti('settings.window.ambient_weather_hint')}</p>
    </section>
  )
})
