import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
  summarizeWindowNavigationErrorForLog,
  summarizeWindowNavigationUrlForLog,
} from '../electron/windowNavigation.js'

describe('windowNavigation.isAllowedRendererNavigation', () => {
  const rendererEntry = 'http://127.0.0.1:47822/?view=pet'

  test('allows the renderer origin and path with different app query params', () => {
    assert.equal(
      isAllowedRendererNavigation('http://127.0.0.1:47822/?view=panel&section=settings', rendererEntry),
      true,
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

  test('allows the same packaged file entry and blocks other file paths', () => {
    const packagedEntry = 'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=pet'
    assert.equal(
      isAllowedRendererNavigation(
        'file:///Applications/Nexus.app/Contents/Resources/app/dist/index.html?view=panel',
        packagedEntry,
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
