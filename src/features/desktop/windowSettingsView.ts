import type {
  AppSettings,
  PetSceneLocation,
  PetTimePreview,
  PetWeatherPreview,
  PetWindowState,
  TranslationKey,
} from '../../types'

export type WindowOption<T extends string> = {
  id: T
  labelKey: TranslationKey
}

export const PET_SCENE_LOCATION_OPTIONS: Array<WindowOption<PetSceneLocation>> = [
  { id: 'off', labelKey: 'settings.window.pet_scene.off' },
  { id: 'city', labelKey: 'settings.window.pet_scene.city' },
  { id: 'countryside', labelKey: 'settings.window.pet_scene.countryside' },
  { id: 'seaside', labelKey: 'settings.window.pet_scene.seaside' },
  { id: 'fields', labelKey: 'settings.window.pet_scene.fields' },
  { id: 'mountain', labelKey: 'settings.window.pet_scene.mountain' },
]

export const PET_TIME_PREVIEW_OPTIONS: Array<WindowOption<PetTimePreview>> = [
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

export const PET_WEATHER_PREVIEW_OPTIONS: Array<WindowOption<PetWeatherPreview>> = [
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

export type WindowSettingsSummary = {
  startupStatusKey: TranslationKey
  layerStatusKey: TranslationKey
  interactionStatusKey: TranslationKey
  weatherStatusKey: TranslationKey
  sceneLabelKey: TranslationKey
  weatherPreviewLabelKey: TranslationKey
  timePreviewLabelKey: TranslationKey
}

function resolveOptionLabel<T extends string>(
  options: Array<WindowOption<T>>,
  value: T,
  fallback: T,
) {
  return (options.find((option) => option.id === value)
    ?? options.find((option) => option.id === fallback)
    ?? options[0]).labelKey
}

export function resolveWindowSettingsSummary(input: {
  draft: Pick<
    AppSettings,
    | 'ambientWeatherEnabled'
    | 'launchOnStartup'
    | 'petSceneLocation'
    | 'petTimePreview'
    | 'petWeatherPreview'
  >
  launchOnStartupSupported: boolean
  petWindowState: Pick<PetWindowState, 'clickThrough' | 'isPinned'>
}): WindowSettingsSummary {
  return {
    startupStatusKey: !input.launchOnStartupSupported
      ? 'settings.window.status.unavailable'
      : input.draft.launchOnStartup
        ? 'settings.window.status.enabled'
        : 'settings.window.status.disabled',
    layerStatusKey: input.petWindowState.isPinned
      ? 'settings.window.pinned_on_top'
      : 'settings.window.free_window',
    interactionStatusKey: input.petWindowState.clickThrough
      ? 'settings.window.click_through_enabled'
      : 'settings.window.interactive',
    weatherStatusKey: input.draft.ambientWeatherEnabled
      ? 'settings.window.status.enabled'
      : 'settings.window.status.disabled',
    sceneLabelKey: resolveOptionLabel(PET_SCENE_LOCATION_OPTIONS, input.draft.petSceneLocation, 'off'),
    weatherPreviewLabelKey: resolveOptionLabel(PET_WEATHER_PREVIEW_OPTIONS, input.draft.petWeatherPreview, 'auto'),
    timePreviewLabelKey: resolveOptionLabel(PET_TIME_PREVIEW_OPTIONS, input.draft.petTimePreview, 'auto'),
  }
}
