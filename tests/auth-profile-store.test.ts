import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AuthProfileStore,
} from '../src/core/routing/AuthProfileStore.ts'
import {
  loadAuthProfileSnapshot,
  persistAuthProfileSnapshot,
} from '../src/lib/storage/authProfiles.ts'
import { AUTH_PROFILES_STORAGE_KEY } from '../src/lib/storage/core.ts'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string) {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

function installStorage() {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: new MemoryStorage(),
    },
    configurable: true,
    writable: true,
  })
}

test('AuthProfileStore returns immutable snapshots from register get list and pickNextActive', () => {
  const store = new AuthProfileStore()

  const created = store.register({
    id: ' deepseek-a ',
    providerId: ' deepseek ',
    apiKey: ' key-a ',
    label: ' A ',
  })
  created.apiKey = 'caller mutation'

  const listed = store.list('deepseek')
  listed[0].apiKey = 'list mutation'

  const picked = store.pickNextActive('deepseek', 1_000)
  assert.ok(picked)
  picked.apiKey = 'picked mutation'

  const stored = store.get('deepseek-a')
  assert.equal(stored?.providerId, 'deepseek')
  assert.equal(stored?.apiKey, 'key-a')
  assert.equal(stored?.label, 'A')
  assert.equal(stored?.lastUsedAt, 1_000)
})

test('AuthProfileStore restore filters malformed profiles and normalizes counters', () => {
  const store = new AuthProfileStore()
  const futureCooldown = Date.now() + 60_000
  store.restore({
    profiles: [
      {
        id: ' valid ',
        providerId: ' deepseek ',
        apiKey: ' stored-key ',
        label: ' Stored ',
        status: 'cooldown',
        cooldownUntil: futureCooldown,
        lastUsedAt: Number.NaN,
        successCount: 2.9,
        failureCount: -1,
      },
      {
        id: 'bad-key',
        providerId: 'deepseek',
        apiKey: '   ',
        status: 'active',
        successCount: 0,
        failureCount: 0,
      },
      {
        id: 'bad-status',
        providerId: 'deepseek',
        apiKey: 'key',
        status: 'unknown' as never,
        successCount: Number.NaN,
        failureCount: 1.8,
      },
      {
        id: 'bad-header',
        providerId: 'minimax-coding',
        apiKey: 'key 模型说明',
        status: 'active',
        successCount: 0,
        failureCount: 0,
      },
      {
        id: 'valid',
        providerId: 'deepseek',
        apiKey: 'duplicate',
        status: 'active',
        successCount: 0,
        failureCount: 0,
      },
    ],
  })

  assert.deepEqual(store.snapshot().profiles, [
    {
      id: 'valid',
      providerId: 'deepseek',
      apiKey: 'stored-key',
      label: 'Stored',
      status: 'cooldown',
      cooldownUntil: futureCooldown,
      successCount: 2,
      failureCount: 0,
    },
    {
      id: 'bad-status',
      providerId: 'deepseek',
      apiKey: 'key',
      status: 'active',
      successCount: 0,
      failureCount: 1,
    },
  ])
})

test('AuthProfileStore list revives expired cooldown profiles', () => {
  const store = new AuthProfileStore()
  const now = Date.now()
  store.restore({
    profiles: [
      {
        id: 'expired',
        providerId: 'deepseek',
        apiKey: 'expired-key',
        status: 'cooldown',
        cooldownUntil: now - 1,
        successCount: 0,
        failureCount: 1,
      },
      {
        id: 'future',
        providerId: 'deepseek',
        apiKey: 'future-key',
        status: 'cooldown',
        cooldownUntil: now + 60_000,
        successCount: 0,
        failureCount: 1,
      },
    ],
  })

  const profiles = store.list('deepseek')

  assert.equal(profiles.find((profile) => profile.id === 'expired')?.status, 'active')
  assert.equal(profiles.find((profile) => profile.id === 'expired')?.cooldownUntil, undefined)
  assert.equal(profiles.find((profile) => profile.id === 'future')?.status, 'cooldown')
})

test('AuthProfileStore register rejects unusable credentials before they enter failover', () => {
  const store = new AuthProfileStore()

  const invalidKeys = [
    { apiKey: '   ', message: /non-empty/ },
    { apiKey: 'test-key 模型说明', message: /cannot be sent in an HTTP header/ },
    { apiKey: 'test-key\nnext', message: /cannot be sent in an HTTP header/ },
    { apiKey: 'test key', message: /cannot be sent in an HTTP header/ },
  ]

  invalidKeys.forEach(({ apiKey, message }, index) => {
    assert.throws(() => store.register({
      id: `bad-key-${index}`,
      providerId: 'deepseek',
      apiKey,
    }), message)
  })

  assert.deepEqual(store.list(), [])
})

test('auth profile storage validates corrupt persisted snapshots', () => {
  installStorage()
  window.localStorage.setItem(AUTH_PROFILES_STORAGE_KEY, JSON.stringify({
    profiles: [
      {
        id: 'stored',
        providerId: 'deepseek',
        apiKey: ' stored-key ',
        status: 'failed',
        successCount: 1,
        failureCount: 2,
      },
      { id: 'bad', providerId: 'deepseek', apiKey: '', status: 'active' },
      { id: 'bad-header', providerId: 'minimax-coding', apiKey: 'key 套餐说明', status: 'active' },
      null,
    ],
  }))

  assert.deepEqual(loadAuthProfileSnapshot(), {
    profiles: [{
      id: 'stored',
      providerId: 'deepseek',
      apiKey: 'stored-key',
      status: 'failed',
      successCount: 1,
      failureCount: 2,
    }],
  })
  assert.deepEqual(JSON.parse(window.localStorage.getItem(AUTH_PROFILES_STORAGE_KEY) ?? '{}'), {
    profiles: [{
      id: 'stored',
      providerId: 'deepseek',
      apiKey: 'stored-key',
      status: 'failed',
      successCount: 1,
      failureCount: 2,
    }],
  })

  persistAuthProfileSnapshot({
    profiles: [{
      id: ' next ',
      providerId: ' deepseek ',
      apiKey: ' next-key ',
      status: 'active',
      successCount: 0,
      failureCount: 0,
    }],
  })

  assert.deepEqual(JSON.parse(window.localStorage.getItem(AUTH_PROFILES_STORAGE_KEY) ?? '{}'), {
    profiles: [{
      id: 'next',
      providerId: 'deepseek',
      apiKey: 'next-key',
      status: 'active',
      successCount: 0,
      failureCount: 0,
    }],
  })
})
