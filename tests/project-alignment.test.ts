import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CURRENT_RELEASE_SPOTLIGHT } from '../src/features/releaseNotes/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function workspaceFileExists(relativePath: string) {
  return existsSync(join(ROOT, relativePath))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('release candidate version and theme surfaces stay aligned', () => {
  const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { version: string }
  const version = packageJson.version
  const escapedVersion = escapeRegExp(version)
  const rootReadme = readWorkspaceFile('README.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')
  const releaseNotes = readWorkspaceFile(`docs/RELEASE-NOTES-v${version}.md`)
  const chineseReleaseNotes = readWorkspaceFile(`docs/RELEASE-NOTES-v${version}.zh-CN.md`)
  const handoffPath = version === '0.4.0'
    ? 'docs/RELEASE-CANDIDATE-v0.4.0-STABLE.md'
    : `docs/RELEASE-CANDIDATE-v${version}-HANDOFF.md`
  const handoff = readWorkspaceFile(handoffPath)

  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, version)
  assert.match(rootReadme, new RegExp(`RELEASE-NOTES-v${escapedVersion}\\.md`))
  assert.match(releaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(chineseReleaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(changelog, new RegExp(`## \\[${escapedVersion}\\]`))
  assert.match(handoff, new RegExp(`# Nexus v${escapedVersion} (Release Candidate Handoff|Stable Release Checklist)`))
  assert.match(handoff, /(Evidence baseline head: `[0-9a-f]{7,40}`|Release state: `final_candidate`)/)
  assert.doesNotMatch(handoff, /48e6b78/)
  assert.match(handoff, /(desktop companion awareness begins|Quiet Observation Foundation only)/)
  assert.match(handoff, /(Codex-style work agent|mouse-following, typing-following, or pet window control)/)
})

test('public readmes identify the current 0.4 stable entry point', () => {
  const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { version: string }
  const version = packageJson.version
  const escapedVersion = escapeRegExp(version)
  const readmes = [
    ['README.md', readWorkspaceFile('README.md')],
    ['docs/README.zh-CN.md', readWorkspaceFile('docs/README.zh-CN.md')],
    ['docs/README.zh-TW.md', readWorkspaceFile('docs/README.zh-TW.md')],
    ['docs/README.ja.md', readWorkspaceFile('docs/README.ja.md')],
    ['docs/README.ko.md', readWorkspaceFile('docs/README.ko.md')],
  ] as const

  for (const [path, readme] of readmes) {
    assert.match(readme, new RegExp(`v${escapedVersion}`), `${path} should name the package version`)
    assert.match(
      readme,
      /RELEASE-NOTES-v0\.4\.0\.md/,
      `${path} should link the current v0.4 stable release notes`,
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
  const feedbackReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.4.md')
  const feedbackReleaseNotesZh = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.4.zh-CN.md')
  const releasing = readWorkspaceFile('docs/RELEASING.md')
  const prereleaseCheck = readWorkspaceFile('scripts/prerelease-check.mjs')
  const memorySection = readWorkspaceFile('src/components/settingsSections/MemorySection.tsx')
  const changelog = readWorkspaceFile('CHANGELOG.md')

  assert.match(v04Plan, /Current Release Priority/)
  assert.match(v04Plan, /`v0\.4\.0` is now the stable Quiet Observation Foundation release/)
  assert.match(v04Plan, /current active stacked\s+v0\.4\.x slice is `v0\.4\.4` Beta Feedback And Copy Tuning/)
  assert.match(v04Plan, /Do not expand `v0\.4\.4` into external notifications/)
  assert.match(v04Plan, /Separate decision from emission/)
  assert.match(v04Plan, /Repeated polling cannot emit the same check-in line again/)
  assert.match(v04Plan, /v0\.4\.3 — User-Facing Transparency/)
  assert.match(v04Plan, /rawContentVisible: false/)
  assert.match(v04Plan, /blocked reasons/)
  assert.match(v04Plan, /v0\.4\.4 — Beta Feedback And Copy Tuning/)
  assert.match(v04Plan, /Feedback normalization keeps only semantic labels/)
  assert.match(v04Plan, /no feedback analytics engine/)
  assert.match(v04Plan, /v0\.4\.5 — Release Hardening/)
  assert.match(v04Plan, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  assert.match(rootReadme, /RELEASE-NOTES-v0\.4\.0\.md/)
  assert.match(rootReadme, /本次更新 — v0\.4\.0/)
  assert.match(rootReadme, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  for (const [path, readme] of localizedReadmes) {
    assert.match(readme, /V0\.4_DESKTOP_COMPANION_AWARENESS\.md/, `${path} should link the v0.4 plan`)
    assert.match(readme, /RELEASE-NOTES-v0\.4\.0\.md/, `${path} should link the v0.4 stable notes`)
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
  assert.match(coarseTimeReleaseNotes, /Draft/)
  assert.match(coarseTimeReleaseNotes, /Coarse Time Language/)
  assert.match(coarseTimeReleaseNotes, /No new sensing sources/)
  assert.match(coarseTimeReleaseNotes, /Do not publish until/)
  assert.match(coarseTimeReleaseNotesZh, /草稿/)
  assert.match(coarseTimeReleaseNotesZh, /粗略时间语言/)
  assert.match(coarseTimeReleaseNotesZh, /不新增感知来源/)
  assert.match(checkInReleaseNotes, /Draft/)
  assert.match(checkInReleaseNotes, /Check-In Policy/)
  assert.match(checkInReleaseNotes, /Do not publish until/)
  assert.match(checkInReleaseNotes, /external notifications/)
  assert.match(checkInReleaseNotes, /message sending/)
  assert.match(checkInReleaseNotes, /Decide is separate from emit/)
  assert.match(checkInReleaseNotesZh, /草稿/)
  assert.match(checkInReleaseNotesZh, /Check-In 策略/)
  assert.match(checkInReleaseNotesZh, /暂不发布/)
  assert.match(checkInReleaseNotesZh, /外部通知/)
  assert.match(checkInReleaseNotesZh, /决策和发出分开/)
  assert.match(transparencyReleaseNotes, /Draft/)
  assert.match(transparencyReleaseNotes, /User-Facing Transparency/)
  assert.match(transparencyReleaseNotes, /Do not publish until/)
  assert.match(transparencyReleaseNotes, /rawContentVisible: false/)
  assert.match(transparencyReleaseNotes, /No README stable-entry switch/)
  assert.match(transparencyReleaseNotes, /raw timeline/)
  assert.match(transparencyReleaseNotesZh, /草稿/)
  assert.match(transparencyReleaseNotesZh, /用户可见透明度/)
  assert.match(transparencyReleaseNotesZh, /不要发布/)
  assert.match(transparencyReleaseNotesZh, /不切换 README 稳定版入口/)
  assert.match(transparencyReleaseNotesZh, /原始时间线/)
  assert.match(feedbackReleaseNotes, /Draft/)
  assert.match(feedbackReleaseNotes, /Beta Feedback And Copy Tuning/)
  assert.match(feedbackReleaseNotes, /Do not publish until/)
  assert.match(feedbackReleaseNotes, /feedback normalization helper/)
  assert.match(feedbackReleaseNotes, /No README stable-entry switch/)
  assert.match(feedbackReleaseNotes, /No feedback analytics engine/)
  assert.match(feedbackReleaseNotesZh, /草稿/)
  assert.match(feedbackReleaseNotesZh, /Beta 反馈与文案调优/)
  assert.match(feedbackReleaseNotesZh, /不要发布/)
  assert.match(feedbackReleaseNotesZh, /不切换 README 稳定版入口/)
  assert.match(feedbackReleaseNotesZh, /不做反馈分析引擎/)

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
  assert.match(memorySection, /clearRecentCompanionSummary\(\)\s+refreshRecentCompanionSummary\(\)/)

  assert.match(betaReleaseNotes, /Nexus v0\.4\.0-beta\.1/)
  assert.match(betaReleaseNotes, /Desktop companion awareness begins/)
  assert.match(betaReleaseNotes, /Nexus is open but not being used\s+directly/)
  assert.match(betaReleaseNotes, /Exact minute and second durations stay\s+out of companion copy/)
  assert.match(betaReleaseNotes, /clears the\s+recent local companion summary/)
  assert.match(betaReleaseNotes, /No v0\.5 desktop pet mouse-following or typing reactions yet/)

  const stableSection = changelog.split('## [0.4.0]')[1]?.split('\n## [')[0] ?? ''
  assert.match(stableSection, /Desktop companion awareness foundation/)
  assert.match(stableSection, /Stable release documentation/)
  assert.match(stableSection, /Session-bound quiet observation summaries/)

  const betaSection = changelog.split('## [0.4.0-beta.1]')[1]?.split('\n## [')[0] ?? ''
  assert.match(betaSection, /v0\.4 desktop companion awareness foundation/)
  assert.match(betaSection, /v0\.4 community validation path/)
  assert.match(betaSection, /v0\.4 release hardening handoff/)
})
