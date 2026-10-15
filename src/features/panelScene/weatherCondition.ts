/**
 * 14 weather states, split by intensity so the ambient layer can tell
 * apart "drizzle" from "暴雨" and "微风" from "大风". Each state has a
 * dedicated visual (sky tint + particle count + accent effects) so two
 * users on different real weather see visibly different scenes.
 *
 * States:
 *   clear · partly_cloudy · overcast
 *   drizzle · rain · heavy_rain
 *   thunder · storm
 *   light_snow · snow · heavy_snow
 *   fog
 *   breeze · gale
 *
 * The input classifier takes an Open-Meteo WMO code + wind speed (km/h)
 * and picks one. Wind becomes the primary condition only when the sky
 * is otherwise clear or lightly cloudy — rain + wind still renders as
 * rain since that's the dominant visual.
 */

export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'thunder'
  | 'storm'
  | 'light_snow'
  | 'snow'
  | 'heavy_snow'
  | 'fog'
  | 'breeze'
  | 'gale'

export type TimeOfDayBand = 'day' | 'dusk' | 'night'

const BREEZE_THRESHOLD_KMH = 20
const GALE_THRESHOLD_KMH = 40

export function classifyWeatherCondition(
  weatherCode: number | null | undefined,
  windSpeedKmh: number | null | undefined,
): WeatherCondition | null {
  if (weatherCode == null) return null
  const base = classifyFromWmoCode(weatherCode)
  if (!base) return null

  const wind = typeof windSpeedKmh === 'number' ? windSpeedKmh : 0
  // Wind wins over sparse-cloud sky states when the air is really moving.
  if (base === 'clear' || base === 'partly_cloudy' || base === 'overcast') {
    if (wind >= GALE_THRESHOLD_KMH) return 'gale'
    if (wind >= BREEZE_THRESHOLD_KMH) return 'breeze'
  }
  return base
}

function classifyFromWmoCode(code: number): WeatherCondition | null {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'partly_cloudy'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if (code === 61 || code === 80) return 'rain'
  if (code === 63 || code === 81) return 'rain'
  if (code === 65 || code === 82) return 'heavy_rain'
  if (code === 66 || code === 67) return 'rain' // freezing rain → rain family
  if (code === 71 || code === 85 || code === 77) return 'light_snow'
  if (code === 73) return 'snow'
  if (code === 75 || code === 86) return 'heavy_snow'
  if (code === 95) return 'thunder'
  if (code === 96 || code === 99) return 'storm'
  return null
}

export function getTimeOfDayBand(date: Date = new Date()): TimeOfDayBand {
  const hour = date.getHours()
  if (hour >= 6 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

export type TimeOfDayBlend = {
  day: number
  dusk: number
  night: number
}

/**
 * Continuous opacity weights for the three backdrop variants. Weights sum
 * to 1; the renderer paints all three stacked at these opacities so the
 * scene gradually mixes through transition windows instead of snapping.
 *
 * Transition windows (2 hours each, centered on the legacy band edges):
 *   05:00-07:00 — night → day
 *   16:00-18:00 — day → dusk
 *   19:00-21:00 — dusk → night
 *
 * Within a window, weight ramps with smoothstep so the rate-of-change
 * tapers near both endpoints — feels like a sunrise/sunset arc rather
 * than a linear fade.
 */
export function getTimeOfDayBlend(date: Date = new Date()): TimeOfDayBlend {
  const t = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600

  const dawnMix = smoothBand(t, 5, 7)         // 0 (night) → 1 (day)
  const duskInMix = smoothBand(t, 16, 18)     // 0 (day) → 1 (dusk)
  const duskOutMix = smoothBand(t, 19, 21)    // 0 (dusk) → 1 (night)

  if (t < 5 || t >= 21) return { day: 0, dusk: 0, night: 1 }
  if (t < 7) return { day: dawnMix, dusk: 0, night: 1 - dawnMix }
  if (t < 16) return { day: 1, dusk: 0, night: 0 }
  if (t < 18) return { day: 1 - duskInMix, dusk: duskInMix, night: 0 }
  if (t < 19) return { day: 0, dusk: 1, night: 0 }
  return { day: 0, dusk: 1 - duskOutMix, night: duskOutMix }
}

function smoothBand(t: number, start: number, end: number): number {
  if (t <= start) return 0
  if (t >= end) return 1
  const x = (t - start) / (end - start)
  return x * x * (3 - 2 * x) // smoothstep
}
