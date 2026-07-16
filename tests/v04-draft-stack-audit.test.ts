import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  buildV04DraftStackReport,
  summarizeV04DraftStackReport,
} from '../scripts/v04-draft-stack-audit.mjs'

const CURRENT_STABLE_RELEASE = '0.4.3'
const PREVIOUS_PUBLIC_RELEASE = '0.4.1'
const DRAFT_RELEASES = ['0.4.4', '0.4.5'] as const

const README_BOUNDARY_FIXTURES: Record<string, string> = {
  'README.md': `
当前稳定版：v${CURRENT_STABLE_RELEASE}
[v${CURRENT_STABLE_RELEASE} Release Notes](RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md)
`,
  'docs/README.zh-CN.md': `
当前稳定版：v${CURRENT_STABLE_RELEASE}
[v${CURRENT_STABLE_RELEASE} Release Notes](RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md)
`,
  'docs/README.zh-TW.md': `
目前穩定版：v${CURRENT_STABLE_RELEASE}
[v${CURRENT_STABLE_RELEASE} Release Notes](RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md)
`,
  'docs/README.ja.md': `
現在の安定版：v${CURRENT_STABLE_RELEASE}
[v${CURRENT_STABLE_RELEASE} Release Notes](RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md)
`,
  'docs/README.ko.md': `
현재 안정 버전: v${CURRENT_STABLE_RELEASE}
[v${CURRENT_STABLE_RELEASE} Release Notes](RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md)
`,
}

function writeAuditFixtureRoot(
  readmeText: string,
  packageVersion = CURRENT_STABLE_RELEASE,
  includeBoundary = true,
  boundaryOverrides: Record<string, string> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'nexus-v04-audit-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true,
    version: packageVersion,
    scripts: {
      'v04:draft-stack:audit': 'node scripts/v04-draft-stack-audit.mjs',
      'v04:draft-stack:audit:quick': 'node scripts/v04-draft-stack-audit.mjs --quick',
      'verify:pr': 'npm run v04:draft-stack:audit:quick',
    },
  }))

  for (const path of Object.keys(README_BOUNDARY_FIXTURES)) {
    const boundary = boundaryOverrides[path] ?? README_BOUNDARY_FIXTURES[path] ?? ''
    writeFileSync(join(root, path), includeBoundary ? `${readmeText}\n${boundary}` : readmeText)
  }

  return root
}

