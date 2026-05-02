import { memo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import { TextField, ToggleField } from '../settingsFields'
import type {
  AppSettings,
  PetSceneLocation,
  PetTimePreview,
  PetWeatherPreview,
  PetWindowState,
  TranslationKey,
  UiLanguage,
} from '../../types'

const PET_SCENE_LOCATION_OPTIONS: Array<{ id: PetSceneLocation; labelKey: TranslationKey }> = [
  { id: 'off', labelKey: 'settings.window.pet_scene.off' },
  { id: 'city', labelKey: 'settings.window.pet_scene.city' },
  { id: 'countryside', labelKey: 'settings.window.pet_scene.countryside' },
  { id: 'seaside', labelKey: 'settings.window.pet_scene.seaside' },
  { id: 'fields', labelKey: 'settings.window.pet_scene.fields' },
  { id: 'mountain', labelKey: 'settings.window.pet_scene.mountain' },
]

const PET_TIME_PREVIEW_OPTIONS: Array<{ id: PetTimePreview; labelKey: TranslationKey }> = [
  { id: 'auto', labelKey: 'settings.window.pet_time.auto' },
  { id: 'deep_night', labelKey: 'settings.window.pet_time.deep_night' },
  { id: 'late_night', labelKey: 'settings.window.pet_time.late_night' },
  { id: 'predawn', labelKey: 'settings.window.pet_time.predawn' },
  { id: 'dawn', labelKey: 'settings.window.pet_time.dawn' },
  { id: 'sunrise', labelKey: 'settings.window.pet_time.sunrise' },
  { id: 'morning', labelKey: 'settings.window.pet_time.morning' },
  { id: 'late_morning', labelKey: 'settings.window.pet_time.late_morning' },
  { id: 'noon', labelKey: 'settings.window.pet_time.noon' },
  { id: 'afternoon', labelKey: 'settings.window.pet_time.afternoon' },
  { id: 'golden_hour', labelKey: 'settings.window.pet_time.golden_hour' },
  { id: 'sunset', labelKey: 'settings.window.pet_time.sunset' },
  { id: 'dusk', labelKey: 'settings.window.pet_time.dusk' },
  { id: 'early_night', labelKey: 'settings.window.pet_time.early_night' },
  { id: 'night', labelKey: 'settings.window.pet_time.night' },
]

const PET_WEATHER_PREVIEW_OPTIONS: Array<{ id: PetWeatherPreview; labelKey: TranslationKey }> = [
  { id: 'auto', labelKey: 'settings.window.pet_weather.auto' },
  { id: 'clear', labelKey: 'settings.window.pet_weather.clear' },
  { id: 'partly_cloudy', labelKey: 'settings.window.pet_weather.partly_cloudy' },
  { id: 'overcast', labelKey: 'settings.window.pet_weather.overcast' },
  { id: 'drizzle', labelKey: 'settings.window.pet_weather.drizzle' },
  { id: 'rain', labelKey: 'settings.window.pet_weather.rain' },
  { id: 'heavy_rain', labelKey: 'settings.window.pet_weather.heavy_rain' },
  { id: 'thunder', labelKey: 'settings.window.pet_weather.thunder' },
  { id: 'storm', labelKey: 'settings.window.pet_weather.storm' },
  { id: 'light_snow', labelKey: 'settings.window.pet_weather.light_snow' },
  { id: 'snow', labelKey: 'settings.window.pet_weather.snow' },
  { id: 'heavy_snow', labelKey: 'settings.window.pet_weather.heavy_snow' },
  { id: 'fog', labelKey: 'settings.window.pet_weather.fog' },
  { id: 'breeze', labelKey: 'settings.window.pet_weather.breeze' },
  { id: 'gale', labelKey: 'settings.window.pet_weather.gale' },
]

type WindowSectionProps = {
  active: boolean
  draft: AppSettings
  petWindowState: PetWindowState
  launchOnStartupSupported: boolean
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
  updateWindowState: (partial: Partial<PetWindowState>) => Promise<void> | void
  windowStatusMessage: string | null
}

export const WindowSection = memo(function WindowSection({
  active,
  draft,
  petWindowState,
  launchOnStartupSupported,
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

      <ToggleField
        label={ti('settings.window.launch_on_startup')}
        field="launchOnStartup"
        draft={draft}
        setDraft={setDraft}
        disabled={!launchOnStartupSupported}
      />

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
        <span>{ti('settings.window.pet_scene_label')}</span>
        <select
          value={draft.petSceneLocation}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              petSceneLocation: event.target.value as PetSceneLocation,
            }))
          }
        >
          {PET_SCENE_LOCATION_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {ti(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.pet_scene_hint')}</p>

      <label>
        <span>{ti('settings.window.pet_weather_label')}</span>
        <select
          value={draft.petWeatherPreview}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              petWeatherPreview: event.target.value as PetWeatherPreview,
            }))
          }
        >
          {PET_WEATHER_PREVIEW_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {ti(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.pet_weather_hint')}</p>

      <label>
        <span>{ti('settings.window.pet_time_label')}</span>
        <select
          value={draft.petTimePreview}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              petTimePreview: event.target.value as PetTimePreview,
            }))
          }
        >
          {PET_TIME_PREVIEW_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {ti(option.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-drawer__hint">{ti('settings.window.pet_time_hint')}</p>

      <ToggleField
        label={ti('settings.window.ambient_weather_toggle')}
        field="ambientWeatherEnabled"
        draft={draft}
        setDraft={setDraft}
      />

      {draft.ambientWeatherEnabled ? (
        <TextField
          label={ti('settings.window.ambient_weather_location_label')}
          field="toolWeatherDefaultLocation"
          placeholder={ti('settings.window.ambient_weather_location_placeholder')}
          draft={draft}
          setDraft={setDraft}
        />
      ) : null}

      <p className="settings-drawer__hint">{ti('settings.window.ambient_weather_hint')}</p>
    </section>
  )
})
