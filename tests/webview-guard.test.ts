import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

import {
  reminderStripWebPreferences,
  trustedRendererWebPreferences,
} from '../electron/webPreferences.js'
import { installWebviewAttachGuard } from '../electron/webviewGuard.js'

type AppLike = Parameters<typeof installWebviewAttachGuard>[0]

function createContents() {
  return new EventEmitter()
}

describe('renderer webPreferences disable webviewTag', () => {
  test('pet and panel baseline keeps the security flags and webviewTag off', () => {
    const prefs = trustedRendererWebPreferences('/tmp/preload.js')

    assert.equal(prefs.preload, '/tmp/preload.js')
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.sandbox, true)
    assert.equal(prefs.webSecurity, true)
    assert.equal(prefs.webviewTag, false)
  })

  test('reminder strip uses the same baseline and keeps webviewTag off', () => {
    const prefs = reminderStripWebPreferences('/tmp/strip-preload.js')

    assert.equal(prefs.preload, '/tmp/strip-preload.js')
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.sandbox, true)
    assert.equal(prefs.webSecurity, true)
    assert.equal(prefs.webviewTag, false)
    assert.equal(prefs.spellcheck, false)
  })

  test('every BrowserWindow creation path uses the trusted baseline', async () => {
    const [windowCreation, reminderStrip] = await Promise.all([
      readFile(new URL('../electron/windowCreation.js', import.meta.url), 'utf8'),
      readFile(new URL('../electron/services/reminderStrip.js', import.meta.url), 'utf8'),
    ])

    const petAndPanel = windowCreation.match(
      /webPreferences: trustedRendererWebPreferences\(getPreloadPath\(\)\)/g,
    )
    assert.equal(petAndPanel?.length, 2, 'pet and panel must both use the shared baseline')
    assert.match(reminderStrip, /webPreferences: reminderStripWebPreferences\(STRIP_PRELOAD\)/)
    assert.doesNotMatch(reminderStrip, /webPreferences:\s*\{/)
  })
})

describe('installWebviewAttachGuard', () => {
  test('registers a web-contents-created hook that guards every new contents', () => {
    const app = new EventEmitter()
    installWebviewAttachGuard(app as unknown as AppLike)

    assert.equal(app.listenerCount('web-contents-created'), 1)

    const contents = createContents()
    app.emit('web-contents-created', {}, contents)

    assert.equal(contents.listenerCount('will-attach-webview'), 1)
  })

  test('prevents every synthetic will-attach-webview event', () => {
    const app = new EventEmitter()
    installWebviewAttachGuard(app as unknown as AppLike)
    const contents = createContents()
    app.emit('web-contents-created', {}, contents)

    let preventDefaultCalls = 0
    const event = {
      preventDefault() {
        preventDefaultCalls += 1
      },
    }

    contents.emit('will-attach-webview', event, {}, { src: 'https://example.test/guest' })
    contents.emit('will-attach-webview', event, {}, { src: 'file:///tmp/guest.html' })

    assert.equal(preventDefaultCalls, 2)
  })

  test('main startup installs the guard before the first window is created', async () => {
    const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8')

    assert.match(
      source,
      /import \{ installWebviewAttachGuard \} from '\.\/webviewGuard\.js'/,
    )
    const installIndex = source.indexOf('installWebviewAttachGuard(app)')
    const firstWindowIndex = source.search(/createMainWindow\(\{/)
    assert.ok(installIndex >= 0, 'startup must install the webview guard')
    assert.ok(firstWindowIndex >= 0, 'startup must create the main window')
    assert.ok(
      installIndex < firstWindowIndex,
      'the webview guard must be installed before any window exists',
    )
  })
})
