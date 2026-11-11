import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { describe, test } from 'node:test'

import {
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
  summarizeWindowNavigationErrorForLog,
  summarizeWindowNavigationUrlForLog,
} from '../electron/windowNavigation.js'
import {
  PET_LOAD_FALLBACK_PATH,
  PET_LOAD_FALLBACK_RETRY_URL,
} from '../electron/windowLoadFallback.js'

describe('windowNavigation.isAllowedRendererNavigation', () => {
  const rendererEntry = 'http://127.0.0.1:47822/?view=pet'

  test('allows the same view role with different app query params', () => {
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/?view=pet&section=chat', rendererEntry),
      true,
    )
    assert.equal(
      isAllowedRendererNavigation(
        'http://127.0.0.1:47822/?view=panel&section=settings&settingsSection=voice',
        'http://127.0.0.1:47822/?view=panel&section=chat',
      ),
      true,
    )
  })

  test('rejects query or hash edits that change the view role', () => {
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/?view=panel&section=settings', rendererEntry),
      false,
    )
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/?view=pet#view=panel', rendererEntry),
      false,
    )
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/?view=pet#note', rendererEntry),
      true,
    )
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/', rendererEntry),
      false,
    )
  })

  test('blocks userinfo prefix tricks that pass naive startsWith checks', () => {
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822@evil.example/', rendererEntry),
      false,
    )
  })

  test('blocks same-host navigations to a different path', () => {
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/admin', rendererEntry),
      false,
    )
  })

  test('allows only the app fallback file and pet retry marker', () => {
    const packagedEntry = 'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=pet'
    const fallbackUrl = pathToFileURL(PET_LOAD_FALLBACK_PATH)
    fallbackUrl.searchParams.set('lang', 'zh-CN')

    assert.equal(
      isAllowedRendererNavigation(fallbackUrl.toString(), packagedEntry),
      true,
      'the packaged fallback file with ?lang= is app-initiated',
    )
    assert.equal(
      isAllowedRendererNavigation(PET_LOAD_FALLBACK_RETRY_URL, packagedEntry),
      true,
      'the fixed retry marker is app-initiated',
    )
    assert.equal(
      isAllowedRendererNavigation(PET_LOAD_FALLBACK_RETRY_URL, 'http://127.0.0.1:47822/?view=panel'),
      false,
      'the pet fallback marker does not apply to the panel',
    )
    assert.equal(
      isAllowedRendererNavigation('file:///tmp/pet-load-fallback.html?lang=zh-CN', packagedEntry),
      false,
      'a same-named file outside the app path is not allowlisted',
    )
    assert.equal(
      isAllowedRendererNavigation('nexus-retry://panel', packagedEntry),
      false,
      'only the fixed pet marker is allowlisted',
    )
    assert.equal(
      isAllowedRendererNavigation('https://evil.example/pet-load-fallback.html', packagedEntry),
      false,
      'an unrelated external URL stays blocked',
    )
  })

  test('allows the same packaged file entry and blocks other file paths or view roles', () => {
    const packagedEntry = 'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=pet'
    assert.equal(
      isAllowedRendererNavigation(
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=pet',
        packagedEntry,
      ),
      true,
    )
    assert.equal(
      isAllowedRendererNavigation(
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=panel',
        packagedEntry,
      ),
      false,
    )
    assert.equal(
      isAllowedRendererNavigation(
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=panel&section=settings',
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=panel&section=chat',
      ),
      true,
    )
    assert.equal(
      isAllowedRendererNavigation(
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/other.html',
        packagedEntry,
      ),
      false,
    )
  })
})

describe('windowNavigation.normalizeExternalWindowOpenUrl', () => {
  test('uses the same private-target guard as tool-driven external links', () => {
    assert.equal(normalizeExternalWindowOpenUrl('example.com'), 'https://example.com/')
    assert.throws(
      () => normalizeExternalWindowOpenUrl('http://127.0.0.1:11434'),
      /拒绝打开不安全链接/,
    )
  })
})

describe('windowNavigation security log summaries', () => {
  test('summarize URLs without exposing hosts paths queries or fragments', () => {
    const summary = summarizeWindowNavigationUrlForLog(
      'https://private.example.com/secret/path?token=abc#fragment',
    )

    assert.deepEqual(summary, {
      inputLength: 58,
      parsed: true,
      protocol: 'https',
      hostnamePresent: true,
      hostnameLength: 19,
      pathnameLength: 12,
      searchPresent: true,
      searchLength: 10,
      hashPresent: true,
      hashLength: 9,
    })

    const serialized = JSON.stringify(summary)
    for (const privateValue of [
      'private.example.com',
      '/secret/path',
      'token=abc',
      'fragment',
    ]) {
      assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
    }
  })

  test('summarize navigation errors without exposing raw messages', () => {
    const summary = summarizeWindowNavigationErrorForLog(
      new Error('rejected https://private.example.com/secret/path?token=abc'),
    )

    assert.deepEqual(summary, {
      errorName: 'Error',
      messageLength: 58,
    })

    const serialized = JSON.stringify(summary)
    assert.ok(!serialized.includes('private.example.com'))
    assert.ok(!serialized.includes('/secret/path'))
    assert.ok(!serialized.includes('token=abc'))
  })
})
