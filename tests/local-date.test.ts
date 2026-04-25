import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isSameLocalDay,
  isSameLocalWeek,
  localDayKey,
  startOfLocalSunday,
} from '../src/lib/localDate.ts'

test('localDayKey: zero-pads month and day', () => {
  const t = new Date('2026-01-05T08:00:00').getTime()
  assert.equal(localDayKey(t), '2026-01-05')
})

test('localDayKey: distinguishes months that would collide unpadded', () => {
  const janOne = new Date('2026-01-01T08:00:00').getTime()
  const oct = new Date('2026-10-01T08:00:00').getTime()
  assert.notEqual(localDayKey(janOne), localDayKey(oct))
})

test('isSameLocalDay: morning + evening same day', () => {
  const morning = new Date('2026-04-26T08:00:00').getTime()
  const evening = new Date('2026-04-26T22:00:00').getTime()
  assert.equal(isSameLocalDay(morning, evening), true)
})

test('isSameLocalDay: across midnight', () => {
  const beforeMidnight = new Date('2026-04-26T23:50:00').getTime()
  const afterMidnight = new Date('2026-04-27T00:10:00').getTime()
  assert.equal(isSameLocalDay(beforeMidnight, afterMidnight), false)
})

test('startOfLocalSunday: Sunday 14:00 → that Sunday 00:00', () => {
  const sun = new Date('2026-04-26T14:00:00').getTime()
  const expected = new Date('2026-04-26T00:00:00').getTime()
  assert.equal(startOfLocalSunday(sun), expected)
})

test('startOfLocalSunday: Wed 12:00 → preceding Sunday 00:00', () => {
  const wed = new Date('2026-04-29T12:00:00').getTime()
  const expected = new Date('2026-04-26T00:00:00').getTime()
  assert.equal(startOfLocalSunday(wed), expected)
})

test('isSameLocalWeek: Sun + Sat in same week', () => {
  const sun = new Date('2026-04-26T19:00:00').getTime()
  const sat = new Date('2026-05-02T10:00:00').getTime()
  assert.equal(isSameLocalWeek(sun, sat), true)
})

test('isSameLocalWeek: Sat + next Sun cross weekly boundary', () => {
  const sat = new Date('2026-04-25T22:00:00').getTime()
  const nextSun = new Date('2026-04-26T01:00:00').getTime()
  assert.equal(isSameLocalWeek(sat, nextSun), false)
})

test('isSameLocalWeek: same Sunday twice', () => {
  const morning = new Date('2026-04-26T08:00:00').getTime()
  const night = new Date('2026-04-26T23:00:00').getTime()
  assert.equal(isSameLocalWeek(morning, night), true)
})
