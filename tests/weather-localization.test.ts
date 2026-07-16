import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatWeatherContentForLocale,
  getWeatherLocalizationCopy,
  normalizeWeatherLocale,
} from '../electron/tools/weatherLocalization.js'
import {
  buildBuiltInToolAssistantSummary,
  buildBuiltInToolSpeechSummary,
} from '../src/features/tools/assistant.ts'
import { stripLocalizedWeatherPeriodPrefix } from '../src/features/tools/weatherText.ts'
import type { UiLanguage, WeatherLookupResponse } from '../src/types/index.ts'

const fixture = {
  current: {
    temperature_2m: 22,
    apparent_temperature: 19,
    relative_humidity_2m: 62,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 8,
    is_day: 1,
    time: '2026-07-13T12:00',
  },
  daily: {
    time: ['2026-07-13', '2026-07-14', '2026-07-15'],
    weather_code: [2, 61, 3],
    temperature_2m_min: [18, 17, 16],
    temperature_2m_max: [25, 22, 24],
    precipitation_probability_max: [10, 70, 20],
    precipitation_sum: [0, 3.2, 0],
  },
  hourly: {
    time: [],
    precipitation_probability: [],
    weather_code: [],
  },
}

const localeExpectations: Record<UiLanguage, {
  current: RegExp
  condition: string
  today: RegExp
  tomorrow: RegExp
  assistant: RegExp
  speech: RegExp
}> = {
  'zh-CN': { current: /当前22°C/u, condition: '局部多云', today: /^今天/u, tomorrow: /^明天/u, assistant: /^我先总结一下/u, speech: /^好的，主人/u },
  'zh-TW': { current: /目前22°C/u, condition: '局部多雲', today: /^今天/u, tomorrow: /^明天/u, assistant: /^我先總結一下/u, speech: /^好的，主人/u },
  'en-US': { current: /Currently 22°C/u, condition: 'partly cloudy', today: /^Today/u, tomorrow: /^Tomorrow/u, assistant: /^Here is the weather summary/u, speech: /^Sure/u },
  ja: { current: /現在22°C/u, condition: '一部くもり', today: /^今日/u, tomorrow: /^明日/u, assistant: /^天気をまとめます/u, speech: /^はい/u },
  ko: { current: /현재 22°C/u, condition: '구름 조금', today: /^오늘/u, tomorrow: /^내일/u, assistant: /^날씨를 요약하면/u, speech: /^좋아요/u },
}

test('Electron weather formatter localizes conditions and summaries in all supported UI languages', () => {
  for (const [locale, expected] of Object.entries(localeExpectations) as Array<[UiLanguage, typeof localeExpectations[UiLanguage]]>) {
    const result = formatWeatherContentForLocale(fixture, locale)
    assert.match(result.currentSummary, expected.current)
    assert.equal(result.currentConditionLabel, expected.condition)
    assert.match(result.todaySummary, expected.today)
    assert.match(result.tomorrowSummary, expected.tomorrow)
    assert.equal(result.currentTemperature, 22)
    assert.equal(result.currentWeatherCode, 2)
  }
})

test('weather formatter keeps nullish numeric fields unknown across all locales', () => {
  const cases = [
    {
      name: 'unknown weather code',
      current: {
        temperature_2m: null,
        apparent_temperature: null,
        relative_humidity_2m: null,
        precipitation: null,
        weather_code: 999,
        wind_speed_10m: null,
      },
      expectedWeatherCode: 999,
      expectedCondition: {
        'zh-CN': '天气变化中',
        'zh-TW': '天氣變化中',
        'en-US': 'changing conditions',
        ja: '変わりやすい天気',
        ko: '변화가 잦은 날씨',
      } as Record<UiLanguage, string>,
    },
    {
      name: 'null/missing weather code',
      current: {},
      expectedWeatherCode: null,
      expectedCondition: {
        'zh-CN': '天气变化中',
        'zh-TW': '天氣變化中',
        'en-US': 'changing conditions',
        ja: '変わりやすい天気',
        ko: '변화가 잦은 날씨',
      } as Record<UiLanguage, string>,
    },
  ] as const

  for (const locale of Object.keys(localeExpectations) as UiLanguage[]) {
    for (const weatherCase of cases) {
      const result = formatWeatherContentForLocale({
        current: weatherCase.current,
        daily: { time: ['2026-07-13'] },
        hourly: {},
      }, locale)

      assert.equal(result.currentTemperature, null, `${locale} ${weatherCase.name} temperature`)
      assert.equal(result.currentWeatherCode, weatherCase.expectedWeatherCode, `${locale} ${weatherCase.name} weather code`)
      assert.equal(result.currentHumidity, null, `${locale} ${weatherCase.name} humidity`)
      assert.equal(result.currentWindSpeedKmh, null, `${locale} ${weatherCase.name} wind`)
      assert.equal(result.currentPrecipitationMm, null, `${locale} ${weatherCase.name} precipitation`)
      assert.doesNotMatch(result.currentSummary, /0°C/u, `${locale} ${weatherCase.name} summary`)
      assert.equal(result.currentConditionLabel, weatherCase.expectedCondition[locale])
    }
  }
})

test('weather errors and provider language follow the requested locale with a safe fallback', () => {
  assert.match(getWeatherLocalizationCopy('en-US').locationRequired, /requires a city or region/u)
  assert.match(getWeatherLocalizationCopy('ja').forecastTimeout, /タイムアウト/u)
  assert.match(getWeatherLocalizationCopy('ko').placeNotFound('서울'), /서울/u)
  assert.equal(getWeatherLocalizationCopy('zh-TW').nominatimLanguage, 'zh-TW')
  assert.equal(normalizeWeatherLocale('not-a-locale'), 'zh-CN')
})

test('weather assistant and fallback speech use the same five-language locale', () => {
  for (const [locale, expected] of Object.entries(localeExpectations) as Array<[UiLanguage, typeof localeExpectations[UiLanguage]]>) {
    const localized = formatWeatherContentForLocale(fixture, locale)
    const result = {
      kind: 'weather' as const,
      systemMessage: '',
      promptContext: '',
      assistantSummary: '',
      result: {
        location: 'Tokyo',
        resolvedName: 'Tokyo',
        message: '',
        ...localized,
      } satisfies WeatherLookupResponse,
    }

    assert.match(buildBuiltInToolAssistantSummary(result, locale), expected.assistant)
    assert.match(buildBuiltInToolSpeechSummary(result, locale), expected.speech)
  }
})

test('period prefix compatibility accepts current five-language and archived Chinese summaries', () => {
  assert.equal(stripLocalizedWeatherPeriodPrefix('Today, clear', 'today'), 'clear')
  assert.equal(stripLocalizedWeatherPeriodPrefix('今日、晴れ', 'today'), '晴れ')
  assert.equal(stripLocalizedWeatherPeriodPrefix('오늘, 맑음', 'today'), '맑음')
  assert.equal(stripLocalizedWeatherPeriodPrefix('今天，小雨', 'today'), '小雨')
  assert.equal(stripLocalizedWeatherPeriodPrefix('明天，小雨', 'tomorrow'), '小雨')
})
