import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  isAllowedRendererNavigation,
  normalizeExternalWindowOpenUrl,
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
