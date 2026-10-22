import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { register } from 'node:module'
import { test } from 'node:test'

register(new URL('./helpers/mcp-host-hooks.mjs', import.meta.url))

type SpawnRecord = {
  command: string
  args: string[]
  options: { env?: Record<string, string> }
}

const PARENT_SECRET_NAMES = [
  'NEXUS_TEST_PARENT_SECRET',
  'AWS_SECRET_ACCESS_KEY',
  'NEXUS_TEST_API_KEY',
] as const

const ALLOWED_PARENT_NAMES = ['LANG', 'TZ'] as const

/**
 * Plant parent variables so the child environment is deterministic: two
 * allowlisted names that must survive and three secret-looking names that
 * must not.
 */
function plantParentEnv(): () => void {
  const previous = new Map<string, string | undefined>()
  const set = (name: string, value: string) => {
    previous.set(name, process.env[name])
    process.env[name] = value
  }
  for (const name of ALLOWED_PARENT_NAMES) set(name, 'test-locale')
  for (const name of PARENT_SECRET_NAMES) set(name, 'parent-secret-value')
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('an MCP child gets the allowlisted parent variables and its own server env', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-env-'))
  const spawns: SpawnRecord[] = []
  const restoreEnv = plantParentEnv()
  globalThis.__nexusMcpTestUserData = userDataPath
  globalThis.__nexusMcpTestSpawn = spawns
  try {
    const { syncFromSettings } = await import('../electron/services/mcpHost.js')
    await syncFromSettings([{
      id: 'srv-env',
      command: 'node',
      args: '--serve',
      enabled: true,
      env: {
        MY_SERVER_TOKEN: 'server-token',
        'BAD NAME': 'nope',
        NOT_A_STRING: 42,
        LONG_SERVER_VALUE: 'x'.repeat(9000),
      },
    }])

    assert.equal(spawns.length, 1)
    const env = spawns[0].options.env ?? {}

    // The server's own variables reach the child, cleaned up.
    assert.equal(env.MY_SERVER_TOKEN, 'server-token')
    assert.equal('BAD NAME' in env, false)
    assert.equal('NOT_A_STRING' in env, false)
    assert.equal(env.LONG_SERVER_VALUE.length, 8192)

    // The allowlisted parent variables reach the child.
    for (const name of ALLOWED_PARENT_NAMES) {
      assert.equal(env[name], 'test-locale', name)
    }

    // Every other parent variable stays out.
    for (const name of PARENT_SECRET_NAMES) {
      assert.equal(name in env, false, name)
    }
  } finally {
    restoreEnv()
    delete globalThis.__nexusMcpTestUserData
    delete globalThis.__nexusMcpTestSpawn
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})

test('an MCP child receives proxy and custom-CA variables in both cases', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-env-'))
  const spawns: SpawnRecord[] = []
  const previous = new Map<string, string | undefined>()
  const set = (name: string, value: string) => {
    previous.set(name, process.env[name])
    process.env[name] = value
  }
  set('http_proxy', 'http://proxy.example:8080')
  set('HTTPS_PROXY', 'https://proxy.example:8443')
  set('NO_PROXY', 'localhost,127.0.0.1')
  set('all_proxy', 'socks5://proxy.example:1080')
  set('NODE_EXTRA_CA_CERTS', '/etc/ssl/corp.pem')
  set('SSL_CERT_FILE', '/etc/ssl/cert.pem')
  set('AWS_SECRET_ACCESS_KEY', 'parent-secret-value')
  globalThis.__nexusMcpTestUserData = userDataPath
  globalThis.__nexusMcpTestSpawn = spawns
  try {
    const { syncFromSettings } = await import('../electron/services/mcpHost.js')
    await syncFromSettings([{
      id: 'srv-proxy',
      command: 'node',
      args: '--serve',
      enabled: true,
    }])

    assert.equal(spawns.length, 1)
    const env = spawns[0].options.env ?? {}
    const expectBoth = (name: string, value: string) => {
      assert.equal(env[name], value, name)
      assert.equal(env[name.toLowerCase()], value, name.toLowerCase())
    }
    expectBoth('HTTP_PROXY', 'http://proxy.example:8080')
    expectBoth('HTTPS_PROXY', 'https://proxy.example:8443')
    expectBoth('NO_PROXY', 'localhost,127.0.0.1')
    expectBoth('ALL_PROXY', 'socks5://proxy.example:1080')
    expectBoth('NODE_EXTRA_CA_CERTS', '/etc/ssl/corp.pem')
    expectBoth('SSL_CERT_FILE', '/etc/ssl/cert.pem')
    assert.equal('AWS_SECRET_ACCESS_KEY' in env, false)
    assert.equal('aws_secret_access_key' in env, false)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    delete globalThis.__nexusMcpTestUserData
    delete globalThis.__nexusMcpTestSpawn
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})

test('an MCP server without an env still gets only the allowlisted parent variables', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mcp-env-'))
  const spawns: SpawnRecord[] = []
  const restoreEnv = plantParentEnv()
  globalThis.__nexusMcpTestUserData = userDataPath
  globalThis.__nexusMcpTestSpawn = spawns
  try {
    const { syncFromSettings } = await import('../electron/services/mcpHost.js')
    await syncFromSettings([{
      id: 'srv-plain',
      command: 'node',
      args: '--serve',
      enabled: true,
    }])

    assert.equal(spawns.length, 1)
    const env = spawns[0].options.env ?? {}
    for (const name of ALLOWED_PARENT_NAMES) {
      assert.equal(env[name], 'test-locale', name)
    }
    for (const name of PARENT_SECRET_NAMES) {
      assert.equal(name in env, false, name)
    }
    assert.equal(Object.keys(env).some((key) => key.startsWith('NEXUS_TEST_')), false)
  } finally {
    restoreEnv()
    delete globalThis.__nexusMcpTestUserData
    delete globalThis.__nexusMcpTestSpawn
    await fs.rm(userDataPath, { recursive: true, force: true })
  }
})
