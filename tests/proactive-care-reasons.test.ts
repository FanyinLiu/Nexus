import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatAwayCareVisibleReason,
  formatBracketCareVisibleReason,
  formatFutureCapsuleCareVisibleReason,
  formatOpenArcCareVisibleReason,
} from '../src/features/proactive/proactiveCareReasons.ts'

test('away care visible reasons explain fired and quiet-hour decisions', () => {
  assert.match(
    formatAwayCareVisibleReason({
      hasLastUserMessage: true,
      outcome: 'fired',
      reason: 'fire',
      thresholdMinutes: 45,
      uiLanguage: 'zh-CN',
    }),
    /45 分钟/,
  )
  assert.match(
    formatAwayCareVisibleReason({
      hasLastUserMessage: true,
      outcome: 'skipped',
      reason: 'quiet_hours',
      thresholdMinutes: 45,
      uiLanguage: 'en-US',
    }),
    /quiet hours/,
  )
})

test('daily bracket visible reasons cover rate-limit skips and errand delivery', () => {
  assert.match(
    formatBracketCareVisibleReason({
      deliveredErrand: false,
      outcome: 'skipped',
      reason: 'morning_already_fired_today',
      uiLanguage: 'en-US',
    }),
    /already fired today/,
  )
  assert.match(
    formatBracketCareVisibleReason({
      bracket: 'morning',
      deliveredErrand: true,
      outcome: 'fired',
      reason: 'fire',
      uiLanguage: 'zh-CN',
    }),
    /已完成事项/,
  )
})

test('open arc visible reasons explain milestones and no-due states', () => {
  assert.match(
    formatOpenArcCareVisibleReason({
      milestoneDay: 5,
      openArcCount: 1,
      outcome: 'fired',
      reason: 'fire',
      uiLanguage: 'en-US',
    }),
    /day 5/,
  )
  assert.match(
    formatOpenArcCareVisibleReason({
      openArcCount: 2,
      outcome: 'skipped',
      reason: 'no-milestone-due',
      uiLanguage: 'zh-CN',
    }),
    /下一个跟进里程碑/,
  )
})

test('future capsule visible reasons distinguish due and no-due decisions', () => {
  assert.match(
    formatFutureCapsuleCareVisibleReason({
      outcome: 'fired',
      reason: 'fire',
      uiLanguage: 'zh-CN',
    }),
    /递送时间/,
  )
  assert.match(
    formatFutureCapsuleCareVisibleReason({
      outcome: 'skipped',
      reason: 'no_due_capsule',
      uiLanguage: 'en-US',
    }),
    /No future capsule was due/,
  )
})
