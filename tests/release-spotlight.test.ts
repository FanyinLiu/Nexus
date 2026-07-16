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

test('current release spotlight keeps the v0.4.3 stable structure explicit', () => {
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, '0.4.3')
  const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { version: string }
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, packageJson.version)
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.bullets.map((item) => item.id),
    ['companion_presence', 'transparent_surface', 'text_chat_support', 'voice_settings', 'companion_boundary'],
  )
  assert.deepEqual(
    CURRENT_RELEASE_SPOTLIGHT.actions.map((item) => [item.id, item.targetSectionId]),
    [
      ['open_voice', 'voice'],
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

test('current release spotlight describes the quieter voice-first surface', async () => {
  const en = await ensureLocaleLoaded('en-US')
  const zhCN = await ensureLocaleLoaded('zh-CN')

  assert.equal(en['about.release_spotlight.title'], 'Companion-first, with a quieter surface.')
  assert.match(en['about.release_spotlight.summary'], /stable companion-first release/i)
  assert.match(en['about.release_spotlight.summary'], /unsigned macOS builds.*manually.*release page/i)
  assert.match(en['about.release_spotlight.bullet.companion_presence.body'], /temporary states and captions/i)
  assert.doesNotMatch(en['about.release_spotlight.bullet.companion_presence.body'], /Mao.*Haru.*Hiyori/)
  assert.match(en['about.release_spotlight.bullet.companion_boundary.body'], /Mao.*Haru.*Hiyori/)
  assert.match(en['about.release_spotlight.bullet.companion_boundary.body'], /included Live2D choices.*Preview and switch/i)
  assert.doesNotMatch(en['about.release_spotlight.bullet.companion_boundary.body'], /candidate|release gate/i)
  assert.doesNotMatch(en['about.release_spotlight.bullet.transparent_surface.body'], /smoke|first-frame/i)
  assert.match(en['about.release_spotlight.bullet.transparent_surface.body'], /character.*temporary captions.*controls/i)
  assert.match(en['about.release_spotlight.bullet.text_chat_support.body'], /available when needed/)
  assert.match(en['about.release_spotlight.bullet.voice_settings.body'], /main window has no voice button/)
  assert.match(en['about.release_spotlight.bullet.voice_settings.body'], /frameless companions and desktop pets/)
  assert.equal(en['about.release_spotlight.action.open_voice'], 'Open Voice Settings')
  assert.equal(en['about.release_spotlight.action.preview_companion'], 'Preview Companion')

  assert.equal(zhCN['about.release_spotlight.title'], '陪伴优先，界面更克制')
  assert.match(zhCN['about.release_spotlight.summary'], /正式稳定版/)
  assert.match(zhCN['about.release_spotlight.summary'], /macOS 版本未签名.*发布页.*手动/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_presence.body'], /临时状态.*字幕/)
  assert.doesNotMatch(zhCN['about.release_spotlight.bullet.companion_presence.body'], /Mao.*Haru.*Hiyori/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_boundary.body'], /Mao.*Haru.*Hiyori/)
  assert.match(zhCN['about.release_spotlight.bullet.companion_boundary.body'], /可选.*预览.*切换/)
  assert.doesNotMatch(zhCN['about.release_spotlight.bullet.companion_boundary.body'], /候选|发布门禁/)
  assert.doesNotMatch(zhCN['about.release_spotlight.bullet.transparent_surface.body'], /smoke|首帧/)
  assert.match(zhCN['about.release_spotlight.bullet.transparent_surface.body'], /角色.*临时字幕.*必要控制/)
  assert.match(zhCN['about.release_spotlight.bullet.text_chat_support.body'], /辅助界面/)
  assert.match(zhCN['about.release_spotlight.bullet.voice_settings.body'], /主界面没有常驻语音按钮/)
  assert.match(zhCN['about.release_spotlight.bullet.voice_settings.body'], /无框伙伴与桌宠/)
  assert.equal(zhCN['about.release_spotlight.action.open_voice'], '打开语音设置')
  assert.equal(zhCN['about.release_spotlight.action.preview_companion'], '预览伙伴')
})

test('release spotlight presents v0.4.3 as stable while keeping unsigned macOS updates explicit', async () => {
  const contracts = [
    ['en-US', /stable companion-first release/i, /unsigned macOS.*manually.*release page/i, /code candidate|unpublished|not published|no (?:tag|GitHub Release)/i],
    ['zh-CN', /正式稳定版/, /macOS 版本未签名.*发布页.*手动/, /代码候选|尚未公开|未发布|不打 tag|没有 tag/],
    ['zh-TW', /正式穩定版/, /macOS 版本未簽署.*發布頁.*手動/, /程式碼候選|尚未公開|未發布|不打 tag|沒有 tag/],
    ['ja', /安定版/, /署名なし.*macOS.*リリースページ.*手動/, /コード候補|未公開|未リリース|タグなし/],
    ['ko', /안정 버전/, /서명되지 않은 macOS.*릴리스 페이지.*수동/, /코드 후보|미공개|출시되지|태그 없음/],
  ] as const

  for (const [locale, stablePattern, unsignedUpdatePattern, forbiddenPattern] of contracts) {
    const dictionary = await ensureLocaleLoaded(locale)
    const copy = [
      dictionary['about.release_spotlight.summary'],
      ...CURRENT_RELEASE_SPOTLIGHT.bullets.flatMap((item) => [
        dictionary[item.titleKey],
        dictionary[item.bodyKey],
      ]),
    ].join(' ')
    assert.match(copy, stablePattern, `${locale} must present v0.4.3 as stable`)
    assert.match(copy, unsignedUpdatePattern, `${locale} must keep the unsigned macOS manual-update boundary`)
    assert.doesNotMatch(copy, forbiddenPattern, `${locale} must not retain prerelease publication copy`)
  }
})

test('five locales keep natural presence and boundary vocabulary', async () => {
  const contracts = [
    ['en-US', /listening.*thinking.*replying/i, /Mao.*Haru.*Hiyori/i],
    ['zh-CN', /倾听.*思考.*回应/, /Mao.*Haru.*Hiyori/],
    ['zh-TW', /傾聽.*思考.*回應/, /Mao.*Haru.*Hiyori/],
    ['ja', /聴く.*考える.*応答/, /Mao.*Haru.*Hiyori/],
    ['ko', /듣기.*생각하기.*응답하기/, /Mao.*Haru.*Hiyori/],
  ] as const

  for (const [locale, presencePattern, boundaryPattern] of contracts) {
    const dictionary = await ensureLocaleLoaded(locale)
    const presence = dictionary['about.release_spotlight.bullet.companion_presence.body']
    const boundary = dictionary['about.release_spotlight.bullet.companion_boundary.body']
    const transparent = dictionary['about.release_spotlight.bullet.transparent_surface.body']
    assert.match(presence, presencePattern, `${locale} must describe temporary listening/thinking/replying states`)
    assert.match(boundary, boundaryPattern, `${locale} must name the three Live2D choices`)
    assert.doesNotMatch(boundary, /candidate|release gate|候选|候選|发布门禁|發布門檻|候補|リリースゲート|후보|릴리스 게이트/i)
    assert.doesNotMatch(transparent, /smoke|first-frame|首帧|首幀|初回フレーム|첫 프레임/i)
    if (locale !== 'en-US') {
      const copy = [
        dictionary['about.release_spotlight.summary'],
        ...CURRENT_RELEASE_SPOTLIGHT.bullets.flatMap((item) => [dictionary[item.titleKey], dictionary[item.bodyKey]]),
      ].join(' ')
      assert.doesNotMatch(copy, /Panel|smoke|Frameless|Pet/)
    }
  }
})

test('English Spotlight copy stays concise and product-facing', async () => {
  const dictionary = await ensureLocaleLoaded('en-US')
  const summaryWords = dictionary['about.release_spotlight.summary'].trim().split(/\s+/)
  assert.ok(summaryWords.length <= 30)
  for (const item of CURRENT_RELEASE_SPOTLIGHT.bullets) {
    const words = dictionary[item.bodyKey].trim().split(/\s+/)
    assert.ok(words.length <= 24, `${item.id} must stay within the concise English body budget`)
  }
  const englishCopy = [
    dictionary['about.release_spotlight.summary'],
    ...CURRENT_RELEASE_SPOTLIGHT.bullets.flatMap((item) => [dictionary[item.titleKey], dictionary[item.bodyKey]]),
  ].join(' ')
  assert.doesNotMatch(englishCopy, /support surface|resident voice button|local-smoke|code candidate|unpublished|no tag/i)
  assert.doesNotMatch(dictionary['about.release_spotlight.bullet.transparent_surface.body'], /smoke|first-frame/i)
})

test('release spotlight actions use the voice section and existing icon vocabulary', () => {
  const aboutPanel = readWorkspaceFile('src/components/settingsSections/AboutPanel.tsx')
  const consoleSection = readWorkspaceFile('src/components/settingsSections/ConsoleSection.tsx')
  const actions = readWorkspaceFile('src/components/settingsSections/ReleaseSpotlightActions.tsx')

  assert.match(aboutPanel, /onOpenSettingsSection\?: \(sectionId: SettingsSectionId\) => void/)
  assert.match(consoleSection, /type SettingsSectionId/)
  assert.match(consoleSection, /onOpenSettingsSection\?: \(sectionId: SettingsSectionId\) => void/)
  assert.doesNotMatch(aboutPanel, /bivarianceHack|AboutSettingsSectionHandler|onOpenSettingsSection=\{onOpenSettingsSection as/)
  assert.match(actions, /item\.id === 'open_voice' \? 'mic' : 'sparkles'/)
  assert.doesNotMatch(actions, /emoji|<path|<svg/i)
})

test('V3 Console exposes the real About panel and keeps only Weekly Recap beside it', () => {
  const consoleSection = readWorkspaceFile('src/features/settingsV3/ConsoleSectionV3.tsx')
  const disclosureStart = consoleSection.indexOf("<SettingsV3Disclosure title={ti('settings.console.about_recap')}")
  const disclosureEnd = consoleSection.indexOf('</SettingsV3Disclosure>', disclosureStart)
  assert.ok(disclosureStart >= 0)
  assert.ok(disclosureEnd > disclosureStart)
  const aboutDisclosure = consoleSection.slice(disclosureStart, disclosureEnd)

  assert.match(consoleSection, /type SettingsSectionId/)
  assert.match(consoleSection, /onOpenSettingsSection\?: \(sectionId: SettingsSectionId\) => void/)
  assert.match(aboutDisclosure, /<AboutPanel uiLanguage=\{uiLanguage\} onOpenSettingsSection=\{onOpenSettingsSection\}/)
  assert.match(aboutDisclosure, /weekly_recap\.title/)
  assert.doesNotMatch(aboutDisclosure, /about\.links\.github|about\.links\.report_issue|settings\.section\.chat/)
})

test('v0.4.3 release notes preserve stable unsigned boundaries and spotlight facts', () => {
  const notes = [
    {
      text: readWorkspaceFile('docs/RELEASE-NOTES-v0.4.3.md'),
      required: {
        stable: /Status: Stable unsigned release/i,
        protectedPublication: /created only from the release commit by the protected tag workflow/i,
        unsignedMac: /macOS arm64 app is ad-hoc signed, not Apple Developer ID signed or\s+notarized/i,
        manualUpdate: /opens the official release page; users manually[\s\S]*download and replace the app/i,
        panelVoice: /resident voice button/i,
        settingsVoice: /Settings → Voice[\s\S]*save, start, stop, and cancel/i,
        directVoice: /Frameless and Pet keep[\s\S]*direct voice entry/i,
        models: /Mao, Haru, and Hiyori/i,
      },
      forbidden: /Status: Release candidate|not a public release|no tag or GitHub Release/i,
    },
    {
      text: readWorkspaceFile('docs/RELEASE-NOTES-v0.4.3.zh-CN.md'),
      required: {
        stable: /状态：正式未签名稳定版/,
        protectedPublication: /只会从发布提交经受保护的 tag 工作流生成/,
        unsignedMac: /macOS arm64 应用采用 ad-hoc 签名，不是 Apple Developer ID 签名或公证/,
        manualUpdate: /打开官方 release 页面；用户需要手动下载并替换应用/,
        panelVoice: /主 Panel 不再常驻语音按钮/,
        settingsVoice: /设置 → 语音[\s\S]*保存、开始、停止和取消/,
        directVoice: /Frameless 与 Pet[\s\S]*直接语音入口/,
        models: /Mao、Haru 和 Hiyori/,
      },
      forbidden: /状态：发布候选|尚未公开发布|不打 tag，不创建 GitHub Release/,
    },
  ] as const

  for (const { text, required, forbidden } of notes) {
    for (const [label, pattern] of Object.entries(required)) {
      assert.match(text, pattern, `${label} must remain in the stable notes`)
    }
    assert.doesNotMatch(text, forbidden, 'stable notes must not retain candidate publication copy')
  }
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

  assert.match(rootReadme, /当前稳定版：\*{0,2}\s*v0\.4\.3/)
  assert.match(rootReadme, /上一公开版本 — v0\.4\.1/)
  assert.doesNotMatch(rootReadme, /## 上次更新 — v0\.3\.6/)

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
