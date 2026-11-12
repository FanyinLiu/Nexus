/**
 * Handler-level privacy contract for the real 'desktop-context:get' handler.
 *
 * The handler intersects the renderer request with the saved main-process
 * flags. These tests drive the real handler with a renderer that asks for all
 * three captures and a real saved-flag store pointed at a temp file, then
 * count calls into the three capture sources. Removing a `contextPolicy.*`
 * gate in windowIpc.js makes the "saved off" cases read the source.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

register(new URL('./helpers/desktop-context-ipc-hooks.mjs', import.meta.url))

const windowIpc = await import('../electron/ipc/windowIpc.js')
const { configureDesktopContextFlagStore } = await import(
  '../electron/services/desktopContextPolicy.js'
)

type CaptureState = {
  activeWindowCaptures: number
  screenshotCaptures: number
  clipboardReads: number
  activeWindowSnapshot: Record<string, unknown> | null
  screenshotSnapshot: Record<string, unknown> | null
  clipboardText: string
}

type ContextResult = {
  clipboardText?: string
  activeWindowTitle?: string
  screenshotDataUrl?: string
}

type Handler = (event: unknown, payload?: unknown) => Promise<ContextResult>

const testGlobal = globalThis as unknown as {
  __nexusDesktopContextIpc?: CaptureState
  __nexusTestMainProcess?: { handlers: Map<string, Handler> }
}

function captureState(): CaptureState {
  const state = testGlobal.__nexusDesktopContextIpc
  assert.ok(state, 'the desktop-context stub must be initialized before the test runs')
  return state
}

const temporaryDirectories: string[] = []
let handler: Handler | null = null

function installHandler(flags: {
  activeWindow: boolean
  clipboard: boolean
  screenshot: boolean
}): Handler {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-desktop-context-ipc-flags-'))
  temporaryDirectories.push(directory)
  const storePath = join(directory, 'desktop-context-flags.json')
  // Seed the real store's file directly so the handler reads it through
  // getSavedDesktopContextFlags without arming the store's debounced writer.
  writeFileSync(storePath, JSON.stringify(flags))
  configureDesktopContextFlagStore({ getStorePath: () => storePath })

  const state = captureState()
  state.activeWindowCaptures = 0
  state.screenshotCaptures = 0
  state.clipboardReads = 0
  state.activeWindowSnapshot = { activeWindowTitle: 'Synthetic Editor', activeWindowAppName: 'Synthetic IDE' }
  state.screenshotSnapshot = { displayName: 'Synthetic Display', screenshotDataUrl: 'data:image/png;base64,c3ludGhldGlj' }
  state.clipboardText = 'synthetic clipboard text'

  if (!handler) {
    windowIpc.register()
    const installed = testGlobal.__nexusTestMainProcess?.handlers.get('desktop-context:get')
    assert.equal(typeof installed, 'function', 'desktop-context:get must be registered')
    handler = installed!
  }
  return handler
}

const ALL_ON = { activeWindow: true, clipboard: true, screenshot: true }
const REQUEST_ALL = {
  includeActiveWindow: true,
  includeClipboard: true,
  includeScreenshot: true,
  policy: { activeWindow: true, clipboard: true, screenshot: true },
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

test('saved switches off: a renderer request for all three captures reads nothing', async () => {
  const invoke = installHandler({ activeWindow: false, clipboard: false, screenshot: false })

  const result = await invoke(undefined, REQUEST_ALL)

  const state = captureState()
  assert.equal(state.activeWindowCaptures, 0)
  assert.equal(state.screenshotCaptures, 0)
  assert.equal(state.clipboardReads, 0)
  assert.equal(result.activeWindowTitle, undefined)
  assert.equal(result.screenshotDataUrl, undefined)
  assert.equal(result.clipboardText, undefined)
})

test('saved switches on: the same request reads every source once', async () => {
  const invoke = installHandler(ALL_ON)

  const result = await invoke(undefined, REQUEST_ALL)

  const state = captureState()
  assert.equal(state.activeWindowCaptures, 1)
  assert.equal(state.screenshotCaptures, 1)
  assert.equal(state.clipboardReads, 1)
  assert.equal(result.activeWindowTitle, 'Synthetic Editor')
  assert.equal(result.screenshotDataUrl, 'data:image/png;base64,c3ludGhldGlj')
  assert.equal(result.clipboardText, 'synthetic clipboard text')
})

test('saved switches on: only the switch the renderer turns off is skipped', async () => {
  const invoke = installHandler(ALL_ON)

  await invoke(undefined, {
    ...REQUEST_ALL,
    policy: { activeWindow: true, clipboard: false, screenshot: true },
  })
  let state = captureState()
  assert.equal(state.clipboardReads, 0)
  assert.equal(state.activeWindowCaptures, 1)
  assert.equal(state.screenshotCaptures, 1)

  installHandler(ALL_ON)
  await invoke(undefined, {
    ...REQUEST_ALL,
    policy: { activeWindow: false, clipboard: true, screenshot: true },
  })
  state = captureState()
  assert.equal(state.activeWindowCaptures, 0)
  assert.equal(state.clipboardReads, 1)
  assert.equal(state.screenshotCaptures, 1)

  installHandler(ALL_ON)
  await invoke(undefined, {
    ...REQUEST_ALL,
    policy: { activeWindow: true, clipboard: true, screenshot: false },
  })
  state = captureState()
  assert.equal(state.screenshotCaptures, 0)
  assert.equal(state.activeWindowCaptures, 1)
  assert.equal(state.clipboardReads, 1)
})

test('saved switches off: omitting the renderer policy grants nothing', async () => {
  const invoke = installHandler({ activeWindow: false, clipboard: false, screenshot: false })

  const result = await invoke(undefined, {
    includeActiveWindow: true,
    includeClipboard: true,
    includeScreenshot: true,
  })

  const state = captureState()
  assert.equal(state.activeWindowCaptures, 0)
  assert.equal(state.screenshotCaptures, 0)
  assert.equal(state.clipboardReads, 0)
  assert.equal(result.activeWindowTitle, undefined)
  assert.equal(result.screenshotDataUrl, undefined)
  assert.equal(result.clipboardText, undefined)
})