function writeFullAuditFixtureRoot(
  overrides: Record<string, string> = {},
  packageVersion = CURRENT_STABLE_RELEASE,
): string {
  const root = writeAuditFixtureRoot('# Nexus')
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true,
    version: packageVersion,
    scripts: {
      'v04:draft-stack:audit': 'node scripts/v04-draft-stack-audit.mjs',
      'v04:draft-stack:audit:quick': 'node scripts/v04-draft-stack-audit.mjs --quick',
      'verify:pr': 'npm run v04:draft-stack:audit:quick',
    },
  }))

  const files: Record<string, string> = {
    [`docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md`]: `
# Nexus v${CURRENT_STABLE_RELEASE}
Status: Stable unsigned release. v${CURRENT_STABLE_RELEASE} is the current stable version and this is its formal release record.
The protected tag workflow creates assets.
The maintainer explicitly waived the normal beta window.
No multi-day or cross-platform physical-device evidence is claimed.
`,
    [`docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.zh-CN.md`]: `
# Nexus v${CURRENT_STABLE_RELEASE}
状态：正式未签名稳定版。v${CURRENT_STABLE_RELEASE} 是当前稳定版本，本文件是正式发行记录。
资产只由受保护的 tag 工作流生成。
维护者明确豁免通常的 beta 时长。
不会虚构多日使用或跨平台实体设备验证证据。
`,
    'docs/RELEASE-NOTES-v0.4.4.md': `
# Nexus v0.4.4
Status: Draft. Do not publish until Klein explicitly asks.
v${CURRENT_STABLE_RELEASE} is the current public stable release.
No package version bump
No tag or GitHub Release
No README stable-entry switch
`,
    'docs/RELEASE-NOTES-v0.4.4.zh-CN.md': `
# Nexus v0.4.4
状态：草稿。不要发布。
当前公开稳定版是 v${CURRENT_STABLE_RELEASE}。
不改 package 版本号
不打 tag，不创建 GitHub Release
不切换 README 稳定版入口
`,
    'docs/RELEASE-NOTES-v0.4.5.md': `
# Nexus v0.4.5
Status: Draft. Do not publish until Klein explicitly asks.
The current public stable release is v${CURRENT_STABLE_RELEASE}.
No package version bump
No tag or GitHub Release
No README stable-entry switch
Recorded local draft-hardening evidence
`,
    'docs/RELEASE-NOTES-v0.4.5.zh-CN.md': `
# Nexus v0.4.5
状态：草稿。不要发布。
当前公开稳定版 v${CURRENT_STABLE_RELEASE}。
不改 package 版本号
不打 tag，不创建 GitHub Release
不切换 README 稳定版入口
本地硬化证据
`,
    'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md': `
current public stable release v${CURRENT_STABLE_RELEASE}
\`v0.4.5\` Release Hardening Draft is a non-shipping review layer only
Do not publish \`v0.4.5\`
RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md
no new product behavior
multilingual numeric-unit, written-number, and half-unit leaks
invalid current and helper timestamps
integer TTL bounds
`,
    'docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md': `
Status: historical implementation and review plan.
The current public stable release is \`v${CURRENT_STABLE_RELEASE}\`.
\`v0.4.4\` remains a draft.
`,
    'docs/ROADMAP.md': `
current public stable release is v${CURRENT_STABLE_RELEASE}
\`v0.4.4\` remains a draft
\`v0.4.5\` is a non-shipping release-hardening review layer
package version, tag, GitHub Release, or README stable entry beyond \`v${CURRENT_STABLE_RELEASE}\`
`,
    'CHANGELOG.md': `
## [Unreleased]
v0.4.4 beta feedback and copy tuning draft
v0.4.5 draft hardening evidence
full v0.4 draft-stack audit

## [${CURRENT_STABLE_RELEASE}] - 2026-07-16
The release commit is published only through the protected stable-tag workflow.
v${CURRENT_STABLE_RELEASE} is the current stable release.

## [${PREVIOUS_PUBLIC_RELEASE}] - 2026-07-03
`,
    'docs/RELEASE-CANDIDATE-v0.4-HARDENING.md': 'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
    'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md': `
Status: Draft hardening handoff; not a release.
Boundary anchor: current public stable release v${CURRENT_STABLE_RELEASE}.
\`v${CURRENT_STABLE_RELEASE}\` remains the current public stable release entry point.
\`v0.4.4\` and \`v0.4.5\` remain stacked draft review layers.
No package version bump
No tag
No GitHub Release
No README stable-entry switch
v0.4.4 -> v0.4.3
v0.4.5 -> v0.4.3-v0.4.4
npm run v04:draft-stack:audit
npm run verify:release
## Evidence Collected
`,
    [`docs/RELEASE-CANDIDATE-v${CURRENT_STABLE_RELEASE}-HANDOFF.md`]: `
# Nexus v${CURRENT_STABLE_RELEASE} Stable Release Handoff
Status: Stable unsigned release handoff.
v${CURRENT_STABLE_RELEASE} is the current stable version.
The maintainer explicitly waived the normal beta window.
No multi-day conversation evidence is claimed.
The protected tag workflow creates assets.
Keep v${CURRENT_STABLE_RELEASE} separate from the v0.4.4/v0.4.5 drafts.
`,
  }

  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(root, path), overrides[path] ?? text)
  }

  return root
}

test('v0.4 draft stack quick audit guards the stable release boundary', () => {
  const report = buildV04DraftStackReport(undefined, { mode: 'quick' })
  const summary = summarizeV04DraftStackReport(report)

  assert.equal(report.schemaVersion, 3)
  assert.equal(report.mode, 'quick')
  assert.equal(report.releaseState, 'stable')
  assert.equal(report.currentStableRelease, `v${CURRENT_STABLE_RELEASE}`)
  assert.equal(report.previousPublicRelease, `v${PREVIOUS_PUBLIC_RELEASE}`)
  assert.deepEqual(report.draftReleases, DRAFT_RELEASES.map((version) => `v${version}`))
  assert.equal(summary.ok, true)
  assert.equal(summary.errors, 0)
  assert.deepEqual(report.privacy, {
    staticSourceOnly: true,
    readsUserData: false,
    readsEnvironment: false,
    readsNetwork: false,
    createsReleaseArtifacts: false,
  })
})

test('v0.4 draft stack full audit guards stable v0.4.3 and later drafts', () => {
  const report = buildV04DraftStackReport()

  assert.equal(report.mode, 'full')
  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
  assert.deepEqual(report.errors, {
    missingFiles: [],
    missingPhrases: [],
    forbiddenPhrases: [],
    versionMismatches: [],
  })
  assert.ok(report.checkedFiles.includes('docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md'))
  assert.ok(report.checkedFiles.includes(`docs/RELEASE-CANDIDATE-v${CURRENT_STABLE_RELEASE}-HANDOFF.md`))
})

test('full fixture models v0.4.3 as dated stable before v0.4.1', (t) => {
  const root = writeFullAuditFixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  assert.equal(report.summary.ok, true)
})

