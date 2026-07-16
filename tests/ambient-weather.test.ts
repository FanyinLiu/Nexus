import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  AMBIENT_WEATHER_SHARED_CACHE_TTL_MS,
  __test_resetAmbientWeatherCache,
  loadAmbientWeatherSnapshot,
} from '../src/hooks/useAmbientWeather.ts'

beforeEach(() => {
  __test_resetAmbientWeatherCache()
})

function installWeatherStub(handler: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      desktopPet: {
        getWeather: handler,
      },
    },
    configurable: true,
    writable: true,
  })
}

test('loadAmbientWeatherSnapshot shares concurrent requests for the same location', async () => {
  let callCount = 0
  const payloads: Array<Record<string, unknown>> = []
  const now = 1_000
  installWeatherStub(async (payload) => {
    payloads.push(payload)
    callCount += 1
    await Promise.resolve()
    return {
      resolvedName: 'Shenzhen',
      currentTemperature: 26.4,
      currentConditionLabel: 'Cloudy',
      currentSummary: 'Cloudy, 26 C',
      currentWeatherCode: 3,
      currentWindSpeedKmh: 8,
    }
  })

  const first = loadAmbientWeatherSnapshot(' Shenzhen ', { now: () => now })
  const second = loadAmbientWeatherSnapshot('Shenzhen', { now: () => now })
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])

  assert.equal(callCount, 1)
  assert.equal((payloads[0].policy as Record<string, unknown>).enabled, true)
  assert.equal((payloads[0].policy as Record<string, unknown>).requiresConfirmation, false)
  assert.equal(firstSnapshot, secondSnapshot)
  assert.equal(firstSnapshot?.resolvedName, 'Shenzhen')
  assert.equal(firstSnapshot?.temperatureC, 26.4)
  assert.equal(firstSnapshot?.forLocation, 'Shenzhen')
  assert.equal(firstSnapshot?.forLocale, 'zh-CN')
})

test('loadAmbientWeatherSnapshot scopes requests and cache entries by locale', async () => {
  const payloads: Array<Record<string, unknown>> = []
  installWeatherStub(async (payload) => {
    payloads.push(payload)
    return {
      resolvedName: 'Tokyo',
      currentTemperature: 20,
      currentConditionLabel: payload.locale === 'ja' ? '晴れ' : 'clear',
      currentSummary: payload.locale === 'ja' ? '現在20°C、晴れ' : 'Currently 20°C, clear',
      currentWeatherCode: 0,
      currentWindSpeedKmh: 2,
    }
  })

  const english = await loadAmbientWeatherSnapshot('Tokyo', { locale: 'en-US', now: () => 1_000 })
  const japanese = await loadAmbientWeatherSnapshot('Tokyo', { locale: 'ja', now: () => 1_000 })
  const englishCached = await loadAmbientWeatherSnapshot('Tokyo', { locale: 'en-US', now: () => 1_001 })

  assert.equal(payloads.length, 2)
  assert.deepEqual(payloads.map((payload) => payload.locale), ['en-US', 'ja'])
  assert.equal(english?.conditionLabel, 'clear')
  assert.equal(japanese?.conditionLabel, '晴れ')
  assert.equal(englishCached, english)
})

test('loadAmbientWeatherSnapshot reuses a fresh cached snapshot then refreshes after ttl', async () => {
  let callCount = 0
  let now = 10_000
  installWeatherStub(async () => {
    callCount += 1
    return {
      resolvedName: 'Tokyo',
      currentTemperature: 20 + callCount,
      currentConditionLabel: 'Clear',
      currentSummary: 'Clear',
      currentWeatherCode: 0,
      currentWindSpeedKmh: 3,
    }
  })

  const first = await loadAmbientWeatherSnapshot('Tokyo', { now: () => now })
  now += AMBIENT_WEATHER_SHARED_CACHE_TTL_MS - 1
  const cached = await loadAmbientWeatherSnapshot('Tokyo', { now: () => now })
  now += 2
  const refreshed = await loadAmbientWeatherSnapshot('Tokyo', { now: () => now })

  assert.equal(callCount, 2)
  assert.equal(cached, first)
  assert.notEqual(refreshed, first)
  assert.equal(first?.temperatureC, 21)
  assert.equal(refreshed?.temperatureC, 22)
})

test('loadAmbientWeatherSnapshot keeps the last successful snapshot when a refresh fails', async () => {
  let callCount = 0
  let now = 20_000
  installWeatherStub(async () => {
    callCount += 1
    if (callCount === 1) {
      return {
        resolvedName: 'Kyoto',
        currentTemperature: 18,
        currentConditionLabel: 'Rain',
        currentSummary: 'Rain',
        currentWeatherCode: 61,
        currentWindSpeedKmh: 11,
      }
    }
    throw new Error('weather unavailable')
  })

  const first = await loadAmbientWeatherSnapshot('Kyoto', { now: () => now })
  now += AMBIENT_WEATHER_SHARED_CACHE_TTL_MS + 1
  const fallback = await loadAmbientWeatherSnapshot('Kyoto', { now: () => now })

  assert.equal(callCount, 2)
  assert.equal(fallback, first)
  assert.equal(fallback?.resolvedName, 'Kyoto')
})
