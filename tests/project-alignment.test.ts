import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CURRENT_RELEASE_SPOTLIGHT } from '../src/features/releaseNotes/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CURRENT_STABLE_RELEASE = '0.4.3'
const PREVIOUS_PUBLIC_RELEASE = '0.4.1'

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function workspaceFileExists(relativePath: string) {
  return existsSync(join(ROOT, relativePath))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ESCAPED_CURRENT_STABLE = escapeRegExp(CURRENT_STABLE_RELEASE)

test('stable release version and theme surfaces stay aligned', () => {
  const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { version: string }
  const version = packageJson.version
  const escapedStable = escapeRegExp(CURRENT_STABLE_RELEASE)
  const rootReadme = readWorkspaceFile('README.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')
  const releaseNotes = readWorkspaceFile(`docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md`)
  const chineseReleaseNotes = readWorkspaceFile(`docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.zh-CN.md`)
  const previousReleaseNotes = readWorkspaceFile(`docs/RELEASE-NOTES-v${PREVIOUS_PUBLIC_RELEASE}.md`)
  const handoffPath = `docs/RELEASE-CANDIDATE-v${CURRENT_STABLE_RELEASE}-HANDOFF.md`
  const handoff = readWorkspaceFile(handoffPath)

  assert.equal(version, CURRENT_STABLE_RELEASE)
  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, CURRENT_STABLE_RELEASE)
  assert.match(rootReadme, new RegExp(`当前稳定版：\\*{0,2}\\s*v${escapedStable}`))
  assert.match(rootReadme, /上一公开版本 — v0\.4\.1/)
  assert.match(rootReadme, /RELEASE-NOTES-v0\.4\.3\.md/)
  assert.match(releaseNotes, new RegExp(`# Nexus v${escapedStable}`))
  assert.match(chineseReleaseNotes, new RegExp(`# Nexus v${escapedStable}`))
  assert.match(releaseNotes, /Status: Stable unsigned release/)
  assert.match(chineseReleaseNotes, /状态：正式未签名稳定版/)
  assert.match(previousReleaseNotes, /# Nexus v0\.4\.1/)
  assert.match(changelog, /^## \[Unreleased\]/m)
  assert.match(changelog, new RegExp(`^## \\[${escapedStable}\\] - 2026-07-16`, 'm'))
  assert.doesNotMatch(changelog, /^##\s+\[0\.4\.2\]/m)
  assert.match(changelog, /^## \[0\.4\.1\] - /m)
  assert.match(handoff, new RegExp(`# Nexus v${escapedStable} Stable Release Handoff`))
  assert.match(handoff, /Status: Stable unsigned release handoff/)
  assert.match(handoff, /protected tag workflow/)
})

test('public readmes identify the current 0.4 stable entry point', () => {
  const readmes = [
    ['README.md', readWorkspaceFile('README.md')],
    ['docs/README.zh-CN.md', readWorkspaceFile('docs/README.zh-CN.md')],
    ['docs/README.zh-TW.md', readWorkspaceFile('docs/README.zh-TW.md')],
    ['docs/README.ja.md', readWorkspaceFile('docs/README.ja.md')],
    ['docs/README.ko.md', readWorkspaceFile('docs/README.ko.md')],
  ] as const

  for (const [path, readme] of readmes) {
    assert.match(readme, new RegExp(`v${escapeRegExp(CURRENT_STABLE_RELEASE)}`), `${path} should name the current stable release`)
    assert.match(readme, /v0\.4\.1/, `${path} should name the previous public release`)
    assert.match(
      readme,
      /\[[^\]]+\]\([^)]*RELEASE-NOTES-v0\.4\.3\.md(?:#[^)]*)?\)/,
      `${path} should link the current stable v0.4.3 release notes`,
    )
  }
})

test('architecture public entry point docs match existing files', () => {
  const architecture = readWorkspaceFile('docs/ARCHITECTURE.md')
  const aggregateEntryPoints = [
    'src/i18n/index.ts',
    'src/lib/index.ts',
    'src/types/index.ts',
  ]
  const absentAggregateEntryPoints = [
    'src/index.ts',
    'src/app/index.ts',
    'src/components/index.ts',
    'src/features/index.ts',
    'src/hooks/index.ts',
  ]

  for (const entryPoint of aggregateEntryPoints) {
    assert.ok(workspaceFileExists(entryPoint), `${entryPoint} should exist`)
    assert.match(architecture, new RegExp(`^${escapeRegExp(entryPoint)}$`, 'm'))
  }

  for (const entryPoint of absentAggregateEntryPoints) {
    assert.equal(workspaceFileExists(entryPoint), false, `${entryPoint} should not exist yet`)
    assert.doesNotMatch(
      architecture,
      new RegExp(`^${escapeRegExp(entryPoint)}$`, 'm'),
      `${entryPoint} should not be documented as a current aggregate barrel`,
    )
  }

  const documentedFeatureEntryPoints = Array.from(new Set(
    architecture.match(/src\/features\/[a-zA-Z][\w-]*\/index\.ts/g) ?? [],
  ))
  assert.ok(documentedFeatureEntryPoints.length >= 8)
  for (const entryPoint of documentedFeatureEntryPoints) {
    assert.ok(workspaceFileExists(entryPoint), `${entryPoint} should exist`)
  }
})

test('v0.4 desktop companion awareness hardening stays documented', () => {
  const rootReadme = readWorkspaceFile('README.md')
  const localizedReadmes = [
    'docs/README.zh-CN.md',
    'docs/README.zh-TW.md',
    'docs/README.ja.md',
    'docs/README.ko.md',
  ].map((path) => [path, readWorkspaceFile(path)] as const)
  const v04Plan = readWorkspaceFile('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md')
  const community = readWorkspaceFile('docs/COMMUNITY.md')
  const betaTemplate = readWorkspaceFile('.github/ISSUE_TEMPLATE/beta_validation.yml')
  const hardening = readWorkspaceFile('docs/RELEASE-CANDIDATE-v0.4-HARDENING.md')
  const stableChecklist = readWorkspaceFile('docs/RELEASE-CANDIDATE-v0.4.0-STABLE.md')
  const betaReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.0-beta.1.md')
  const stableReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.0.md')
  const stableReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.0.zh-CN.md')
  const coarseTimeReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.1.md')
  const coarseTimeReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.1.zh-CN.md')
  const checkInReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.2.md')
  const checkInReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.2.zh-CN.md')
  const transparencyReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.3.md')
  const transparencyReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.3.zh-CN.md')
  const m2OptimizationPlan = readWorkspaceFile('docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md')
  const feedbackReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.4.md')
  const feedbackReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.4.zh-CN.md')
  const draftHardeningReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.5.md')
  const draftHardeningReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.5.zh-CN.md')
  const draftHardeningHandoff = readWorkspaceFile('docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md')
  const releasing = readWorkspaceFile('docs/RELEASING.md')
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const storageContract = readWorkspaceFile('scripts/storage-contract.mjs')
  const v04DraftStackAudit = readWorkspaceFile('scripts/v04-draft-stack-audit.mjs')
  const memorySectionV3 = readWorkspaceFile('src/features/settingsV3/MemorySectionV3.tsx')
  const settingsActiveSection = readWorkspaceFile('src/components/SettingsDrawerActiveSection.tsx')
  const settingsSectionModules = readWorkspaceFile('src/components/settingsSectionModules.ts')
  const panelView = readWorkspaceFile('src/app/views/PanelView.tsx')
  const desktopContextHook = readWorkspaceFile('src/hooks/useDesktopContext.ts')
  const companionAwarenessRuntime = readWorkspaceFile('src/features/context/companionAwarenessRuntime.ts')
  const companionTransparency = readWorkspaceFile('src/features/context/companionTransparency.ts')
  const changelog = readWorkspaceFile('CHANGELOG.md')

  assert.match(v04Plan, /Current Release Priority/)
  assert.match(v04Plan, /`v0\.4\.0` is the stable Quiet Observation Foundation release/)
  assert.match(v04Plan, new RegExp('current public stable release v' + ESCAPED_CURRENT_STABLE))
  assert.doesNotMatch(v04Plan, /stable Check-In Policy follow-up.{0,30}v0\.4\.2/)
  assert.match(v04Plan, /v0\.4\.3` is the\s+current public stable release|current public stable release v0\.4\.3/)
  assert.match(v04Plan, /`v0\.4\.5` Release Hardening Draft is a non-shipping review layer only/)
  assert.match(v04Plan, /Do not publish `v0\.4\.5`/)
  assert.match(v04Plan, /README stable-entry switch/)
  assert.match(v04Plan, /Separate decision from emission/)
  assert.match(v04Plan, /Repeated polling cannot emit the same check-in line again/)
  assert.match(v04Plan, /v0\.4\.3 — Companion Surface Cohesion & Transparency/)
  assert.match(v04Plan, /rawContentVisible: false/)
  assert.match(v04Plan, /blocked reasons/)
  assert.match(v04Plan, /Gentle check-in rationale is explicit/)
  assert.match(v04Plan, /v0\.4\.4 — Beta Feedback And Copy Tuning/)
  assert.match(v04Plan, /Feedback normalization keeps only semantic labels/)
  assert.match(v04Plan, /no feedback analytics engine/)
  assert.match(v04Plan, /v0\.4\.5 — Release Hardening Draft/)
  assert.match(v04Plan, /RELEASE-CANDIDATE-v0\.4\.5-DRAFT-HARDENING\.md/)
  assert.match(v04Plan, /npm run v04:draft-stack:audit/)
  assert.match(v04Plan, /CI only enforces quick audit; full audit is non-blocking release evidence\./)
  assert.match(rootReadme, new RegExp(`RELEASE-NOTES-v${ESCAPED_CURRENT_STABLE}\\.md`))
  assert.doesNotMatch(rootReadme, /RELEASE-NOTES-v0\.4\.5\.md/)
  assert.match(rootReadme, new RegExp(`当前稳定版：\\*{0,2}\\s*v${ESCAPED_CURRENT_STABLE}`))
  assert.match(rootReadme, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  for (const [path, readme] of localizedReadmes) {
    assert.match(readme, /V0\.4_DESKTOP_COMPANION_AWARENESS\.md/, `${path} should link the v0.4 plan`)
    assert.match(readme, new RegExp(`RELEASE-NOTES-v${ESCAPED_CURRENT_STABLE}\\.md`), `${path} should link the current stable notes`)
    assert.match(readme, /RELEASE-NOTES-v0\.4\.1\.md/, `${path} should link the previous public notes`)
    assert.match(readme, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/, `${path} should link the v0.4 hardening handoff`)
  }
  assert.match(community, /v0\.4 desktop companion awareness/)
  assert.match(community, /structured v0\.4 fields/)
  assert.match(community, /safe labels such as timing feel, tone feel/)
  assert.match(betaTemplate, /v0\.4 desktop companion awareness feedback/)
  assert.match(betaTemplate, /v0\.4 interaction context/)
  assert.match(betaTemplate, /v0\.4 check-in timing feel/)
  assert.match(betaTemplate, /v0\.4 check-in tone feel/)
  assert.match(betaTemplate, /v0\.4 privacy boundary signals/)
  assert.match(betaTemplate, /v0\.4 OS permission friction/)
  assert.match(betaTemplate, /Was Nexus open but unused/)
  assert.match(betaTemplate, /too much like monitoring/)

  assert.match(hardening, /npm run verify:release/)
  assert.match(hardening, /npm run package:dir:smoke/)
  assert.match(hardening, /npm run desktop-context-privacy:audit/)
  assert.match(hardening, /npm run message-privacy:audit/)
  assert.match(hardening, /npm run error-redaction:audit/)
  assert.match(hardening, /npm run ipc:audit/)
  assert.match(hardening, /npm run distribution:audit/)
  assert.match(hardening, /RELEASE-CANDIDATE-v0\.4\.5-DRAFT-HARDENING\.md/)
  assert.match(hardening, /RELEASE-CANDIDATE-v0\.4\.0-STABLE\.md/)
  assert.match(hardening, /Evidence baseline head: `[0-9a-f]{7,40}`/)
  assert.match(hardening, /## Evidence Collected/)
  assert.match(hardening, /2037 tests/)
  assert.match(hardening, /npm run package:dir:smoke` — passed locally/)
  assert.match(hardening, /npm run prerelease-check -- v0\.4\.0-beta\.1 --skip=A --quick/)
  assert.match(hardening, /16 blocker checks, 0 warnings, and 0 failures/)
  assert.match(hardening, /npm run prerelease-check -- v0\.4\.0-beta\.1 --skip=A/)
  assert.match(hardening, /20\s+blocker checks, 0 warnings, and 0 failures/)
  assert.match(hardening, /coverage at 90\.37%/)
  assert.match(hardening, /Stage A remains final-branch\s+only/)
  assert.match(hardening, /npm run prerelease-check -- v0\.4\.0-beta\.1 --only=A/)
  assert.doesNotMatch(hardening, /bump `package\.json` \/ `package-lock\.json` to `0\.4\.0-beta\.1`/)
  assert.match(hardening, /commit or otherwise clean the working tree/)
  assert.match(hardening, /HEAD === origin\/main/)
  assert.match(hardening, /ad-hoc signing and skips notarization/)
  assert.match(hardening, /Model-facing desktop companion context uses sanitized summaries only/)
  assert.match(hardening, /Pausing desktop companion awareness removes the prompt summary path/)
  assert.match(hardening, /clears the recent local\s+companion summary/)
  assert.match(hardening, /Active chat with Nexus takes priority over proactive companionship/)
  assert.match(hardening, /Do not ship v0\.5 desktop pet behavior as a workaround/)

  assert.match(stableChecklist, /Quiet Observation Foundation only/)
  assert.match(stableChecklist, /Release state: `final_candidate`/)
  assert.match(stableChecklist, /package version now\s+target `v0\.4\.0`/)
  assert.match(stableChecklist, /RELEASE-NOTES-v0\.4\.0\.md/)
  assert.match(stableChecklist, /final verification result/)
  assert.match(stableChecklist, /v0\.4\.0 stable must not include/)
  assert.match(stableChecklist, /exact timers or timestamp trails/)
  assert.match(stableChecklist, /npm run prerelease-check -- v0\.4\.0/)
  assert.match(stableChecklist, /disable the quiet observation summary path first/)

  assert.match(stableReleaseNotes, /Stable/)
  assert.doesNotMatch(stableReleaseNotes, /\bDraft\b|pre-tag/)
  assert.match(stableReleaseNotes, /Desktop companion awareness foundation/)
  assert.match(stableReleaseNotes, /session-bound/)
  assert.match(stableReleaseNotes, /hard 24-hour safety cap/)
  assert.match(stableReleaseNotes, /This stable release does not include/)
  assert.match(stableReleaseNotes, /Gatekeeper or quarantine/)
  assert.match(stableReleaseNotes, /SmartScreen warnings/)
  assert.doesNotMatch(stableReleaseNotes, /0\.4\.1/)
  assert.match(stableReleaseNotesZh, /稳定版/)
  assert.doesNotMatch(stableReleaseNotesZh, /草稿|尚未打 tag|pre-tag/)
  assert.match(stableReleaseNotesZh, /24 小时硬性安全\s+上限/)
  assert.match(stableReleaseNotesZh, /Gatekeeper 或 quarantine/)
  assert.match(stableReleaseNotesZh, /SmartScreen 警告/)
  assert.doesNotMatch(stableReleaseNotesZh, /0\.4\.1/)
  assert.doesNotMatch(coarseTimeReleaseNotes, /\bDraft\b|pre-tag/)
  assert.match(coarseTimeReleaseNotes, /Companion UI, Settings, and Reliability Hardening/)
  assert.match(coarseTimeReleaseNotes, /Settings drawer performance guard/)
  assert.match(coarseTimeReleaseNotes, /Still Out of Scope/)
  assert.doesNotMatch(coarseTimeReleaseNotesZh, /尚未打 tag|pre-tag/)
  assert.match(coarseTimeReleaseNotesZh, /陪伴 UI、设置和可靠性加固/)
  assert.match(coarseTimeReleaseNotesZh, /设置抽屉性能守卫/)
  assert.doesNotMatch(checkInReleaseNotes, /\bDraft\b|pre-tag/)
  assert.match(checkInReleaseNotes, /Check-In Policy/)
  assert.match(checkInReleaseNotes, /Release candidate/)
  assert.match(checkInReleaseNotes, /external notifications/)
  assert.match(checkInReleaseNotes, /message sending/)
  assert.match(checkInReleaseNotes, /Decide is separate from emit/)
  assert.doesNotMatch(checkInReleaseNotesZh, /尚未打 tag|pre-tag/)
  assert.match(checkInReleaseNotesZh, /Check-In 策略/)
  assert.match(checkInReleaseNotesZh, /发布候选/)
  assert.match(checkInReleaseNotesZh, /外部通知/)
  assert.match(checkInReleaseNotesZh, /决策和发出分开/)
  assert.match(transparencyReleaseNotes, /Status: Stable unsigned release/)
  assert.match(transparencyReleaseNotes, /Companion Surface Cohesion & Transparency/)
  assert.match(transparencyReleaseNotes, /current stable version/)
  assert.match(transparencyReleaseNotes, /rawContentVisible: false/)
  assert.match(transparencyReleaseNotes, /check-in rationale/)
  assert.match(transparencyReleaseNotes, /recent coarse companion summary/)
  assert.match(transparencyReleaseNotes, /privacy boundary/)
  assert.match(transparencyReleaseNotes, /minimal session\/lifecycle\/expiry metadata/)
  assert.match(transparencyReleaseNotes, /boolean decision detail/)
  assert.match(transparencyReleaseNotes, /chat desktop-context path/)
  assert.match(transparencyReleaseNotes, /protected tag workflow/)
  assert.match(transparencyReleaseNotes, /raw timeline/)
  assert.match(transparencyReleaseNotesZh, /正式未签名稳定版/)
  assert.match(transparencyReleaseNotesZh, /陪伴界面一致性与透明度/)
  assert.match(transparencyReleaseNotesZh, /当前稳定版本/)
  assert.match(transparencyReleaseNotesZh, /近期粗略陪伴摘要/)
  assert.match(transparencyReleaseNotesZh, /隐私边界/)
  assert.match(transparencyReleaseNotesZh, /主动陪伴原因/)
  assert.match(transparencyReleaseNotesZh, /会话、生命周期和\s+过期标记/)
  assert.match(transparencyReleaseNotesZh, /聊天桌面上下文链路/)
  assert.match(transparencyReleaseNotesZh, /受保护的 tag 工作流/)
  assert.match(transparencyReleaseNotesZh, /原始时间线/)
  assert.match(m2OptimizationPlan, /three short-lived categories/)
  assert.match(m2OptimizationPlan, /latest local\s+check-in decision/)
  assert.match(v04Plan, /chat desktop-context path/)
  assert.match(v04Plan, /visible recent summary row/)
  assert.match(v04Plan, /visible privacy boundary row/)
  assert.match(v04Plan, /cross-session check-in history/)
  assert.match(storageContract, /COMPANION_CHECK_IN_DECISION_STORAGE_KEY/)
  assert.match(desktopContextHook, /resolveCompanionAwarenessRuntime/)
  assert.match(desktopContextHook, /saveRecentCompanionCheckInDecision/)
  assert.match(companionAwarenessRuntime, /decideCompanionCheckIn/)
  assert.match(companionTransparency, /recentSummary/)
  assert.match(companionTransparency, /privacyBoundary/)
  assert.match(settingsSectionModules, /loadMemorySection = \(\) => import\('\.\.\/features\/settingsV3\/MemorySectionV3\.tsx'\)/)
  assert.match(settingsActiveSection, /<MemorySectionV3/)
  assert.match(panelView, /const useCompanionV2 = new URLSearchParams\(window\.location\.search\)\.get\('uiV2'\) !== '0'\s*&&\s*\(settings\.vtsEnabled \|\| Boolean\(petModel\.spriteAtlas\) \|\| Boolean\(petModel\.modelPath\)\)/)
  assert.match(panelView, /useCompanionV2\) \{\s*return \(\s*<CompanionPanelV2/)
  assert.match(memorySectionV3, /clearRecentCompanionCheckInDecision\(\)/)
  assert.match(memorySectionV3, /loadRecentCompanionCheckInDecision\(\)/)
  assert.match(memorySectionV3, /companionTransparencyView\.recentSummary\.labelKey/)
  assert.match(memorySectionV3, /companionTransparencyView\.recentSummary\.statusKey/)
  assert.match(memorySectionV3, /companionTransparencyView\.privacyBoundary\.labelKey/)
  assert.match(memorySectionV3, /companionTransparencyView\.checkInStatus\.labelKey/)
  assert.match(memorySectionV3, /companionTransparencyView\.checkInStatus\.statusKey/)
  assert.match(memorySectionV3, /companionTransparencyView\.checkInStatus\.bodyKey/)
  assert.match(feedbackReleaseNotes, /Draft/)
  assert.match(feedbackReleaseNotes, /Beta Feedback And Copy Tuning/)
  assert.match(feedbackReleaseNotes, /Do not publish until/)
  assert.match(feedbackReleaseNotes, /issue template rather than[\s\S]*in-app normalization or storage helper/)
  assert.match(feedbackReleaseNotes, /No README stable-entry switch/)
  assert.match(feedbackReleaseNotes, /No feedback analytics engine/)
  assert.match(feedbackReleaseNotesZh, /草稿/)
  assert.match(feedbackReleaseNotesZh, /Beta 反馈与文案调优/)
  assert.match(feedbackReleaseNotesZh, /不要发布/)
  assert.match(feedbackReleaseNotesZh, /issue template[\s\S]*不再随应用发布反馈归一化或存储 helper/)
  assert.match(feedbackReleaseNotesZh, /不切换 README 稳定版入口/)
  assert.match(feedbackReleaseNotesZh, /不做反馈分析引擎/)
  assert.match(draftHardeningReleaseNotes, /Draft/)
  assert.match(draftHardeningReleaseNotes, /Release Hardening Draft/)
  assert.match(draftHardeningReleaseNotes, /Do not publish until/)
  assert.match(draftHardeningReleaseNotes, /No package version bump/)
  assert.match(draftHardeningReleaseNotes, /No tag or GitHub Release/)
  assert.match(draftHardeningReleaseNotes, /No README stable-entry switch/)
  assert.match(draftHardeningReleaseNotes, /public stable entry point on v0\.4\.3/)
  assert.doesNotMatch(draftHardeningReleaseNotes, /stable entry point on v0\.4\.2/i)
  assert.match(draftHardeningReleaseNotes, /Recorded local draft-hardening evidence/)
  assert.match(draftHardeningReleaseNotes, /v0\.5 is the next desktop pet behavior line/)
  assert.doesNotMatch(draftHardeningReleaseNotes, /\bStable\b/)
  assert.match(draftHardeningReleaseNotesZh, /草稿/)
  assert.match(draftHardeningReleaseNotesZh, /发布硬化草稿/)
  assert.match(draftHardeningReleaseNotesZh, /不要发布/)
  assert.match(draftHardeningReleaseNotesZh, /不改 package 版本号/)
  assert.match(draftHardeningReleaseNotesZh, /不打 tag，不创建 GitHub Release/)
  assert.match(draftHardeningReleaseNotesZh, /不切换 README 稳定版入口/)
  assert.match(draftHardeningReleaseNotesZh, /公开稳定入口继续停留在 v0\.4\.3/)
  assert.doesNotMatch(draftHardeningReleaseNotesZh, /稳定入口.{0,20}v0\.4\.2/)
  assert.match(draftHardeningReleaseNotesZh, /本地硬化证据/)
  assert.doesNotMatch(draftHardeningReleaseNotesZh, /v0\.4\.5\s*(?:是|为|已成为)\s*稳定版|稳定版(?:是|：|:)\s*v0\.4\.5/)
  assert.match(draftHardeningHandoff, /Status: Draft hardening handoff; not a release\./)
  assert.match(draftHardeningHandoff, /No package version bump/)
  assert.match(draftHardeningHandoff, /No tag/)
  assert.match(draftHardeningHandoff, /No GitHub Release/)
  assert.match(draftHardeningHandoff, /No README stable-entry switch/)
  assert.match(draftHardeningHandoff, new RegExp(`v0\\.4\\.5 -> v${ESCAPED_CURRENT_STABLE}-v0\\.4\\.4`))
  assert.match(draftHardeningHandoff, /npm run v04:draft-stack:audit/)
  assert.match(draftHardeningHandoff, /CI only enforces quick audit; full audit is non-blocking release evidence\./)
  assert.match(draftHardeningHandoff, /## Evidence Collected/)
  assert.match(draftHardeningHandoff, /npm run verify:release` — passed locally/)
  assert.match(draftHardeningHandoff, /2511 tests/)
  assert.match(draftHardeningHandoff, /SQLite smoke passed/)
  assert.match(draftHardeningHandoff, /core-path smoke passed/)
  assert.match(draftHardeningHandoff, /npm run package:dir:smoke` — passed locally/)
  assert.match(draftHardeningHandoff, /packaged app loaded\s+successfully/)
  assert.match(draftHardeningHandoff, /Temporary smoke artifacts such as `release-smoke` and\s+`output\/core-path-smoke` were removed after verification/)
  assert.match(draftHardeningHandoff, /v0\.5 remains the desktop pet behavior line/)
  assert.match(v04DraftStackAudit, /version !== CURRENT_STABLE_RELEASE/)
  assert.match(v04DraftStackAudit, /PREVIOUS_PUBLIC_RELEASE/)
  assert.match(v04DraftStackAudit, /currentStableRelease:/)
  assert.match(v04DraftStackAudit, /previousPublicRelease:/)
  assert.match(v04DraftStackAudit, /README stable entry must not link v/)
  assert.match(v04DraftStackAudit, /createsReleaseArtifacts: false/)

  assert.match(releasing, /v0\.4 desktop companion awareness gate/)
  assert.match(releasing, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  assert.match(releasing, /RELEASE-CANDIDATE-v0\.4\.0-STABLE\.md/)
  assert.match(releasing, /npm run desktop-context-privacy:audit/)
  assert.match(releasing, /docs\/RELEASE-NOTES-v0\.4\.0-beta\.1\.md/)
  assert.match(releasing, /docs\/RELEASE-NOTES-v0\.4\.0\.md/)
  assert.match(releasing, /pre-tag drafts/)
  assert.match(releasing, /Do not switch README entry points/)
  assert.match(releasing, /timing, tone,\s+interruption feel, privacy boundaries/)
  assert.match(releasing, /exact second-level\s+timers, or hidden activity logs/)
  assert.match(prereleaseCheck, /const releaseNotes = `RELEASE-NOTES-\$\{tag\}\.md`/)
  assert.match(prereleaseCheck, /no longer marked draft/)
  assert.match(prereleaseCheck, /release notes still contain draft\/pre-tag markers/)
  assert.match(prereleaseCheck, /RELEASE-NOTES-\$\{tag\}\.zh-CN\.md exists and is not draft/)
  assert.match(prereleaseCheck, /localized release notes still contain draft\/pre-tag markers/)
  assert.match(prereleaseCheck, /warnOnly: true/)
  assert.match(prereleaseCheck, /README\.md does not link \$\{releaseNotes\}/)
  assert.match(prereleaseCheck, /does not link \$\{releaseNotes\} — update news block/)
  assert.match(memorySectionV3, /clearRecentCompanionSummary\(\)\s+refreshRecent\(\)/)

  assert.match(betaReleaseNotes, /Nexus v0\.4\.0-beta\.1/)
  assert.match(betaReleaseNotes, /Desktop companion awareness begins/)
  assert.match(betaReleaseNotes, /Nexus is open but not being used\s+directly/)
  assert.match(betaReleaseNotes, /Exact minute and second durations stay\s+out of companion copy/)
  assert.match(betaReleaseNotes, /clears the\s+recent local companion summary/)
  assert.match(betaReleaseNotes, /No v0\.5 desktop pet mouse-following or typing reactions yet/)

  const unreleasedSection = changelog.split('## [0.4.3]')[0] ?? ''
  assert.match(unreleasedSection, /v0\.4\.5 draft hardening evidence/)
  assert.match(unreleasedSection, /full v0\.4 draft-stack audit/)
  assert.doesNotMatch(unreleasedSection, /No unreleased changes yet\./)
  assert.doesNotMatch(unreleasedSection, /v0\.4\.3 code candidate|local v0\.4\.3 code candidate/)

  const stableV043Section = changelog.split('## [0.4.3] - 2026-07-16')[1]?.split('\n## [0.4.1]')[0] ?? ''
  assert.match(stableV043Section, /v0\.4\.3 carries forward the v0\.4\.2 check-in-policy/)
  assert.match(stableV043Section, /Check-In policy hardening/)
  assert.match(stableV043Section, /Settings visual-system follow-up/)
  assert.match(stableV043Section, /Release documentation sync/)
  assert.match(stableV043Section, /Release evidence/)
  assert.doesNotMatch(stableV043Section, /code candidate|not publicly released/)
  assert.doesNotMatch(changelog, /^##\s+\[0\.4\.2\]/m)
  assert.match(changelog, /^## \[0\.4\.3\] - 2026-07-16/m)
  assert.match(changelog, /^## \[0\.4\.1\] - /m)

  const betaSection = changelog.split('## [0.4.0-beta.1]')[1]?.split('\n## [')[0] ?? ''
  assert.match(betaSection, /v0\.4 desktop companion awareness foundation/)
  assert.match(betaSection, /v0\.4 community validation path/)
  assert.match(betaSection, /v0\.4 release hardening handoff/)
})
