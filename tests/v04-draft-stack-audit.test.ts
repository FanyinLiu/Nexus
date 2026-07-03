import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'

import {
  buildV04DraftStackReport,
  summarizeV04DraftStackReport,
} from '../scripts/v04-draft-stack-audit.mjs'

function writeAuditFixtureRoot(readmeText: string): string {
  const root = mkdtempSync(join(tmpdir(), 'nexus-v04-audit-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true,
    version: '0.4.1',
    scripts: {
      'v04:draft-stack:audit': 'node scripts/v04-draft-stack-audit.mjs',
      'v04:draft-stack:audit:quick': 'node scripts/v04-draft-stack-audit.mjs --quick',
      'verify:pr': 'npm run v04:draft-stack:audit:quick',
    },
  }))

  for (const path of [
    'README.md',
    'docs/README.zh-CN.md',
    'docs/README.zh-TW.md',
    'docs/README.ja.md',
    'docs/README.ko.md',
  ]) {
    writeFileSync(join(root, path), readmeText)
  }

  return root
}

function writeFullAuditFixtureRoot(overrides: Record<string, string> = {}): string {
  const root = writeAuditFixtureRoot(`
# Nexus

RELEASE-NOTES-v0.4.1.md
`)

  for (const version of ['0.4.2', '0.4.3', '0.4.4', '0.4.5']) {
    const enPath = `docs/RELEASE-NOTES-v${version}.md`
    const zhPath = `docs/RELEASE-NOTES-v${version}.zh-CN.md`
    const extraEn = version === '0.4.2'
      ? 'invalid current and helper timestamp suppression\npassive in-app payload shape and integer TTL bounds'
      : ''
    const extraZh = version === '0.4.2'
      ? '无效当前时间和辅助时间戳压制\n被动 in-app payload 结构和整数 TTL 边界'
      : ''

    writeFileSync(join(root, enPath), overrides[enPath] ?? `
# Nexus v${version}
Status: Draft
Do not publish until Klein explicitly asks.
No package version bump
No tag or GitHub Release
No README stable-entry switch
${extraEn}
`)
    writeFileSync(join(root, zhPath), overrides[zhPath] ?? `
# Nexus v${version}
状态：草稿
不要发布
不改 package 版本号
不打 tag，不创建 GitHub Release
不切换 README 稳定版入口
${extraZh}
`)
  }

  const files: Record<string, string> = {
    'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md': `
active stacked v0.4.x slice after \`v0.4.1\` remains \`v0.4.5\` Release Hardening Draft
Do not publish \`v0.4.5\`
RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md
no new product behavior
multilingual numeric-unit, written-number, and half-unit leaks
invalid current and helper timestamps
integer TTL bounds
`,
    'docs/ROADMAP.md': `
\`v0.4.5\` is the active stacked release-hardening draft
no package version bump past the active stable, no future-draft tag, no future-draft GitHub Release, and no README stable-entry switch past \`v0.4.1\`
`,
    'CHANGELOG.md': `
v0.4.5 release hardening draft
keeps package version, tag, GitHub Release, and README stable-entry state unchanged
`,
    'docs/RELEASE-CANDIDATE-v0.4-HARDENING.md': 'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
    'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md': `
Status: Draft hardening handoff; not a release.
No package version bump
No tag
No GitHub Release
No README stable-entry switch
v0.4.1 -> v0.4.0
v0.4.2 -> v0.4.1
v0.4.3 -> v0.4.2
v0.4.4 -> v0.4.3
v0.4.5 -> v0.4.1-v0.4.4
npm run v04:draft-stack:audit
npm run verify:release
npm run package:dir:smoke
`,
  }

  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(root, path), overrides[path] ?? text)
  }

  return root
}

test('v0.4 draft stack audit guards the no-release state', () => {
  const report = buildV04DraftStackReport(undefined, { mode: 'quick' })
  const summary = summarizeV04DraftStackReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.mode, 'quick')
  assert.equal(summary.ok, true)
  assert.equal(summary.errors, 0)
  assert.equal(report.stableRelease, 'v0.4.1')
  assert.deepEqual(report.draftReleases, ['v0.4.2', 'v0.4.3', 'v0.4.4', 'v0.4.5'])
  assert.equal(report.privacy.staticSourceOnly, true)
  assert.equal(report.privacy.readsUserData, false)
  assert.equal(report.privacy.readsEnvironment, false)
  assert.equal(report.privacy.readsNetwork, false)
  assert.equal(report.privacy.createsReleaseArtifacts, false)
})

