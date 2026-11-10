import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

const {
  ensureMacMicrophonePermission,
  ensureMacScreenPermission,
} = await import('../electron/services/macPermissions.js')
const { ensureWindowsMicrophonePermission } = await import('../electron/services/windowsPermissions.js')

function createDeps(kind: string, response = 0, openError: Error | null = null) {
  const calls: Array<{ type: string, value?: string }> = []
  return {
    calls,
    platform: kind === 'windows' ? 'win32' : 'darwin',
    systemPreferences: {
      getMediaAccessStatus() {
        return 'denied'
      },
      async askForMediaAccess() {
        calls.push({ type: 'ask' })
        return false
      },
    },
    dialog: {
      async showMessageBox() {
        calls.push({ type: 'dialog' })
        return { response }
      },
    },
    shell: {
      async openExternal(url: string) {
        calls.push({ type: 'open', value: url })
        if (openError) throw openError
      },
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('macOS microphone open-settings uses the microphone privacy URL without prompting', async () => {
  const deps = createDeps('mac')
  assert.equal(await ensureMacMicrophonePermission({ interactive: true, deps }), 'denied')
  await flush()

  assert.deepEqual(deps.calls.filter((call) => call.type === 'ask'), [])
  assert.deepEqual(deps.calls.filter((call) => call.type === 'open'), [{
    type: 'open',
    value: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  }])
})

test('macOS screen recording open-settings uses the screen-capture privacy URL', async () => {
  const deps = createDeps('mac')
  assert.equal(await ensureMacScreenPermission({ interactive: true, deps }), 'denied')
  await flush()

  assert.deepEqual(deps.calls.filter((call) => call.type === 'open'), [{
    type: 'open',
    value: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  }])
})

test('Windows microphone open-settings uses ms-settings without prompting', async () => {
  const deps = createDeps('windows')
  assert.equal(await ensureWindowsMicrophonePermission({ interactive: true, deps }), 'denied')
  await flush()

  assert.deepEqual(deps.calls.filter((call) => call.type === 'ask'), [])
  assert.deepEqual(deps.calls.filter((call) => call.type === 'open'), [{
    type: 'open',
    value: 'ms-settings:privacy-microphone',
  }])
})

test('open-settings failure logs neither a URL nor a secret', async (t) => {
  const warns = t.mock.method(console, 'warn', () => undefined)
  const secret = 'sk-test-SECRET-123'
  const failure = new Error(`failed https://evil.example/path?token=${secret}`)

  for (const [label, run] of [
    ['mac-mic', () => ensureMacMicrophonePermission({ interactive: true, deps: createDeps('mac', 0, failure) })],
    ['mac-screen', () => ensureMacScreenPermission({ interactive: true, deps: createDeps('mac', 0, failure) })],
    ['windows-mic', () => ensureWindowsMicrophonePermission({ interactive: true, deps: createDeps('windows', 0, failure) })],
  ] as const) {
    await run()
    await flush()
    const text = warns.mock.calls.map((call) => call.arguments.map(String).join(' ')).join('\n')
    assert.doesNotMatch(text, /evil\.example|sk-test-SECRET-123/, label)
    assert.doesNotMatch(text, /x-apple\.systempreferences|ms-settings/, label)
  }
})
