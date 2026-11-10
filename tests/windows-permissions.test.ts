import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

const {
  ensureWindowsMicrophonePermission,
  runWindowsPermissionChecks,
} = await import('../electron/services/windowsPermissions.js')
const { createMediaPermissionLifecycle } = await import('../electron/services/mediaPermissionLifecycle.js')
const { translateMainMessage } = await import('../electron/mainMessages.js')

type Call = { type: 'status' | 'dialog' | 'open', kind?: string }

function createWindowsDeps(statuses: Record<string, string>, dialogResponse = 1) {
  const calls: Call[] = []
  const dialogButtons: string[][] = []
  return {
    calls,
    dialogButtons,
    platform: 'win32',
    systemPreferences: {
      getMediaAccessStatus(kind: string) {
        calls.push({ type: 'status', kind })
        return statuses[kind] ?? 'not-determined'
      },
      async askForMediaAccess() {
        throw new Error('Windows must never call askForMediaAccess')
      },
    },
    dialog: {
      async showMessageBox(options: { buttons?: string[] }) {
        calls.push({ type: 'dialog' })
        dialogButtons.push(options.buttons ?? [])
        return { response: dialogResponse, buttons: options.buttons }
      },
    },
    shell: {
      async openExternal(url: string) {
        calls.push({ type: 'open', kind: url })
      },
    },
  }
}

test('Windows denied microphone uses Windows copy and the privacy-microphone URL', async () => {
  const deps = createWindowsDeps({ microphone: 'denied' }, 0)

  const status = await ensureWindowsMicrophonePermission({
    interactive: true,
    deps,
  })

  assert.equal(status, 'denied')
  const dialog = deps.calls.find((call) => call.type === 'dialog')
  assert.ok(dialog)
  assert.equal(deps.dialogButtons[0]?.[0], translateMainMessage('permission.windows.openSettings', undefined, 'en-US'))
  assert.equal(deps.calls.filter((call) => call.type === 'open').length, 1)
  assert.deepEqual(deps.calls.at(-1), {
    type: 'open',
    kind: 'ms-settings:privacy-microphone',
  })
})

test('Windows dialog button is the Windows Settings key in every locale', async () => {
  const expected = {
    'zh-CN': '打开 Windows 设置',
    'zh-TW': '開啟 Windows 設定',
    'en-US': 'Open Windows Settings',
    ja: 'Windows の設定を開く',
    ko: 'Windows 설정 열기',
  } as const

  for (const [locale, button] of Object.entries(expected)) {
    assert.equal(button, translateMainMessage('permission.windows.openSettings', undefined, locale))
  }
})

test('Windows not-determined and granted paths never show a guide', async () => {
  for (const status of ['not-determined', 'granted']) {
    const deps = createWindowsDeps({ microphone: status }, 1)
    assert.equal(await ensureWindowsMicrophonePermission({ interactive: true, deps }), status)
    assert.equal(deps.calls.filter((call) => call.type === 'dialog').length, 0)
    assert.equal(deps.calls.filter((call) => call.type === 'open').length, 0)
  }
})

test('Windows denied off → on shows exactly one guide', async () => {
  const deps = createWindowsDeps({ microphone: 'denied' }, 1)
  const lifecycle = createMediaPermissionLifecycle({
    platform: 'win32',
    windowsDeps: deps,
  })

  lifecycle.observeVoiceRuntime({ settingsRevision: 1, microphoneActive: false })
  assert.equal(lifecycle.observeVoiceRuntime({ settingsRevision: 2, microphoneActive: true }), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(deps.calls.filter((call) => call.type === 'dialog').length, 1)
})

test('Windows read-only status only probes the mic when that switch is on', async () => {
  const deps = createWindowsDeps({ microphone: 'denied' }, 1)
  const lifecycle = createMediaPermissionLifecycle({
    platform: 'win32',
    windowsDeps: deps,
  })

  const off = await lifecycle.inspectReadOnly({ microphone: false, screenContextActive: true })
  assert.deepEqual(deps.calls, [])
  assert.equal(off.microphone, 'unknown')

  const on = await lifecycle.inspectReadOnly({ microphone: true, screenContextActive: false })
  assert.deepEqual(deps.calls, [{ type: 'status', kind: 'microphone' }])
  assert.equal(on.microphone, 'denied')
})

test('Windows run checks skip work when the caller did not enable the mic or platform is not win32', async () => {
  const off = createWindowsDeps({ microphone: 'denied' })
  assert.deepEqual(await runWindowsPermissionChecks({ microphone: false, deps: off }), {})
  assert.deepEqual(off.calls, [])

  const otherPlatform = { ...createWindowsDeps({ microphone: 'denied' }), platform: 'darwin' }
  assert.deepEqual(await runWindowsPermissionChecks({ microphone: true, deps: otherPlatform }), {})
  assert.deepEqual(otherPlatform.calls, [])
})
