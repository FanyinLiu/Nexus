import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  parseReleaseUpdateProfileArgs,
} from '../scripts/release-update-profile.mjs'
import {
  RELEASE_UPDATE_PROFILE_SIGNED,
  RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
  applyReleaseUpdateProfile,
  isUpdateManifestAsset,
  resolveReleaseUpdateProfile,
} from '../scripts/lib/release-update-profile.mjs'

function withReleaseDir(files: string[], callback: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-update-profile-'))
  mkdirSync(root, { recursive: true })
  for (const fileName of files) writeFileSync(join(root, fileName), `fixture:${fileName}`)
  try {
    callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the update profile follows the signing secret without reading its value', () => {
  assert.equal(resolveReleaseUpdateProfile({}), RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL)
  assert.equal(
    resolveReleaseUpdateProfile({ NEXUS_UPDATE_SIGNING_KEY: '   ' }),
    RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
  )
  assert.equal(
    resolveReleaseUpdateProfile({ NEXUS_UPDATE_SIGNING_KEY: 'not-a-real-key-for-tests' }),
    RELEASE_UPDATE_PROFILE_SIGNED,
  )
})

test('unsigned-manual removes only Windows/Linux updater manifests and signatures', () => {
  withReleaseDir([
    'Nexus Setup 0.5.0.exe',
    'Nexus Setup 0.5.0.exe.blockmap',
    'latest.yml',
    'latest.yml.sig',
  ], (root) => {
    const result = applyReleaseUpdateProfile({
      profile: RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
      platform: 'windows',
      releaseDir: root,
    })

    assert.deepEqual(result.removed, ['latest.yml', 'latest.yml.sig'])
    assert.deepEqual(readdirSync(root).sort(), [
      'Nexus Setup 0.5.0.exe',
      'Nexus Setup 0.5.0.exe.blockmap',
    ])
  })

  withReleaseDir([
    'Nexus-0.5.0-x86_64.AppImage',
    'nexus_0.5.0_amd64.deb',
    'nexus-0.5.0-x64.tar.gz',
    'latest-linux.yml',
    'latest-linux.yml.sig',
    'latest-linux-arm64.yml',
    'latest-linux-arm64.yml.sig',
  ], (root) => {
    const result = applyReleaseUpdateProfile({
      profile: RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
      platform: 'linux',
      releaseDir: root,
    })

    assert.deepEqual(result.removed, [
      'latest-linux-arm64.yml',
      'latest-linux-arm64.yml.sig',
      'latest-linux.yml',
      'latest-linux.yml.sig',
    ])
    assert.deepEqual(readdirSync(root).sort(), [
      'Nexus-0.5.0-x86_64.AppImage',
      'nexus-0.5.0-x64.tar.gz',
      'nexus_0.5.0_amd64.deb',
    ])
  })
})

test('unsigned-manual leaves macOS metadata untouched because its updater is manual-download', () => {
  withReleaseDir([
    'Nexus-0.5.0-arm64.dmg',
    'Nexus-0.5.0-arm64-mac.zip',
    'latest-mac.yml',
  ], (root) => {
    const result = applyReleaseUpdateProfile({
      profile: RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
      platform: 'macos',
      releaseDir: root,
    })

    assert.deepEqual(result.removed, [])
    assert.ok(readdirSync(root).includes('latest-mac.yml'))
  })
})

test('signed profile refuses to continue when the platform manifest is missing', () => {
  withReleaseDir(['Nexus Setup 0.5.0.exe'], (root) => {
    assert.throws(
      () => applyReleaseUpdateProfile({
        profile: RELEASE_UPDATE_PROFILE_SIGNED,
        platform: 'windows',
        releaseDir: root,
      }),
      /signed update profile requires latest\.yml/,
    )
  })

  withReleaseDir(['latest.yml'], (root) => {
    assert.throws(
      () => applyReleaseUpdateProfile({
        profile: RELEASE_UPDATE_PROFILE_SIGNED,
        platform: 'windows',
        releaseDir: root,
        readdir: () => ['latest.yml', 'latest.yml'],
      }),
      /requires exactly one latest\.yml/,
    )
  })
})

test('update manifest asset detection is platform scoped', () => {
  assert.equal(isUpdateManifestAsset('latest.yml', 'windows'), true)
  assert.equal(isUpdateManifestAsset('latest.yml.sig', 'windows'), true)
  assert.equal(isUpdateManifestAsset('latest-linux.yml', 'linux'), true)
  assert.equal(isUpdateManifestAsset('latest-linux-arm64.yml.sig', 'linux'), true)
  assert.equal(isUpdateManifestAsset('latest-mac.yml', 'macos'), false)
  assert.equal(isUpdateManifestAsset('Nexus Setup 0.5.0.exe', 'windows'), false)
})

test('release update profile CLI parser is strict about modes and required values', () => {
  assert.deepEqual(parseReleaseUpdateProfileArgs(['--resolve']), { mode: 'resolve' })
  assert.deepEqual(
    parseReleaseUpdateProfileArgs([
      '--apply',
      '--profile',
      'unsigned-manual',
      '--platform=windows',
      '--release-dir=out',
    ]),
    {
      mode: 'apply',
      profile: 'unsigned-manual',
      platform: 'windows',
      releaseDir: join(process.cwd(), 'out'),
    },
  )

  for (const argv of [
    [],
    ['--resolve', '--apply'],
    ['--apply', '--platform', 'windows'],
    ['--apply', '--profile', 'signed'],
    ['--apply', '--profile', 'signed', '--platform'],
    ['--apply', '--profile', 'signed', '--platform', 'windows', '--typo'],
  ]) {
    assert.throws(
      () => parseReleaseUpdateProfileArgs(argv),
      /select exactly one mode|required with --apply|requires a value|unknown argument|may not be combined/,
    )
  }
})
