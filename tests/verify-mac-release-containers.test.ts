import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  selectMacReleaseContainers,
  verifyMacReleaseContainers,
} from '../scripts/verify-mac-release-containers.mjs'

function withContainers(callback: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-mac-container-test-'))
  writeFileSync(join(root, 'Nexus-Setup-0.4.3-arm64.dmg'), 'dmg')
  writeFileSync(join(root, 'Nexus-Setup-0.4.3-arm64-mac.zip'), 'zip')
  writeFileSync(join(root, 'Nexus-Setup-0.4.3-arm64.dmg.blockmap'), 'blockmap')
  try {
    callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('mac release container selector requires one formal DMG and one ZIP', () => {
  withContainers((root) => {
    const result = selectMacReleaseContainers(root)
    assert.equal(result.ok, true)
    assert.match(result.dmgPath, /\.dmg$/)
    assert.match(result.zipPath, /\.zip$/)
  })
})

test('mac release container verifier checks the app inside both downloadable containers', () => {
  withContainers((root) => {
    const verified: string[] = []
    const result = verifyMacReleaseContainers(root, {
      expectedVersion: '0.4.3',
      makeTempRoot: () => '/virtual/temp',
      removeTempRoot: () => {},
      materializeContainer: ({ kind }: { kind: string }) => ({
        appPath: `/virtual/${kind}/Nexus.app`,
        cleanup() {},
      }),
      verifyApp: (appPath: string) => {
        verified.push(appPath)
        return { ok: true, errors: [], bundleIdentifier: 'ai.factory.desktoppet', bundleVersion: '0.4.3', architectures: ['arm64'] }
      },
    })

    assert.equal(result.ok, true)
    assert.deepEqual(verified, ['/virtual/dmg/Nexus.app', '/virtual/zip/Nexus.app'])
  })
})

test('mac release container verifier propagates an inner bundle failure', () => {
  withContainers((root) => {
    const result = verifyMacReleaseContainers(root, {
      expectedVersion: '0.4.3',
      makeTempRoot: () => '/virtual/temp',
      removeTempRoot: () => {},
      materializeContainer: ({ kind }: { kind: string }) => ({ appPath: `/virtual/${kind}/Nexus.app`, cleanup() {} }),
      verifyApp: (appPath: string) => appPath.includes('/zip/')
        ? { ok: false, errors: ['bundle version mismatch'] }
        : { ok: true, errors: [] },
    })

    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => error.includes('zip: bundle version mismatch')))
  })
})

test('mac release container selector rejects extra Smoke containers', () => {
  withContainers((root) => {
    writeFileSync(join(root, 'Nexus Smoke.dmg'), 'smoke')
    const result = selectMacReleaseContainers(root)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => error.includes('exactly one DMG')))
    assert.ok(result.errors.some((error) => error.includes('Smoke identity')))
  })
})
