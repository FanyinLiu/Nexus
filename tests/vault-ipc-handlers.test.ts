import assert from 'node:assert/strict'
import { register } from 'node:module'
import { beforeEach, test } from 'node:test'

register(new URL('./helpers/vault-ipc-stub-hooks.mjs', import.meta.url))

const vaultIpc = await import('../electron/ipc/vaultIpc.js')

const NOW = 1_800_000_000_000
// Synthetic values only. The distinctive shape makes a leaked value easy to
// spot in captured audit/console text without resembling a real credential.
const SYNTHETIC_SECRET = 'SYNTHETIC_VAULT_SECRET_7f3a9c'
const SYNTHETIC_BULK_SECRET = 'SYNTHETIC_VAULT_SECRET_bulk_41d2'
const SLOT = 'settings:syntheticApiKey'
const BULK_SLOT = 'settings:syntheticBulkToken'

type Handler = (event: unknown, payload?: unknown) => unknown

type AuditEntry = {
  category: string
  action: string
  details?: Record<string, unknown>
}

type VaultCalls = {
  store: Array<{ slot: string; plaintext: string }>
  delete: string[]
  listSlots: number
  storeMany: Array<Record<string, string>>
  retrieveMany: string[][]
  isAvailable: number
}

type VaultIpcState = {
  handlers: Map<string, Handler>
  auditEntries: AuditEntry[]
  vault: Map<string, string>
  calls: VaultCalls
}

function freshState(): VaultIpcState {
  return {
    handlers: new Map(),
    auditEntries: [],
    vault: new Map(),
    calls: {
      store: [],
      delete: [],
      listSlots: 0,
      storeMany: [],
      retrieveMany: [],
      isAvailable: 0,
    },
  }
}

function emptyCalls(): VaultCalls {
  return {
    store: [],
    delete: [],
    listSlots: 0,
    storeMany: [],
    retrieveMany: [],
    isAvailable: 0,
  }
}

function state(): VaultIpcState {
  const value = (globalThis as { __nexusTestVaultIpc?: VaultIpcState }).__nexusTestVaultIpc
  assert.ok(value, 'vault IPC test harness state missing')
  return value
}

function trustedEvent(senderId = 1) {
  return { trusted: true, sender: { id: senderId } }
}

function untrustedEvent(senderId = 2) {
  return { trusted: false, sender: { id: senderId } }
}

async function invoke(channel: string, event: unknown, payload?: unknown): Promise<unknown> {
  const handler = state().handlers.get(channel)
  assert.ok(handler, `missing handler for ${channel}`)
  return await handler(event, payload)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function captureConsole() {
  const lines: string[] = []
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  }
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : safeStringify(arg))).join(' '))
  }
  console.log = capture
  console.warn = capture
  console.error = capture
  console.info = capture
  console.debug = capture
  return {
    lines,
    restore: () => {
      console.log = original.log
      console.warn = original.warn
      console.error = original.error
      console.info = original.info
      console.debug = original.debug
    },
  }
}

async function storeSyntheticSecret(event: unknown) {
  await invoke('vault:store', event, { slot: SLOT, plaintext: SYNTHETIC_SECRET })
}

beforeEach(() => {
  const globalState = globalThis as { __nexusTestVaultIpc?: VaultIpcState }
  globalState.__nexusTestVaultIpc = freshState()
  vaultIpc.register()
})

test('vault IPC roundtrip stores, lists, retrieves refs and deletes through the backend', async () => {
  const event = trustedEvent()

  assert.equal(await invoke('vault:is-available', event), true)

  assert.equal(await invoke('vault:store', event, { slot: SLOT, plaintext: SYNTHETIC_SECRET }), undefined)
  assert.equal(state().vault.get(SLOT), SYNTHETIC_SECRET)
  assert.deepEqual(state().calls.store, [{ slot: SLOT, plaintext: SYNTHETIC_SECRET }])

  assert.deepEqual(await invoke('vault:list-slots', event), [SLOT])

  const ref = await invoke('vault:retrieve', event, { slot: SLOT })
  assert.equal(typeof ref, 'string')
  assert.match(ref as string, /^nexus-vault-ref:/)
  assert.notEqual(ref, SYNTHETIC_SECRET)
  assert.ok(!(ref as string).includes(SYNTHETIC_SECRET))

  await invoke('vault:store-many', event, {
    entries: [
      { slot: BULK_SLOT, plaintext: SYNTHETIC_BULK_SECRET },
      { slot: 'settings:syntheticEmptySlot', plaintext: '' },
    ],
  })
  assert.deepEqual(state().calls.storeMany, [{
    [BULK_SLOT]: SYNTHETIC_BULK_SECRET,
    'settings:syntheticEmptySlot': '',
  }])
  assert.deepEqual(
    (await invoke('vault:list-slots', event) as string[]).sort(),
    [SLOT, BULK_SLOT].sort(),
  )

  const refs = await invoke('vault:retrieve-many', event, { slots: [SLOT, BULK_SLOT] }) as Record<string, string>
  assert.deepEqual(Object.keys(refs).sort(), [SLOT, BULK_SLOT].sort())
  for (const issuedRef of Object.values(refs)) {
    assert.match(issuedRef, /^nexus-vault-ref:/)
    assert.ok(!issuedRef.includes(SYNTHETIC_SECRET))
    assert.ok(!issuedRef.includes(SYNTHETIC_BULK_SECRET))
  }

  await invoke('vault:delete', event, { slot: SLOT })
  assert.equal(state().vault.has(SLOT), false)
  assert.deepEqual(await invoke('vault:list-slots', event), [BULK_SLOT])
})

