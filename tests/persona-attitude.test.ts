import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  attitudeFor,
  attitudePromptLead,
  attitudeTone,
} from '../src/features/persona/attitude.ts'
import type { PetMood, UiLanguage } from '../src/types'

const LOCALES: UiLanguage[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']
const MOODS: PetMood[] = [
  'thinking',
  'happy',
  'sleepy',
  'surprised',
  'confused',
  'embarrassed',
  'excited',
  'affectionate',
  'proud',
  'curious',
  'worried',
  'playful',
]

test('the dials choose one outward tone, with tsundere winning over volume', () => {
  assert.equal(attitudeTone(undefined), 'neutral')
  assert.equal(attitudeTone({ aloof: 3 }), 'aloof')
  assert.equal(attitudeTone({ clingy: 3 }), 'clingy')
  assert.equal(attitudeTone({ playful: 3 }), 'playful')
  assert.equal(attitudeTone({ tsundere: true }), 'tsundere')
  // A mixed file must not read as two people at once.
  assert.equal(attitudeTone({ aloof: 3, clingy: 3 }), 'aloof')
  assert.equal(attitudeTone({ aloof: 3, tsundere: true }), 'tsundere')
  // Values outside the dial range are clamped by the shared parser.
  assert.equal(attitudeTone({ aloof: 99 }), 'aloof')
  assert.equal(attitudeTone({ clingy: -2 }), 'neutral')
})

test('every mood has a non-empty line in every locale', () => {
  for (const uiLanguage of LOCALES) {
    for (const mood of MOODS) {
      const line = attitudeFor(mood, { aloof: 2 }, { uiLanguage })
      assert.ok(line.trim().length > 0, `${uiLanguage}/${mood} produced no line`)
    }
  }
})

test('idle has no attitude unless she is sulking', () => {
  for (const uiLanguage of LOCALES) {
    assert.equal(attitudeFor('idle', undefined, { uiLanguage }), '')
    assert.ok(attitudeFor('idle', undefined, { uiLanguage, sulky: true }).length > 0)
  }
})

test('the same feeling is expressed differently by aloof and clingy personas', () => {
  for (const uiLanguage of LOCALES) {
    const aloof = attitudeFor('affectionate', { aloof: 3 }, { uiLanguage })
    const clingy = attitudeFor('affectionate', { clingy: 3 }, { uiLanguage })
    assert.notEqual(aloof, clingy, `${uiLanguage}: aloof and clingy should not share a line`)
  }
})

test('a sulking persona gets the hurt line, not the cheerful mood line', () => {
  for (const uiLanguage of LOCALES) {
    const cheerful = attitudeFor('happy', { clingy: 3 }, { uiLanguage })
    const sulky = attitudeFor('happy', { clingy: 3 }, { uiLanguage, sulky: true })
    assert.notEqual(cheerful, sulky, `${uiLanguage}: sulk should override the happy line`)
  }
  // The explicit brief examples: clingy sulks, aloof goes colder.
  assert.match(attitudeFor('happy', { clingy: 3 }, { uiLanguage: 'zh-CN', sulky: true }), /撒嬌|撒娇/)
  assert.match(attitudeFor('happy', { aloof: 3 }, { uiLanguage: 'zh-CN', sulky: true }), /冷/)
})

test('attitude copy stays free of developer jargon', () => {
  const forbidden = /prompt|token|LLM|persona|JSON|本地任务|プロンプト|토큰/i
  for (const uiLanguage of LOCALES) {
    assert.doesNotMatch(attitudePromptLead(uiLanguage), forbidden)
    for (const mood of MOODS) {
      for (const style of [{ aloof: 3 }, { clingy: 3 }, { tsundere: true }, { playful: 3 }]) {
        assert.doesNotMatch(
          attitudeFor(mood, style, { uiLanguage }),
          forbidden,
          `${uiLanguage}/${mood} contains developer jargon`,
        )
      }
      assert.doesNotMatch(
        attitudeFor(mood, { aloof: 3 }, { uiLanguage, sulky: true }),
        forbidden,
      )
    }
  }
})
