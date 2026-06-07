import { useEffect, useMemo, useRef, useState } from 'react'
import type { WeatherLookupResponse } from '../types'

/**
 * Compact view of the full weather response, tailored for the corner chip.
 * Fields are nullable when the upstream response omitted them (older build,
 * parser failure) so the chip can degrade to "location only" rather than
 * disappearing entirely.
 */
export type AmbientWeatherSnapshot = {
  resolvedName: string
  temperatureC: number | null
  conditionLabel: string
  fullSummary: string
  weatherCode: number | null
  windSpeedKmh: number | null
  fetchedAt: number
}

// Internal shape — tags the snapshot with the query it was produced for so
// the render pass can silently ignore stale data after the user edits the
// location setting (rather than flashing yesterday's weather for the wrong
// city while the next fetch is in flight).
type TaggedSnapshot = AmbientWeatherSnapshot & { forLocation: string }
type AmbientWeatherCacheEntry = {
  snapshot: TaggedSnapshot | null
  fetchedAt: number
  pending: Promise<TaggedSnapshot | null> | null
}

// Open-Meteo refreshes its `current=` payload roughly every 15 minutes,
// so polling faster than that just burns network without seeing newer
// data. Aligning to 15 min keeps us on the freshest cycle.
const POLL_INTERVAL_MS = 15 * 60 * 1000
const FIRST_FETCH_DELAY_MS = 3_000       // let the UI settle before the first call
// Window-focus refresh: when the user comes back to Nexus we kick a
// fresh fetch — but only if the existing snapshot is stale enough to
// be worth the call. Two minutes balances "feels live when I switch
// back" against "don't refetch every alt-tab".
const FOCUS_REFRESH_MIN_AGE_MS = 2 * 60 * 1000
export const AMBIENT_WEATHER_SHARED_CACHE_TTL_MS = FOCUS_REFRESH_MIN_AGE_MS

const ambientWeatherCache = new Map<string, AmbientWeatherCacheEntry>()

function normalizeAmbientWeatherLocation(location: string) {
  return String(location ?? '').trim()
}

function buildAmbientWeatherSnapshot(
  response: WeatherLookupResponse,
  location: string,
  fetchedAt: number,
): TaggedSnapshot {
  const temperature = typeof response.currentTemperature === 'number'
    ? response.currentTemperature
    : null
  return {
    forLocation: location,
    resolvedName: response.resolvedName || location,
    temperatureC: temperature,
    conditionLabel: response.currentConditionLabel ?? '',
    fullSummary: response.currentSummary ?? '',
    weatherCode: typeof response.currentWeatherCode === 'number' ? response.currentWeatherCode : null,
    windSpeedKmh: typeof response.currentWindSpeedKmh === 'number' ? response.currentWindSpeedKmh : null,
    fetchedAt,
  }
}

type AmbientWeatherLoadOptions = {
  now?: () => number
}

export async function loadAmbientWeatherSnapshot(
  location: string,
  options: AmbientWeatherLoadOptions = {},
): Promise<TaggedSnapshot | null> {
  const normalizedLocation = normalizeAmbientWeatherLocation(location)
  if (!normalizedLocation) return null

  const now = options.now ?? Date.now
  const currentTime = now()
  const cached = ambientWeatherCache.get(normalizedLocation)
  if (cached?.pending) {
    return cached.pending
  }
  if (
    cached
    && currentTime - cached.fetchedAt < AMBIENT_WEATHER_SHARED_CACHE_TTL_MS
  ) {
    return cached.snapshot
  }

  const pending = (async () => {
    const previousSnapshot = cached?.snapshot ?? null
    const fetchedAt = now()
    try {
      const response = await window.desktopPet?.getWeather?.({ location: normalizedLocation, quiet: true })
      const snapshot = response
        ? buildAmbientWeatherSnapshot(response as WeatherLookupResponse, normalizedLocation, fetchedAt)
        : previousSnapshot
      ambientWeatherCache.set(normalizedLocation, {
        snapshot,
        fetchedAt,
        pending: null,
      })
      return snapshot
    } catch {
      ambientWeatherCache.set(normalizedLocation, {
        snapshot: previousSnapshot,
        fetchedAt,
        pending: null,
      })
      return previousSnapshot
    }
  })()

  ambientWeatherCache.set(normalizedLocation, {
    snapshot: cached?.snapshot ?? null,
    fetchedAt: cached?.fetchedAt ?? 0,
    pending,
  })
  return pending
}

