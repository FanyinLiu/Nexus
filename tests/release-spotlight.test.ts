import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CURRENT_RELEASE_SPOTLIGHT,
  getReleaseSpotlightTranslationKeys,
} from '../src/features/releaseNotes/index.ts'
import { translationKeys } from '../src/i18n/keys.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function normalizeMarkdownProse(text: string) {
  return text.replace(/[>\s]+/g, ' ').trim()
}

test('current release spotlight keeps the v0.3.5 memorable theme explicit', () => {
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, '0.3.5')
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.bullets.map((item) => item.id),
    ['memory_sources', 'memory_control', 'companion_presence', 'first_run', 'companion_boundary'],
  )
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.actions.map((item) => [item.id, item.targetSectionId]),
    [
      ['review_memory', 'memory'],
      ['preview_companion', 'chat'],
    ],
  )
  assert.ok(
    getReleaseSpotlightTranslationKeys().includes(
      'about.release_spotlight.bullet.companion_presence.title',
    ),
  )
})

test('current release spotlight translation keys are registered for every locale', async () => {
  const registeredKeys = new Set(translationKeys)
  const spotlightKeys = getReleaseSpotlightTranslationKeys()

  for (const key of spotlightKeys) {
    assert.ok(registeredKeys.has(key), `${key} must be listed in translationKeys`)
  }

  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)
    for (const key of spotlightKeys) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}:${key} must be present`)
      assert.ok(value.trim().length > 0, `${locale}:${key} must not be blank`)
      assert.notEqual(value, key, `${locale}:${key} must not fall back to the key name`)
    }
  }
})

test('current release spotlight names the companion presence upgrade in user copy', async () => {
  const en = await ensureLocaleLoaded('en-US')
  const zhCN = await ensureLocaleLoaded('zh-CN')

  assert.match(en['about.release_spotlight.title'], /companion/i)
  assert.match(en['about.release_spotlight.summary'], /idle, thinking, listening, speaking, waiting, error, and offline/)
  assert.match(en['about.release_spotlight.bullet.companion_presence.body'], /status dot and avatar motion/)
  assert.equal(en['about.release_spotlight.action.review_memory'], 'Review Memory')
  assert.equal(en['about.release_spotlight.action.preview_companion'], 'Preview Companion')

  assert.match(zhCN['about.release_spotlight.title'], /伙伴/)
  assert.match(zhCN['about.release_spotlight.summary'], /待机、思考、聆听、说话、等待、错误和离线/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_presence.body'], /状态点和头像动作/)
  assert.equal(zhCN['about.release_spotlight.action.review_memory'], '查看记忆')
  assert.equal(zhCN['about.release_spotlight.action.preview_companion'], '预览伙伴')
})

test('human-facing v0.3.5 docs keep visible memory and companion presence aligned', () => {
  const rootReadme = readWorkspaceFile('README.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')
  const englishReleaseNotes = normalizeMarkdownProse(
    readWorkspaceFile('docs/RELEASE-NOTES-v0.3.5.md'),
  )
  const chineseReleaseNotes = normalizeMarkdownProse(
    readWorkspaceFile('docs/RELEASE-NOTES-v0.3.5.zh-CN.md'),
  )

  assert.match(rootReadme, /记忆看得见，伙伴也动起来/)
  assert.match(rootReadme, /待机、思考、聆听、说话、等待、错误和离线状态/)
  assert.match(rootReadme, /不把 Nexus 做成替你干活的 Codex 式智能体/)

  assert.match(englishReleaseNotes, /Memory is visible\. The companion feels present\./)
  assert.match(englishReleaseNotes, /idle, thinking, listening, speaking, waiting, error, and offline/)
  assert.match(englishReleaseNotes, /not autonomous work execution/)

  assert.match(chineseReleaseNotes, /记忆看得见，伙伴也动起来/)
  assert.match(chineseReleaseNotes, /待机、思考、聆听、说话、等待、错误和离线状态/)
  assert.match(chineseReleaseNotes, /不是把 Nexus 做成替你干活的 Codex 式智能体/)

  const unreleasedSection = changelog.split('## [0.3.5]')[0]
  assert.match(unreleasedSection, /## \[Unreleased\]\s+_No changes yet\._/)
  assert.doesNotMatch(unreleasedSection, /v0\.3\.5|Desktop presence|release spotlight/i)

  const releaseSection = changelog.split('## [0.3.5]')[1]?.split('\n## [')[0] ?? ''
  assert.match(releaseSection, /Release theme: visible memory and readable companion presence/)
  assert.match(releaseSection, /Desktop presence state contract/)
  assert.match(releaseSection, /Settings home release spotlight/)
  assert.match(releaseSection, /Release theme guard/)
})

test('v0.3.5 release handoff keeps merge and tag evidence explicit', () => {
  const handoff = readWorkspaceFile('docs/RELEASE-CANDIDATE-v0.3.5-HANDOFF.md')

  assert.match(handoff, /PR: \[#105/)
  assert.match(handoff, /Evidence baseline head: `48e6b78`/)
  assert.match(handoff, /verify the latest PR head and latest\s+GitHub CI/)
  assert.match(handoff, /npm run prerelease-check -- v0\.3\.5/)
  assert.match(handoff, /git tag v0\.3\.5/)
  assert.match(handoff, /npm run package:dir:smoke/)
  assert.match(handoff, /npm run pet:presence-smoke/)
  assert.match(handoff, /22 blocker checks/)
  assert.match(handoff, /Developer ID/)
  assert.match(handoff, /SmartScreen/)
  assert.match(handoff, /node:sqlite/)
  assert.match(handoff, /Codex-style work agent/)
  assert.match(handoff, /Live2D/)
  assert.match(handoff, /voice MVP/)
  assert.match(handoff, /white-box long-term memory/)
})
