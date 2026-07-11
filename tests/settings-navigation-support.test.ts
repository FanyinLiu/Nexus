import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getInitialPreferredSettingsSectionId,
  shouldOpenInitialSettingsPanel,
} from '../src/app/controllers/settingsNavigationSupport.ts'

function withFakeWindow(initialHref: string, run: () => void) {
  const previousWindow = globalThis.window
  const initialUrl = new URL(initialHref)
  const fakeWindow = {
    location: {
      search: initialUrl.search,
    },
  }

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    })
    run()
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
}

test('settings navigation opens settings only when the panel URL asks for settings', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings', () => {
    assert.equal(shouldOpenInitialSettingsPanel('panel'), true)
    assert.equal(shouldOpenInitialSettingsPanel('pet'), false)
  })
})

test('settings navigation normalizes legacy integrations section to tools', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings&settingsSection=integrations', () => {
    assert.equal(getInitialPreferredSettingsSectionId(), 'tools')
  })
})

test('settings navigation ignores invalid child section ids', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings&settingsSection=missing', () => {
    assert.equal(getInitialPreferredSettingsSectionId(), null)
  })
})
