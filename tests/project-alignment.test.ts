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
  const handoff = readWorkspaceFile(`docs/RELEASE-CANDIDATE-v${version}-HANDOFF.md`)

  assert.equal(CURRENT_RELEASE_SPOTLIGHT.version, version)
  assert.match(rootReadme, /RELEASE-NOTES-v0\.4\.0-beta\.1\.md/)
  assert.match(releaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(chineseReleaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(changelog, new RegExp(`## \\[${escapedVersion}\\]`))
  assert.match(handoff, new RegExp(`# Nexus v${escapedVersion} Release Candidate Handoff`))
  assert.match(handoff, /Evidence baseline head: `[0-9a-f]{7,40}`/)
  assert.doesNotMatch(handoff, /48e6b78/)
  assert.match(handoff, /desktop companion awareness begins/)
  assert.match(handoff, /Codex-style work agent/)
})

test('public readmes identify the current 0.4 beta entry point', () => {
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
      /RELEASE-NOTES-v0\.4\.0-beta\.1\.md/,
      `${path} should link the current v0.4 beta release notes`,
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
  const betaReleaseNotes = readWorkspaceFile('docs/RELEASE-NOTES-v0.4.0-beta.1.md')
  const releasing = readWorkspaceFile('docs/RELEASING.md')
  const changelog = readWorkspaceFile('CHANGELOG.md')

  assert.match(v04Plan, /v0\.4\.5 — Release Hardening/)
  assert.match(v04Plan, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  assert.match(rootReadme, /RELEASE-NOTES-v0\.4\.0-beta\.1\.md/)
  assert.match(rootReadme, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  for (const [path, readme] of localizedReadmes) {
    assert.match(readme, /V0\.4_DESKTOP_COMPANION_AWARENESS\.md/, `${path} should link the v0.4 plan`)
    assert.match(readme, /RELEASE-NOTES-v0\.4\.0-beta\.1\.md/, `${path} should link the v0.4 beta notes`)
    assert.match(readme, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/, `${path} should link the v0.4 hardening handoff`)
  }
  assert.match(community, /v0\.4 desktop companion awareness/)
  assert.match(betaTemplate, /v0\.4 desktop companion awareness feedback/)
  assert.match(betaTemplate, /Was Nexus open but unused/)
  assert.match(betaTemplate, /too much like monitoring/)

  assert.match(hardening, /npm run verify:release/)
  assert.match(hardening, /npm run package:dir:smoke/)
  assert.match(hardening, /npm run desktop-context-privacy:audit/)
  assert.match(hardening, /npm run message-privacy:audit/)
  assert.match(hardening, /npm run error-redaction:audit/)
  assert.match(hardening, /npm run ipc:audit/)
  assert.match(hardening, /npm run distribution:audit/)
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

  assert.match(releasing, /v0\.4 desktop companion awareness gate/)
  assert.match(releasing, /RELEASE-CANDIDATE-v0\.4-HARDENING\.md/)
  assert.match(releasing, /npm run desktop-context-privacy:audit/)
  assert.match(releasing, /docs\/RELEASE-NOTES-v0\.4\.0-beta\.1\.md/)
  assert.match(releasing, /timing, tone,\s+interruption feel, privacy boundaries/)
  assert.match(releasing, /exact second-level\s+timers, or hidden activity logs/)

  assert.match(betaReleaseNotes, /Nexus v0\.4\.0-beta\.1/)
  assert.match(betaReleaseNotes, /Desktop companion awareness begins/)
  assert.match(betaReleaseNotes, /Nexus is open but not being used\s+directly/)
  assert.match(betaReleaseNotes, /Exact minute and second durations stay\s+out of companion copy/)
  assert.match(betaReleaseNotes, /clears the\s+recent local companion summary/)
  assert.match(betaReleaseNotes, /No v0\.5 desktop pet mouse-following or typing reactions yet/)

  const betaSection = changelog.split('## [0.4.0-beta.1]')[1]?.split('\n## [')[0] ?? ''
  assert.match(betaSection, /v0\.4 desktop companion awareness foundation/)
  assert.match(betaSection, /v0\.4 community validation path/)
  assert.match(betaSection, /v0\.4 release hardening handoff/)
})
