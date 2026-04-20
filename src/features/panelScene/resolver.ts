/**
 * Panel scene switching.
 *
 * The chat panel exposes an optional ambient backdrop that changes with
 * the hour of day (or stays on a fixed user-picked scene). All scenes
 * are pure CSS gradients — no image assets ship, so adding / removing
 * scenes is a CSS-only change and the feature adds zero package weight.
 */

export type PanelSceneId =
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'dusk'
  | 'night'

/**
 * `off`  — no backdrop, panel uses the active theme's base surface color
 *          (current pre-feature behaviour).
 * `auto` — pick a scene by hour-of-day via `resolveActivePanelScene`.
 * A specific `PanelSceneId` — pin the panel to that scene regardless of
 *          the clock. Useful when the user wants a stable look (e.g. always
 *          'night' for late-hours work flow).
 */
export type PanelSceneMode = 'off' | 'auto' | PanelSceneId

export const PANEL_SCENE_IDS: readonly PanelSceneId[] = [
  'morning', 'noon', 'afternoon', 'dusk', 'night',
] as const

/**
 * Map an hour-of-day integer to a scene id. Buckets match the informal
 * greeting buckets in `appSupport.getTimeGreeting` so the backdrop shift
 * tracks the rest of the UI's time awareness (greeting text, etc).
 */
export function pickSceneByHour(hour: number): PanelSceneId {
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 14) return 'noon'
  if (hour >= 14 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 21) return 'dusk'
  return 'night'
}

/**
 * Resolve the scene to render for a given mode + current clock. Returns
 * `null` when the backdrop should be hidden (mode = 'off').
 */
export function resolveActivePanelScene(
  mode: PanelSceneMode,
  now: Date = new Date(),
): PanelSceneId | null {
  if (mode === 'off') return null
  if (mode === 'auto') return pickSceneByHour(now.getHours())
  if ((PANEL_SCENE_IDS as readonly string[]).includes(mode)) return mode
  // Unknown mode (e.g. legacy value from older settings) → fall back to auto.
  return pickSceneByHour(now.getHours())
}

/**
 * Normalize whatever shape came back from storage (arbitrary string, null,
 * legacy value) into a valid `PanelSceneMode`. Unknown values collapse to
 * 'auto' so users never end up with a broken setting on upgrade.
 */
export function normalizePanelSceneMode(raw: unknown): PanelSceneMode {
  if (raw === 'off' || raw === 'auto') return raw
  if (typeof raw === 'string' && (PANEL_SCENE_IDS as readonly string[]).includes(raw)) {
    return raw as PanelSceneId
  }
  return 'auto'
}

import type { PetSceneLocation, PetWeatherPreview } from '../../types'

export const PET_SCENE_LOCATIONS: readonly PetSceneLocation[] = [
  'off', 'city', 'countryside', 'seaside', 'fields', 'mountain',
] as const

export function normalizePetSceneLocation(raw: unknown): PetSceneLocation {
  if (typeof raw === 'string' && (PET_SCENE_LOCATIONS as readonly string[]).includes(raw)) {
    return raw as PetSceneLocation
  }
  return 'off'
}

export const PET_WEATHER_PREVIEWS: readonly PetWeatherPreview[] = [
  'auto', 'clear', 'cloudy', 'fog', 'rain', 'snow', 'thunder', 'wind',
] as const

export function normalizePetWeatherPreview(raw: unknown): PetWeatherPreview {
  if (typeof raw === 'string' && (PET_WEATHER_PREVIEWS as readonly string[]).includes(raw)) {
    return raw as PetWeatherPreview
  }
  return 'auto'
}
