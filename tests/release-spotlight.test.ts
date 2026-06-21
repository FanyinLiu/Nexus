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

test('current release spotlight keeps the v0.4.0 stable companion awareness explicit', () => {
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, '0.4.0')
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

test('current release spotlight names desktop companion awareness in user copy', async () => {
  const en = await ensureLocaleLoaded('en-US')
  const zhCN = await ensureLocaleLoaded('zh-CN')

  assert.match(en['about.release_spotlight.title'], /Desktop companion awareness/i)
  assert.match(en['about.release_spotlight.summary'], /stable release/)
  assert.match(en['about.release_spotlight.summary'], /rough time language/)
  assert.match(en['about.release_spotlight.bullet.first_run.body'], /proactive check-in expansion/)
  assert.match(en['about.release_spotlight.bullet.companion_presence.body'], /pause or clear/)
  assert.equal(en['about.release_spotlight.action.review_memory'], 'Review Memory')
  assert.equal(en['about.release_spotlight.action.preview_companion'], 'Preview Companion')

  assert.match(zhCN['about.release_spotlight.title'], /桌面陪伴感知/)
  assert.match(zhCN['about.release_spotlight.summary'], /稳定版/)
  assert.match(zhCN['about.release_spotlight.summary'], /粗略时间/)
  assert.match(zhCN['about.release_spotlight.bullet.first_run.body'], /主动 check-in 扩展/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_presence.body'], /暂停或清理近期摘要/)
  assert.equal(zhCN['about.release_spotlight.action.review_memory'], '查看记忆')
  assert.equal(zhCN['about.release_spotlight.action.preview_companion'], '预览伙伴')
})

test('human-facing v0.3.6 docs keep foundation wrap-up aligned', () => {
  const rootReadme = readWorkspaceFile('README.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')
  const englishReleaseNotes = normalizeMarkdownProse(
    readWorkspaceFile('docs/RELEASE-NOTES-v0.3.6.md'),
  )
  const chineseReleaseNotes = normalizeMarkdownProse(
    readWorkspaceFile('docs/RELEASE-NOTES-v0.3.6.zh-CN.md'),
  )

  assert.match(rootReadme, /0\.3 的地基收尾/)
  assert.match(rootReadme, /当前窗口、剪贴板、OCR/)
  assert.match(rootReadme, /0\.4\.0 才开始真正的桌面陪伴感知/)

  assert.match(englishReleaseNotes, /The foundation is ready for the next companion step\./)
  assert.match(englishReleaseNotes, /active-window context[\s\S]*clipboard context[\s\S]*screen OCR/)
  assert.match(englishReleaseNotes, /No time-passing proactive companionship loop yet/)

  assert.match(chineseReleaseNotes, /0\.3 的地基收尾/)
  assert.match(chineseReleaseNotes, /当前窗口上下文[\s\S]*剪贴板上下文[\s\S]*屏幕文字 OCR/)
  assert.match(chineseReleaseNotes, /不做“时间流逝后的主动陪伴”主循环/)

  const unreleasedSection = changelog.split('## [0.4.0]')[0]
  assert.match(unreleasedSection, /## \[Unreleased\]/)
  assert.doesNotMatch(unreleasedSection, /v0\.4 desktop companion awareness foundation/)

  const stableSection = changelog.split('## [0.4.0]')[1]?.split('\n## [')[0] ?? ''
  assert.match(stableSection, /Desktop companion awareness foundation/)
  assert.match(stableSection, /Session-bound quiet observation summaries/)

  const betaSection = changelog.split('## [0.4.0-beta.1]')[1]?.split('\n## [')[0] ?? ''
  assert.match(betaSection, /v0\.4 desktop companion awareness foundation/)
  assert.match(betaSection, /v0\.4 community validation path/)
  assert.match(betaSection, /v0\.4 release hardening handoff/)
  assert.doesNotMatch(unreleasedSection, /v0\.3\.6|desktop-awareness status|foundation release boundary/i)

  const releaseSection = changelog.split('## [0.3.6]')[1]?.split('\n## [')[0] ?? ''
  assert.match(releaseSection, /Settings readability and desktop-awareness status/)
  assert.match(releaseSection, /0\.3 foundation release boundary/)
  assert.match(releaseSection, /Light settings contrast/)
  assert.match(releaseSection, /Desktop context scope/)
})

test('architecture docs keep companion presence boundaries aligned', () => {
  const architecture = readWorkspaceFile('docs/ARCHITECTURE.md')
  const roadmap = readWorkspaceFile('docs/ROADMAP.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')
  const design = readWorkspaceFile(
    'docs/MILESTONE-6-DESKTOP-PRESENCE-ARCHITECTURE-ALIGNMENT-DESIGN-2026-06-20.md',
  )

  assert.match(architecture, /Companion presence and memory visibility flow/)
  assert.match(architecture, /features\/pet\/activityState/)
  assert.match(architecture, /content-minimized/)
  assert.match(architecture, /Memory visibility is a separate white-box provenance surface/)
  assert.match(architecture, /features\/releaseNotes\/` is also intentionally narrow/)
  assert.match(architecture, /There is currently no aggregate `src\/index\.ts`/)
  assert.match(architecture, /Do not document or import those paths/)

  assert.match(roadmap, /Slice 12 aligns the architecture documentation/)
  assert.match(roadmap, /memory provenance remains a separate white-box\s+surface/)
  assert.match(roadmap, /release spotlight actions stay local Settings navigation/)

  assert.match(changelog, /Companion presence architecture alignment/)
  assert.match(changelog, /memory provenance\s+stays separate from avatar state/)
  assert.match(changelog, /rather than task execution/)

  assert.match(design, /task-agent\s+dashboard/)
  assert.match(design, /No runtime behavior, user data, IPC, migrations, dependencies, or release\s+packaging change/)
})

test('v0.3.6 release handoff keeps scope and tag evidence explicit', () => {
  const handoff = readWorkspaceFile('docs/RELEASE-CANDIDATE-v0.3.6-HANDOFF.md')

  assert.match(handoff, /Evidence baseline head: `[0-9a-f]{7,40}`/)
  assert.doesNotMatch(handoff, /48e6b78/)
  assert.match(handoff, /foundation wrap-up/)
  assert.match(handoff, /npm run prerelease-check -- v0\.3\.6/)
  assert.match(handoff, /git tag v0\.3\.6/)
  assert.match(handoff, /npm run package:dir:smoke/)
  assert.match(handoff, /desktop-context-privacy:audit/)
  assert.match(handoff, /Developer ID/)
  assert.match(handoff, /SmartScreen/)
  assert.match(handoff, /Codex-style work agent/)
  assert.match(handoff, /v0\.4\.0 desktop-companion sensing loop/)
  assert.match(handoff, /about half an hour/)
})
