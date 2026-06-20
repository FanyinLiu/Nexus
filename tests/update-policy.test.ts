import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareReleaseVersions,
  GITHUB_RELEASES_URL,
  normalizeGithubReleasePayload,
  resolveUpdaterMode,
} from '../electron/services/updatePolicy.js'

test('resolveUpdaterMode makes unsigned macOS packaged builds check-only by default', () => {
  assert.equal(resolveUpdaterMode({
    platform: 'darwin',
    isPackaged: true,
    macAutoUpdateMode: '',
  }), 'manual-download')
  assert.equal(resolveUpdaterMode({
    platform: 'darwin',
    isPackaged: true,
    macAutoUpdateMode: 'electron-updater',
  }), 'auto-download')
  assert.equal(resolveUpdaterMode({ platform: 'win32', isPackaged: true }), 'auto-download')
  assert.equal(resolveUpdaterMode({ platform: 'linux', isPackaged: true }), 'auto-download')
  assert.equal(resolveUpdaterMode({ platform: 'darwin', isPackaged: false }), 'dev')
})

test('compareReleaseVersions follows stable and beta ordering used by release tags', () => {
  assert.equal(compareReleaseVersions('0.3.5', '0.3.4-beta.4'), 1)
  assert.equal(compareReleaseVersions('0.3.4', '0.3.4-beta.4'), 1)
  assert.equal(compareReleaseVersions('0.3.4-beta.5', '0.3.4-beta.4'), 1)
  assert.equal(compareReleaseVersions('0.3.4-beta.4', '0.3.4'), -1)
  assert.equal(compareReleaseVersions('v0.3.4', '0.3.4'), 0)
})

test('normalizeGithubReleasePayload keeps only safe GitHub release URLs', () => {
  assert.deepEqual(normalizeGithubReleasePayload({
    tag_name: 'v0.3.5',
    html_url: 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.5',
    draft: false,
    prerelease: false,
  }), {
    version: '0.3.5',
    releaseUrl: 'https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.5',
    prerelease: false,
  })

  assert.deepEqual(normalizeGithubReleasePayload({
    tag_name: 'v0.3.5',
    html_url: 'https://example.com/redirect',
    draft: false,
    prerelease: false,
  }), {
    version: '0.3.5',
    releaseUrl: GITHUB_RELEASES_URL,
    prerelease: false,
  })

  assert.equal(normalizeGithubReleasePayload({ tag_name: 'v0.3.5', draft: true }), null)
})