test('untrusted senders are rejected before any backend access or audit entry', async () => {
  const event = untrustedEvent()
  const calls: Array<[string, unknown]> = [
    ['vault:is-available', undefined],
    ['vault:store', { slot: SLOT, plaintext: SYNTHETIC_SECRET }],
    ['vault:retrieve', { slot: SLOT }],
    ['vault:delete', { slot: SLOT }],
    ['vault:list-slots', undefined],
    ['vault:store-many', { entries: [{ slot: BULK_SLOT, plaintext: SYNTHETIC_BULK_SECRET }] }],
    ['vault:retrieve-many', { slots: [SLOT, BULK_SLOT] }],
  ]

  for (const [channel, payload] of calls) {
    await assert.rejects(
      () => invoke(channel, event, payload),
      /IPC rejected/,
      `${channel} must reject an untrusted sender`,
    )
  }

  assert.deepEqual(state().calls, emptyCalls())
  assert.deepEqual(state().auditEntries, [])
  assert.deepEqual([...state().vault.keys()], [])
})

test('bulk handlers reject more than six operations per sender in the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })

  const cases: Array<[string, unknown, number]> = [
    ['vault:list-slots', undefined, 11],
    ['vault:retrieve-many', { slots: [SLOT] }, 12],
  ]

  for (const [channel, payload, senderId] of cases) {
    const event = trustedEvent(senderId)
    for (let index = 0; index < 6; index += 1) {
      await invoke(channel, event, payload)
    }
    await assert.rejects(
      () => invoke(channel, event, payload),
      /rate-limited/,
      `${channel} must reject the seventh bulk call`,
    )
  }
})

test('single retrieve rejects more than three reads per sender in the window', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const event = trustedEvent(21)

  for (let index = 0; index < 3; index += 1) {
    await invoke('vault:retrieve', event, { slot: SLOT })
  }

  await assert.rejects(
    () => invoke('vault:retrieve', event, { slot: SLOT }),
    /rate-limited/,
    'the fourth single retrieve must be rejected',
  )
})

test('vault audit entries and console output never contain stored secret values', async () => {
  const event = trustedEvent(31)
  const captured = captureConsole()

  try {
    await storeSyntheticSecret(event)
    await invoke('vault:store-many', event, {
      entries: [{ slot: BULK_SLOT, plaintext: SYNTHETIC_BULK_SECRET }],
    })
    await invoke('vault:retrieve', event, { slot: SLOT })
    await invoke('vault:retrieve-many', event, { slots: [SLOT, BULK_SLOT] })
    await invoke('vault:delete', event, { slot: SLOT })
    await invoke('vault:list-slots', event)
  } finally {
    captured.restore()
  }

  const auditText = safeStringify(state().auditEntries)
  const consoleText = captured.lines.join('\n')
  for (const secret of [SYNTHETIC_SECRET, SYNTHETIC_BULK_SECRET]) {
    assert.ok(!auditText.includes(secret), 'audit entries must not contain the stored secret')
    assert.ok(!consoleText.includes(secret), 'console output must not contain the stored secret')
  }

  // Keep the leak assertions honest: the operations really were audited.
  assert.ok(state().auditEntries.some(
    (entry) => entry.action === 'request' && entry.details?.channel === 'vault:store',
  ))
  assert.ok(state().auditEntries.some(
    (entry) => entry.action === 'result' && entry.details?.channel === 'vault:retrieve-many',
  ))
})

test('invalid vault payloads are rejected before the backend is touched', async () => {
  const event = trustedEvent(41)

  await assert.rejects(
    () => invoke('vault:store', event, { slot: '../escape', plaintext: SYNTHETIC_SECRET }),
    /invalid format/,
  )
  await assert.rejects(
    () => invoke('vault:retrieve-many', event, { slots: ['bad slot'] }),
    /invalid format/,
  )

  assert.deepEqual(state().calls, emptyCalls())
  assert.deepEqual(state().auditEntries, [])
})
