import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  externalWindowOpenNeedsConfirmation,
  isAllowlistedExternalWindowOpenUrl,
} from '../electron/windowNavigation.js'
import {
  configureExternalOpenConfirmationStore,
  getExternalOpenConfirmation,
  mergeExternalOpenConfirmation,
  saveExternalOpenConfirmation,
} from '../electron/services/externalOpenConfirmation.js'

test('project pages and the crisis chat link skip confirmation', () => {
  assert.equal(
    isAllowlistedExternalWindowOpenUrl('https://github.com/FanyinLiu/Nexus'),
    true,
  )
  assert.equal(
    isAllowlistedExternalWindowOpenUrl('https://github.com/FanyinLiu/Nexus/blob/main/CHANGELOG.md'),
    true,
  )
  assert.equal(
    isAllowlistedExternalWindowOpenUrl('https://github.com/FanyinLiu/Nexus/issues/new'),
    true,
  )
  assert.equal(
    isAllowlistedExternalWindowOpenUrl('https://chat.988lifeline.org/'),
    true,
  )
  assert.equal(
    externalWindowOpenNeedsConfirmation('https://github.com/FanyinLiu/Nexus/issues/new', true),
    false,
  )
})

test('other https links follow the saved confirmation preference', () => {
  const chatLink = 'https://example.com/article'
  assert.equal(isAllowlistedExternalWindowOpenUrl(chatLink), false)
  assert.equal(isAllowlistedExternalWindowOpenUrl('https://github.com/other/repo'), false)
  assert.equal(isAllowlistedExternalWindowOpenUrl('https://github.com.evil.test/FanyinLiu/Nexus'), false)
  assert.equal(isAllowlistedExternalWindowOpenUrl('http://github.com/FanyinLiu/Nexus'), false)
  assert.equal(isAllowlistedExternalWindowOpenUrl('https://user:pass@github.com/FanyinLiu/Nexus'), false)
  assert.equal(externalWindowOpenNeedsConfirmation(chatLink, true), true)
  assert.equal(externalWindowOpenNeedsConfirmation(chatLink, undefined), true)
  assert.equal(externalWindowOpenNeedsConfirmation(chatLink, false), false)
})

test('external open confirmation defaults on and keeps a partial panel save', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nexus-external-open-'))
  configureExternalOpenConfirmationStore({
    getStorePath: () => path.join(directory, 'external-open-confirmation.json'),
  })

  assert.deepEqual(getExternalOpenConfirmation(), {
    requiresConfirmation: true,
    uiLanguage: null,
  })
  assert.deepEqual(mergeExternalOpenConfirmation(
    { requiresConfirmation: false, uiLanguage: 'ja' },
    { uiLanguage: 'zh-TW' },
  ), {
    requiresConfirmation: false,
    uiLanguage: 'zh-TW',
  })

  const saved = saveExternalOpenConfirmation({
    requiresConfirmation: false,
    uiLanguage: 'ko',
  })
  assert.deepEqual(saved, {
    requiresConfirmation: false,
    uiLanguage: 'ko',
  })
  assert.deepEqual(getExternalOpenConfirmation(), saved)
})