test('v0.4 draft stack audit guards the full current draft stack', () => {
  const report = buildV04DraftStackReport()
  const summary = summarizeV04DraftStackReport(report)

  assert.equal(report.mode, 'full')
  assert.equal(summary.ok, true)
  assert.equal(summary.errors, 0)
  assert.equal(report.errors.missingFiles.length, 0)
  assert.equal(report.errors.missingPhrases.length, 0)
  assert.equal(report.errors.forbiddenPhrases.length, 0)
  assert.equal(report.errors.versionMismatches.length, 0)
})

test('v0.4 draft stack audit rejects missing current 0.4 boundary phrases', (t) => {
  const cases: Array<{ file: string; text: string; missingPhrase: string }> = [
    {
      file: 'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
      text: `
active stacked v0.4.x slice after \`v0.4.1\` remains \`v0.4.5\` Release Hardening Draft
Do not publish \`v0.4.5\`
RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md
no new product behavior
invalid current and helper timestamps
integer TTL bounds
`,
      missingPhrase: 'multilingual numeric-unit, written-number, and half-unit leaks',
    },
    {
      file: 'docs/RELEASE-NOTES-v0.4.2.md',
      text: `
# Nexus v0.4.2
Status: Draft
Do not publish until Klein explicitly asks.
No package version bump
No tag or GitHub Release
No README stable-entry switch
passive in-app payload shape and integer TTL bounds
`,
      missingPhrase: 'invalid current and helper timestamp suppression',
    },
    {
      file: 'docs/RELEASE-NOTES-v0.4.2.zh-CN.md',
      text: `
# Nexus v0.4.2
状态：草稿
不要发布
不改 package 版本号
不打 tag，不创建 GitHub Release
不切换 README 稳定版入口
无效当前时间和辅助时间戳压制
`,
      missingPhrase: '被动 in-app payload 结构和整数 TTL 边界',
    },
  ]

  for (const item of cases) {
    const root = writeFullAuditFixtureRoot({ [item.file]: item.text })
    t.after(() => rmSync(root, { recursive: true, force: true }))

    const report = buildV04DraftStackReport(root)
    const missingPhrases = report.errors.missingPhrases.map((entry) => entry.phrase)

    assert.equal(report.summary.ok, false, `${item.file} should fail the full audit`)
    assert.ok(missingPhrases.includes(item.missingPhrase), `${item.file} should report ${item.missingPhrase}`)
  }
})

test('v0.4 draft stack audit rejects old v0.3 release-note links in public readmes', (t) => {
  const root = writeAuditFixtureRoot(`
# Nexus

RELEASE-NOTES-v0.4.1.md

Old release details should live in CHANGELOG and GitHub Releases now.
See RELEASE-NOTES-v0.3.4-beta.4.md for the old draft.
`)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const report = buildV04DraftStackReport(root, { mode: 'quick' })
  const summary = summarizeV04DraftStackReport(report)
  const forbiddenLabels = report.errors.forbiddenPhrases.map((item) => item.phrase)

  assert.equal(summary.ok, false)
  assert.ok(forbiddenLabels.includes('README should point older releases to CHANGELOG/Releases instead of old release-note links'))
})

test('v0.4 draft stack audit rejects localized old v0.3 sections in public readmes', (t) => {
  const cases = [
    '## 本次更新 — v0.3.4-beta.4',
    '## 本次更新 — v0.3.3',
    '## 今回のアップデート — v0.3.2',
    '## 이번 업데이트 — v0.3.1',
    '## 上一稳定版 — v0.3.0',
    '## 上一穩定版 — v0.3.0',
    '## 一つ前の安定版 — v0.3.0',
    '## 이전 안정 버전 — v0.3.0',
  ]

  for (const heading of cases) {
    const root = writeAuditFixtureRoot(`
# Nexus

RELEASE-NOTES-v0.4.1.md

${heading}

Old release details should live in CHANGELOG and GitHub Releases now.
`)
    t.after(() => rmSync(root, { recursive: true, force: true }))

    const report = buildV04DraftStackReport(root, { mode: 'quick' })
    const summary = summarizeV04DraftStackReport(report)
    const forbiddenLabels = report.errors.forbiddenPhrases.map((item) => item.phrase)

    assert.equal(summary.ok, false, `${heading} should fail the audit`)
    assert.ok(
      forbiddenLabels.includes('README should not expand old v0.3.x release sections above the stable entry'),
      `${heading} should be reported as an old README release section`,
    )
  }
})
