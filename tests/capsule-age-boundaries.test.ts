/**
 * Capsule age boundaries: calendar-day counting and floored prose.
 *
 * The opener speaks in whole calendar days: a letter written late at night is
 * one day old the next morning even after nine hours, and the age never rounds
 * up into the next band. These tests pin both the floor mapping and the local
 * calendar rule in every locale.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildFutureCapsuleDelivery,
  daysBetween,
  formatCapsuleAge,
} from '../src/features/futureCapsule/futureCapsuleDelivery.ts'
import type { FutureCapsuleRecord } from '../src/features/futureCapsule/futureCapsuleStore.ts'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'] as const
type Locale = typeof LOCALES[number]

await Promise.all(LOCALES.map((locale) => ensureLocaleLoaded(locale)))

const ONE_DAY = {
  'zh-CN': '1天前',
  'zh-TW': '1天前',
  'en-US': 'a day ago',
  ja: '1日前',
  ko: '1일 전',
} as const satisfies Record<Locale, string>

const DAYS_59 = {
  'zh-CN': '59天前',
  'zh-TW': '59天前',
  'en-US': '59 days ago',
  ja: '59日前',
  ko: '59일 전',
} as const satisfies Record<Locale, string>

const MONTHS_2 = {
  'zh-CN': '2个月前',
  'zh-TW': '2個月前',
  'en-US': '2 months ago',
  ja: '2か月前',
  ko: '2개월 전',
} as const satisfies Record<Locale, string>

const MONTHS_11 = {
  'zh-CN': '11个月前',
  'zh-TW': '11個月前',
  'en-US': '11 months ago',
  ja: '11か月前',
  ko: '11개월 전',
} as const satisfies Record<Locale, string>

const ONE_YEAR = {
  'zh-CN': '一年前',
  'zh-TW': '一年前',
  'en-US': 'a year ago',
  ja: '1年前',
  ko: '1년 전',
} as const satisfies Record<Locale, string>

const YEARS_2 = {
  'zh-CN': '2年前',
  'zh-TW': '2年前',
  'en-US': '2 years ago',
  ja: '2年前',
  ko: '2년 전',
} as const satisfies Record<Locale, string>

const OPENER_BY_LOCALE: Record<Locale, (age: string) => string> = {
  'zh-CN': (age) => `你${age}写给今天的信，到了。`,
  'zh-TW': (age) => `你${age}寫給今天的信，到了。`,
  'en-US': (age) => `The letter you wrote ${age} for today is here.`,
  ja: (age) => `${age}のあなたから、今日のあなたへの手紙が届きました。`,
  ko: (age) => `${age}의 당신이 오늘의 당신에게 쓴 편지가 도착했어요.`,
}

const FLOOR_CASES: Array<{ input: number; expected: Record<Locale, string>; label: string }> = [
  { input: 0.4, expected: ONE_DAY, label: '0.4 days → one day' },
  { input: 59.9, expected: DAYS_59, label: '59.9 days → 59 days, not 60' },
  { input: 60.9, expected: MONTHS_2, label: '60.9 days → 2 months, not 60/61 days' },
  { input: 89.9, expected: MONTHS_2, label: '89.9 days → 2 months' },
  { input: 359.5, expected: MONTHS_11, label: '359.5 days → 11 months' },
  { input: 364.9, expected: MONTHS_11, label: '364.9 days → 11 months (capped), not one year' },
  { input: 729.9, expected: ONE_YEAR, label: '729.9 days → one year, not 2 years' },
  { input: 730, expected: YEARS_2, label: '730 days → 2 years' },
  { input: 1094.9, expected: YEARS_2, label: '1094.9 days → 2 years' },
]

for (const floorCase of FLOOR_CASES) {
  test(`formatCapsuleAge floors: ${floorCase.label}`, () => {
    for (const locale of LOCALES) {
      assert.equal(
        formatCapsuleAge(floorCase.input, locale),
        floorCase.expected[locale],
        `${locale}:${floorCase.input}`,
      )
    }
  })
}

test('the month band is capped at 11 months', () => {
  for (const locale of LOCALES) {
    for (const days of [330, 359, 360, 362, 364]) {
      assert.equal(formatCapsuleAge(days, locale), MONTHS_11[locale], `${locale}:${days}`)
    }
    assert.equal(formatCapsuleAge(365, locale), ONE_YEAR[locale], `${locale}:365`)
    assert.equal(formatCapsuleAge(364.999, locale), MONTHS_11[locale], `${locale}:364.999`)
    for (let days = 300; days <= 364; days += 1) {
      assert.doesNotMatch(
        formatCapsuleAge(days, locale),
        /12/,
        `${locale}:${days} must never render 12 months`,
      )
    }
  }
})

const baseCapsule: FutureCapsuleRecord = {
  id: 'age-boundary',
  message: 'Keep going',
  createdAt: '2026-01-01T00:00:00.000Z',
  scheduledFor: '2026-05-01',
  status: 'pending',
}

function deliveryAt(locale: Locale, written: Date, now: Date) {
  return buildFutureCapsuleDelivery({
    uiLanguage: locale,
    capsule: { ...baseCapsule, createdAt: written.toISOString() },
    now,
  })
}

const CALENDAR_CASES: Array<{
  label: string
  written: () => Date
  now: () => Date
  days: number
  age: Record<Locale, string>
}> = [
  {
    label: 'written 23:00, opened next morning 08:00 (9 hours)',
    written: () => new Date(2026, 4, 1, 23, 0),
    now: () => new Date(2026, 4, 2, 8, 0),
    days: 1,
    age: ONE_DAY,
  },
  {
    label: 'written 00:30, opened next day 01:00 (24.5 hours)',
    written: () => new Date(2026, 4, 1, 0, 30),
    now: () => new Date(2026, 4, 2, 1, 0),
    days: 1,
    age: ONE_DAY,
  },
  {
    label: 'written 08:00, opened next day 23:59 (~40 hours)',
    written: () => new Date(2026, 4, 1, 8, 0),
    now: () => new Date(2026, 4, 2, 23, 59),
    days: 1,
    age: ONE_DAY,
  },
  {
    label: 'written 10:00, opened the same day at 22:00',
    written: () => new Date(2026, 4, 1, 10, 0),
    now: () => new Date(2026, 4, 1, 22, 0),
    days: 0,
    age: ONE_DAY,
  },
  {
    label: '60 calendar days apart but under 60 elapsed days',
    written: () => new Date(2026, 0, 1, 23, 0),
    now: () => new Date(2026, 2, 2, 1, 0),
    days: 60,
    age: MONTHS_2,
  },
  {
    label: '364 calendar days apart stays at 11 months, not one year',
    written: () => new Date(2025, 0, 1, 10, 0),
    now: () => new Date(2025, 11, 31, 9, 0),
    days: 364,
    age: MONTHS_11,
  },
  {
    label: '365 calendar days apart is one year',
    written: () => new Date(2025, 0, 1, 10, 0),
    now: () => new Date(2026, 0, 1, 9, 0),
    days: 365,
    age: ONE_YEAR,
  },
]

for (const calendarCase of CALENDAR_CASES) {
  test(`daysBetween uses the local calendar: ${calendarCase.label}`, () => {
    const written = calendarCase.written()
    const now = calendarCase.now()
    assert.equal(daysBetween(written.toISOString(), now), calendarCase.days)
    for (const locale of LOCALES) {
      assert.equal(
        deliveryAt(locale, written, now).opener,
        OPENER_BY_LOCALE[locale](calendarCase.age[locale]),
        locale,
      )
    }
  })
}

for (const zone of ['America/Los_Angeles', 'Asia/Shanghai'] as const) {
  test(`daysBetween follows the local calendar in ${zone}`, () => {
    const original = process.env.TZ
    process.env.TZ = zone
    try {
      // Late night to next morning is one calendar day, even when only 9 hours
      // pass and the two instants fall on the same UTC date.
      const writtenMorning = new Date(2026, 4, 1, 23, 0)
      const nowMorning = new Date(2026, 4, 2, 8, 0)
      assert.equal(daysBetween(writtenMorning.toISOString(), nowMorning), 1)

      // The same local day can span two UTC dates; it is still zero days old.
      const writtenSameDay = new Date(2026, 4, 1, 10, 0)
      const nowSameDay = new Date(2026, 4, 1, 22, 0)
      assert.equal(daysBetween(writtenSameDay.toISOString(), nowSameDay), 0)
      assert.equal(
        deliveryAt('en-US', writtenSameDay, nowSameDay).opener,
        OPENER_BY_LOCALE['en-US'](ONE_DAY['en-US']),
      )
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
}
