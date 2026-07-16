import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getInitialSettingsSectionId,
  getInitialPanelSection,
  getWindowViewSync,
  syncWindowViewToUrl,
} from '../src/app/appSupport.ts'

function withFakeWindow(initialHref: string, run: () => void) {
  const previousWindow = globalThis.window
  const initialUrl = new URL(initialHref)
  const fakeWindow = {
    history: {
      state: { source: 'test' },
      replaceState(state: unknown, _title: string, nextUrl: URL | string) {
        this.state = state
        const resolved = new URL(String(nextUrl))
        fakeWindow.location.href = resolved.href
        fakeWindow.location.search = resolved.search
      },
    },
    location: {
      href: initialUrl.href,
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

test('window view sync reads panel and settings from URL', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings&settingsSection=voice', () => {
    assert.equal(getWindowViewSync(), 'panel')
    assert.equal(getInitialPanelSection(), 'settings')
    assert.equal(getInitialSettingsSectionId(), 'voice')
  })
})

test('window view sync defaults to pet and chat when URL does not opt in', () => {
  withFakeWindow('http://127.0.0.1:47821/?image4Preview=1&settingsSection=voice', () => {
    assert.equal(getWindowViewSync(), 'pet')
    assert.equal(getInitialPanelSection(), 'chat')
    assert.equal(getInitialSettingsSectionId(), null)
  })
})

test('syncWindowViewToUrl preserves preview params while opening settings', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=pet&image4Preview=1&image4State=speaking', () => {
    syncWindowViewToUrl('panel', 'settings')

    const url = new URL(window.location.href)
    assert.equal(url.searchParams.get('view'), 'panel')
    assert.equal(url.searchParams.get('section'), 'settings')
    assert.equal(url.searchParams.get('image4Preview'), '1')
    assert.equal(url.searchParams.get('image4State'), 'speaking')
  })
})

test('syncWindowViewToUrl writes a concrete settings child page', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=pet&image4Preview=1&image4State=speaking', () => {
    syncWindowViewToUrl('panel', 'settings', 'memory')

    const url = new URL(window.location.href)
    assert.equal(url.searchParams.get('view'), 'panel')
    assert.equal(url.searchParams.get('section'), 'settings')
    assert.equal(url.searchParams.get('settingsSection'), 'memory')
    assert.equal(url.searchParams.get('image4Preview'), '1')
    assert.equal(url.searchParams.get('image4State'), 'speaking')
  })
})

test('syncWindowViewToUrl clears settings child page outside settings', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings&settingsSection=voice&image4Preview=1', () => {
    syncWindowViewToUrl('panel', 'chat')

    const url = new URL(window.location.href)
    assert.equal(url.searchParams.get('view'), 'panel')
    assert.equal(url.searchParams.get('section'), 'chat')
    assert.equal(url.searchParams.has('settingsSection'), false)
    assert.equal(url.searchParams.get('image4Preview'), '1')
  })
})

test('syncWindowViewToUrl removes panel section when returning to pet', () => {
  withFakeWindow('http://127.0.0.1:47821/?view=panel&section=settings&settingsSection=voice&image4Preview=1', () => {
    syncWindowViewToUrl('pet')

    const url = new URL(window.location.href)
    assert.equal(url.searchParams.get('view'), 'pet')
    assert.equal(url.searchParams.has('section'), false)
    assert.equal(url.searchParams.has('settingsSection'), false)
    assert.equal(url.searchParams.get('image4Preview'), '1')
  })
})
