import { memo, type Dispatch, type SetStateAction } from 'react'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type {
  AppSettings,
  PetSceneLocation,
  PetTimePreview,
  PetWeatherPreview,
  PetWindowState,
  TranslationKey,
  UiLanguage,
} from '../../types'
import {
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
} from './SettingsV3Primitives'

const SCENE_OPTIONS: Array<{ id: PetSceneLocation; labelKey: TranslationKey }> = [
  { id: 'off', labelKey: 'settings.window.pet_scene.off' },
  { id: 'city', labelKey: 'settings.window.pet_scene.city' },
  { id: 'countryside', labelKey: 'settings.window.pet_scene.countryside' },
  { id: 'seaside', labelKey: 'settings.window.pet_scene.seaside' },
  { id: 'fields', labelKey: 'settings.window.pet_scene.fields' },
  { id: 'mountain', labelKey: 'settings.window.pet_scene.mountain' },
]

const WEATHER_OPTIONS: Array<{ id: PetWeatherPreview; labelKey: TranslationKey }> = [
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

const TIME_OPTIONS: Array<{ id: PetTimePreview; labelKey: TranslationKey }> = [
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

export type WindowSectionV3Props = {
  active: boolean
  draft: AppSettings
  petWindowState: PetWindowState
  launchOnStartupSupported: boolean
  showLegacyEnvironmentControls: boolean
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
  updateWindowState: (partial: Partial<PetWindowState>) => Promise<void> | void
  windowStatusMessage: string | null
}

export const WindowSectionV3 = memo(function WindowSectionV3({
  active,
  draft,
  petWindowState,
  launchOnStartupSupported,
  showLegacyEnvironmentControls,
  setDraft,
  uiLanguage,
  updateWindowState,
  windowStatusMessage,
}: WindowSectionV3Props) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)

  const setSetting = <TKey extends keyof AppSettings>(key: TKey, value: AppSettings[TKey]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <SettingsV3Page className={active ? '' : 'is-hidden'}>
      {windowStatusMessage ? <SettingsV3Notice tone="success" title={windowStatusMessage} announce /> : null}

      <SettingsV3Section
        title={ti('settings.section.window')}
        hideHeader
      >
        <SettingsV3Row
          icon="settings"
          label={ti('settings.window.launch_on_startup')}
          hint={ti('settings.window.launch_note')}
          disabled={!launchOnStartupSupported}
        >
          <SettingsV3Switch
            label={ti('settings.window.launch_on_startup')}
            checked={draft.launchOnStartup}
            disabled={!launchOnStartupSupported}
            onChange={(launchOnStartup) => setSetting('launchOnStartup', launchOnStartup)}
          />
        </SettingsV3Row>
        <SettingsV3Row
          icon="pin"
          label={petWindowState.isPinned ? ti('settings.window.pinned_on_top') : ti('settings.window.free_window')}
          hint={ti('settings.window.pinned_note')}
        >
          <SettingsV3Switch
            label={ti('settings.window.pinned_on_top')}
            checked={petWindowState.isPinned}
            onChange={(isPinned) => void updateWindowState({ isPinned })}
          />
        </SettingsV3Row>
        <SettingsV3Row
          icon="pointer"
          label={petWindowState.clickThrough ? ti('settings.window.click_through_enabled') : ti('settings.window.interactive')}
          hint={ti('settings.window.click_through_note')}
        >
          <SettingsV3Switch
            label={ti('settings.window.click_through_enabled')}
            checked={petWindowState.clickThrough}
            onChange={(clickThrough) => void updateWindowState({ clickThrough })}
          />
        </SettingsV3Row>
      </SettingsV3Section>

      {showLegacyEnvironmentControls ? (
        <>
          <SettingsV3Section
            title={ti('settings.window.group_scene')}
            description={ti('settings.window.group_scene_hint')}
          >
            <SettingsV3Field label={ti('settings.window.pet_scene_label')}>
              <select
                value={draft.petSceneLocation}
                onChange={(event) => setSetting('petSceneLocation', event.target.value as PetSceneLocation)}
              >
                {SCENE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{ti(option.labelKey)}</option>
                ))}
              </select>
            </SettingsV3Field>
            <SettingsV3Field label={ti('settings.window.pet_weather_label')}>
              <select
                value={draft.petWeatherPreview}
                onChange={(event) => setSetting('petWeatherPreview', event.target.value as PetWeatherPreview)}
              >
                {WEATHER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{ti(option.labelKey)}</option>
                ))}
              </select>
            </SettingsV3Field>
            <SettingsV3Field label={ti('settings.window.pet_time_label')}>
              <select
                value={draft.petTimePreview}
                onChange={(event) => setSetting('petTimePreview', event.target.value as PetTimePreview)}
              >
                {TIME_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{ti(option.labelKey)}</option>
                ))}
              </select>
            </SettingsV3Field>
          </SettingsV3Section>

          <SettingsV3Section
            title={ti('settings.window.group_weather')}
            description={ti('settings.window.group_weather_hint')}
          >
            <SettingsV3Row
              icon="tuning"
              label={ti('settings.window.ambient_weather_toggle')}
            >
              <SettingsV3Switch
                label={ti('settings.window.ambient_weather_toggle')}
                checked={draft.ambientWeatherEnabled}
                onChange={(ambientWeatherEnabled) => setSetting('ambientWeatherEnabled', ambientWeatherEnabled)}
              />
            </SettingsV3Row>
            {draft.ambientWeatherEnabled ? (
              <SettingsV3Field label={ti('settings.window.ambient_weather_location_label')}>
                <input
                  value={draft.toolWeatherDefaultLocation}
                  placeholder={ti('settings.window.ambient_weather_location_placeholder')}
                  onChange={(event) => setSetting('toolWeatherDefaultLocation', event.target.value)}
                />
              </SettingsV3Field>
            ) : null}
          </SettingsV3Section>
        </>
      ) : null}
    </SettingsV3Page>
  )
})
