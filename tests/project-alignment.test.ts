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
  assert.match(rootReadme, /记忆看得见，伙伴也动起来/)
  assert.match(releaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(chineseReleaseNotes, new RegExp(`# Nexus v${escapedVersion}`))
  assert.match(changelog, new RegExp(`## \\[${escapedVersion}\\]`))
  assert.match(handoff, new RegExp(`# Nexus v${escapedVersion} Release Candidate Handoff`))
  assert.match(handoff, /Evidence baseline head: `[0-9a-f]{7,40}`/)
  assert.doesNotMatch(handoff, /48e6b78/)
  assert.match(handoff, /companion presence and visible memory/)
  assert.match(handoff, /does not add a Codex-style work agent/)
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