test('quick audit rejects a package version outside the current stable release', (t) => {
  const root = writeAuditFixtureRoot('# Nexus', PREVIOUS_PUBLIC_RELEASE)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root, { mode: 'quick' })
  assert.deepEqual(report.errors.versionMismatches, [{
    file: 'package.json',
    expected: CURRENT_STABLE_RELEASE,
    actual: PREVIOUS_PUBLIC_RELEASE,
  }])
})

test('quick audit rejects a README that retains the candidate boundary', (t) => {
  const root = writeAuditFixtureRoot(`
# Nexus
当前代码候选：v0.4.3
`)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root, { mode: 'quick' })
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.equal(report.summary.ok, false)
  assert.ok(labels.includes('README must not retain the pre-release code-candidate boundary'))
})

test('quick audit rejects a localized README without its native stable label', (t) => {
  const root = writeAuditFixtureRoot('# Nexus', CURRENT_STABLE_RELEASE, true, {
    'docs/README.ja.md': `
Current stable release: v0.4.3
[v0.4.3 Release Notes](RELEASE-NOTES-v0.4.3.md)
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root, { mode: 'quick' })
  const missing = report.errors.missingPhrases
    .filter((entry) => entry.file === 'docs/README.ja.md')
    .map((entry) => entry.phrase)
  assert.ok(missing.includes('README must identify v0.4.3 as the current stable release'))
})

test('full audit rejects a stable release note that still calls itself a candidate', (t) => {
  const root = writeFullAuditFixtureRoot({
    'docs/RELEASE-NOTES-v0.4.3.md': `
# Nexus v0.4.3
Status: Release candidate. This is not a public release.
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.equal(report.summary.ok, false)
  assert.ok(labels.includes('stable release notes must not retain release-candidate status'))
  assert.ok(labels.includes('stable release notes must not call v0.4.3 unpublished'))
})

test('full audit rejects superseded candidate wording in later draft notes', (t) => {
  const root = writeFullAuditFixtureRoot({
    'docs/RELEASE-NOTES-v0.4.4.md': `
# Nexus v0.4.4
Status: Draft. Do not publish until Klein explicitly asks.
v0.4.3 is the current public stable release.
The local v0.4.3 code candidate remains unpublished.
No package version bump
No tag or GitHub Release
No README stable-entry switch
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.ok(labels.includes('v0.4.4 release notes must not retain the superseded candidate boundary'))
})

test('full audit rejects a future draft claiming stable status', (t) => {
  const root = writeFullAuditFixtureRoot({
    'docs/RELEASE-NOTES-v0.4.5.md': `
# Nexus v0.4.5
Status: Draft. Do not publish until Klein explicitly asks.
The current public stable release is v0.4.3.
No package version bump
No tag or GitHub Release
No README stable-entry switch
Recorded local draft-hardening evidence
v0.4.5 is now stable.
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.ok(labels.includes('v0.4.5 release notes must not claim the draft is stable or published'))
})

test('full audit rejects a roadmap that restores the v0.4.3 candidate boundary', (t) => {
  const root = writeFullAuditFixtureRoot({
    'docs/ROADMAP.md': `
current public stable release is v0.4.3
\`v0.4.4\` remains a draft
\`v0.4.5\` is a non-shipping release-hardening review layer
package version, tag, GitHub Release, or README stable entry beyond \`v0.4.3\`
The local code candidate is v0.4.3.
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.ok(labels.includes('ROADMAP must not retain the v0.4.3 candidate boundary'))
})

test('full audit rejects an undated v0.4.3 changelog heading', (t) => {
  const root = writeFullAuditFixtureRoot({
    'CHANGELOG.md': `
## [Unreleased]
v0.4.4 beta feedback and copy tuning draft
v0.4.5 draft hardening evidence
full v0.4 draft-stack audit

## [0.4.3]
The release commit is published only through the protected stable-tag workflow.
v0.4.3 is the current stable release.

## [0.4.1] - 2026-07-03
`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root)
  const missing = report.errors.missingPhrases.map((entry) => entry.phrase)
  assert.ok(missing.includes('## [0.4.3] - 2026-07-16'))
})

test('quick audit rejects old v0.3 release-note links and expanded sections', (t) => {
  const root = writeAuditFixtureRoot(`
# Nexus
See RELEASE-NOTES-v0.3.4-beta.4.md.
## 本次更新 — v0.3.3
`)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root, { mode: 'quick' })
  const labels = report.errors.forbiddenPhrases.map((entry) => entry.phrase)
  assert.ok(labels.includes('README should point older releases to CHANGELOG/Releases instead of old release-note links'))
  assert.ok(labels.includes('README should not expand old v0.3.x release sections above the stable entry'))
})
