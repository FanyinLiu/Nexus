import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PET_SCENE_LOCATION_OPTIONS,
  PET_TIME_PREVIEW_OPTIONS,
  PET_WEATHER_PREVIEW_OPTIONS,
  resolveWindowSettingsSummary,
} from '../src/features/desktop/windowSettingsView.ts'

function assertUniqueOptionIds(options: Array<{ id: string }>) {
  assert.equal(new Set(options.map((option) => option.id)).size, options.length)
}

test('desktop setting option groups keep stable unique ids', () => {
  assertUniqueOptionIds(PET_SCENE_LOCATION_OPTIONS)
  assertUniqueOptionIds(PET_TIME_PREVIEW_OPTIONS)
  assertUniqueOptionIds(PET_WEATHER_PREVIEW_OPTIONS)

  assert.equal(PET_SCENE_LOCATION_OPTIONS[0].id, 'off')
  assert.equal(PET_TIME_PREVIEW_OPTIONS[0].id, 'auto')
  assert.equal(PET_WEATHER_PREVIEW_OPTIONS[0].id, 'auto')
})

test('desktop summary reflects startup, layer, interaction and weather states', () => {
  const summary = resolveWindowSettingsSummary({
    draft: {
      ambientWeatherEnabled: true,
      launchOnStartup: true,
      petSceneLocation: 'city',
      petTimePreview: 'night',
      petWeatherPreview: 'rain',
    },
    launchOnStartupSupported: true,
    petWindowState: {
      clickThrough: false,
      isPinned: true,
    },
  })

  assert.equal(summary.startupStatusKey, 'settings.window.status.enabled')
  assert.equal(summary.layerStatusKey, 'settings.window.pinned_on_top')
  assert.equal(summary.interactionStatusKey, 'settings.window.interactive')
  assert.equal(summary.weatherStatusKey, 'settings.window.status.enabled')
  assert.equal(summary.sceneLabelKey, 'settings.window.pet_scene.city')
  assert.equal(summary.weatherPreviewLabelKey, 'settings.window.pet_weather.rain')
  assert.equal(summary.timePreviewLabelKey, 'settings.window.pet_time.night')
})

test('desktop summary reports unavailable startup and falls back for unknown previews', () => {
  const summary = resolveWindowSettingsSummary({
    draft: {
      ambientWeatherEnabled: false,
      launchOnStartup: true,
      petSceneLocation: 'unknown',
      petTimePreview: 'unknown',
      petWeatherPreview: 'unknown',
    } as Parameters<typeof resolveWindowSettingsSummary>[0]['draft'],
    launchOnStartupSupported: false,
    petWindowState: {
      clickThrough: true,
      isPinned: false,
    },
  })

  assert.equal(summary.startupStatusKey, 'settings.window.status.unavailable')
  assert.equal(summary.layerStatusKey, 'settings.window.free_window')
  assert.equal(summary.interactionStatusKey, 'settings.window.click_through_enabled')
  assert.equal(summary.weatherStatusKey, 'settings.window.status.disabled')
  assert.equal(summary.sceneLabelKey, 'settings.window.pet_scene.off')
  assert.equal(summary.weatherPreviewLabelKey, 'settings.window.pet_weather.auto')
  assert.equal(summary.timePreviewLabelKey, 'settings.window.pet_time.auto')
})