export function __test_resetAmbientWeatherCache() {
  ambientWeatherCache.clear()
}

/**
 * Poll the existing weather tool IPC (`window.desktopPet.getWeather`) at a
 * leisurely cadence so the panel can render a small ambient weather chip.
 * Silent about failures — the chip just disappears if the network or
 * geocoder falls over, rather than splashing an error in the user's face.
 *
 * Location and enabled flag are read from AppSettings. When either changes
 * we kick a fresh fetch on the next tick instead of waiting for the next
 * half-hour cycle, so editing the location in Settings feels responsive.
 */
export function useAmbientWeather(
  location: string,
  enabled: boolean,
): AmbientWeatherSnapshot | null {
  const [taggedSnapshot, setTaggedSnapshot] = useState<TaggedSnapshot | null>(null)
  // Track in-flight requests so rapid setting edits don't race each other.
  const requestIdRef = useRef(0)

  const trimmedLocation = normalizeAmbientWeatherLocation(location)

  useEffect(() => {
    if (!enabled || !trimmedLocation) return

    let disposed = false
    let firstFetchTimer: number | null = null
    let pollTimer: number | null = null
    let lastFetchedAt = 0

    const runFetch = async () => {
      if (disposed) return
      const requestId = ++requestIdRef.current
      const snapshot = await loadAmbientWeatherSnapshot(trimmedLocation)
      if (disposed || requestId !== requestIdRef.current) return
      if (!snapshot) return
      lastFetchedAt = snapshot.fetchedAt
      setTaggedSnapshot(snapshot)
    }

    firstFetchTimer = window.setTimeout(() => {
      void runFetch()
    }, FIRST_FETCH_DELAY_MS)

    pollTimer = window.setInterval(() => {
      void runFetch()
    }, POLL_INTERVAL_MS)

    // Window-focus refresh — fires when Nexus regains foreground, but
    // only if the snapshot is older than FOCUS_REFRESH_MIN_AGE_MS so
    // alt-tabbing rapidly doesn't blast the API.
    const handleFocus = () => {
      if (disposed) return
      const age = lastFetchedAt === 0 ? Infinity : Date.now() - lastFetchedAt
      if (age >= FOCUS_REFRESH_MIN_AGE_MS) {
        void runFetch()
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      disposed = true
      if (firstFetchTimer !== null) window.clearTimeout(firstFetchTimer)
      if (pollTimer !== null) window.clearInterval(pollTimer)
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, trimmedLocation])

  // Derive the visible snapshot during render. Hides the chip immediately
  // when the feature is disabled or the location was edited to something
  // other than what we last fetched, instead of flashing stale data.
  return useMemo<AmbientWeatherSnapshot | null>(() => {
    if (!enabled || !trimmedLocation) return null
    if (!taggedSnapshot || taggedSnapshot.forLocation !== trimmedLocation) return null
    return {
      resolvedName: taggedSnapshot.resolvedName,
      temperatureC: taggedSnapshot.temperatureC,
      conditionLabel: taggedSnapshot.conditionLabel,
      fullSummary: taggedSnapshot.fullSummary,
      weatherCode: taggedSnapshot.weatherCode,
      windSpeedKmh: taggedSnapshot.windSpeedKmh,
      fetchedAt: taggedSnapshot.fetchedAt,
    }
  }, [enabled, trimmedLocation, taggedSnapshot])
}
