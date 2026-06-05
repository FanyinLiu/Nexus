import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  buildMessageWebhookPayload,
  getDefaultTokenFileCandidates,
  normalizeWebhookToken,
  parseMessageWebhookArgs,
  postMessageWebhookPayload,
  readWebhookToken,
} from '../scripts/send-message-webhook.mjs'
import {
  extractStringsFromBlobHex,
  filterNewNotificationMessages,
  parseMacNotificationWatchArgs,
} from '../scripts/communication-adapters/macos-notification-center-watch.mjs'

const execFileAsync = promisify(execFile)

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-message-webhook-cli-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('message webhook cli parses common automation arguments', () => {
  const options = parseMessageWebhookArgs([
    '--app',
    '微信',
    '--from=张三',
    '--chat-title',
    '项目群',
    '--conversation-id',
    'room-1',
    '--message-id',
    'msg-1',
    '--text',
    '晚上同步一下',
  ])

  assert.equal(options.source, '微信')
  assert.equal(options.sender, '张三')
  assert.equal(options.chatTitle, '项目群')
  assert.equal(options.conversationId, 'room-1')
  assert.equal(options.messageId, 'msg-1')
  assert.equal(options.text, '晚上同步一下')
})

test('message webhook cli builds a normalized message payload', () => {
  const payload = buildMessageWebhookPayload(
    {
      source: ' 企业微信 ',
      sender: ' 李四 ',
      chatTitle: ' 发布群 ',
      conversationId: ' room-2 ',
      messageId: '',
      text: '  看一下\n发布清单 ',
    },
    { now: new Date('2026-06-05T12:00:00Z') },
  )

  assert.deepEqual(payload, {
    kind: 'message',
    source: '企业微信',
    sender: '李四',
    chatTitle: '发布群',
    conversationId: 'room-2',
    messageId: '企业微信:1780660800000',
    text: '看一下 发布清单',
  })
})

test('message webhook cli reads bearer tokens from an explicit token file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const tokenPath = path.join(directoryPath, 'token.txt')
    await fs.writeFile(tokenPath, 'Bearer nexus_test_token\n')

    assert.equal(normalizeWebhookToken('Bearer nexus_inline'), 'nexus_inline')
    assert.equal(await readWebhookToken({ tokenFile: tokenPath }), 'nexus_test_token')
  })
})

test('message webhook cli resolves default token candidates for each platform', () => {
  const macCandidates = getDefaultTokenFileCandidates({
    platform: 'darwin',
    home: '/Users/test',
    env: {},
  })
  const winCandidates = getDefaultTokenFileCandidates({
    platform: 'win32',
    home: 'C:\\Users\\test',
    env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
  })

  assert.ok(macCandidates.some((candidate) => candidate.includes(path.join(
    'Library',
    'Application Support',
    'Nexus',
    'notification-webhook-token.txt',
  ))))
  assert.ok(winCandidates.some((candidate) => candidate.includes('Nexus')))
})

test('message webhook cli post helper sends bearer auth and JSON payload', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const result = await postMessageWebhookPayload(
    { kind: 'message', source: 'QQ', text: 'hi' },
    {
      url: 'http://127.0.0.1:47830/webhook',
      token: 'Bearer nexus_token',
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ ok: true, id: 'abc' }), { status: 200 })
      },
    },
  )

  assert.deepEqual(result, { ok: true, id: 'abc' })
  assert.equal(calls[0]?.url, 'http://127.0.0.1:47830/webhook')
  assert.equal(calls[0]?.init.headers?.['Authorization' as keyof HeadersInit], 'Bearer nexus_token')
  assert.equal(JSON.parse(String(calls[0]?.init.body)).source, 'QQ')
})

test('message webhook cli --dry-run emits a machine-readable payload', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/send-message-webhook.mjs',
    '--source',
    '微信',
    '--sender',
    '张三',
    '--chat-title',
    '项目群',
    '--message-id',
    'msg-2',
    '--text',
    '晚上同步一下',
    '--dry-run',
  ], { cwd: process.cwd() })

  const payload = JSON.parse(stdout)
  assert.equal(payload.kind, 'message')
  assert.equal(payload.source, '微信')
  assert.equal(payload.sender, '张三')
  assert.equal(payload.chatTitle, '项目群')
  assert.equal(payload.messageId, 'msg-2')
  assert.equal(payload.text, '晚上同步一下')
})

test('macOS shortcuts adapter forwards arguments to the message webhook cli', async () => {
  const { stdout } = await execFileAsync('bash', [
    'scripts/communication-adapters/macos-shortcuts-message.sh',
    '--source',
    '微信',
    '--sender',
    '张三',
    '--chat-title',
    '项目群',
    '--conversation-id',
    'room-3',
    '--message-id',
    'msg-3',
    '--text',
    '稍后开会',
    '--dry-run',
  ], { cwd: process.cwd() })

  const payload = JSON.parse(stdout)
  assert.equal(payload.kind, 'message')
  assert.equal(payload.source, '微信')
  assert.equal(payload.sender, '张三')
  assert.equal(payload.chatTitle, '项目群')
  assert.equal(payload.conversationId, 'room-3')
  assert.equal(payload.messageId, 'msg-3')
  assert.equal(payload.text, '稍后开会')
})

test('macOS notification center watcher parses watch options', () => {
  const options = parseMacNotificationWatchArgs([
    '--db',
    '/tmp/notifications.db',
    '--apps=微信|Telegram',
    '--poll-ms',
    '1500',
    '--limit',
    '20',
    '--once',
    '--dry-run',
  ])

  assert.equal(options.db, '/tmp/notifications.db')
  assert.equal(options.apps, '微信|Telegram')
  assert.equal(options.pollMs, 1500)
  assert.equal(options.limit, 20)
  assert.equal(options.once, true)
  assert.equal(options.dryRun, true)
})

test('macOS notification center watcher extracts message strings from blob data', () => {
  const utf8Hex = Buffer.from('Telegram\0Alice\0hello', 'utf8').toString('hex')
  const utf16Hex = Buffer.from('微信\0张三\0晚上同步一下', 'utf16le').toString('hex')

  assert.ok(extractStringsFromBlobHex(utf8Hex).some((value) => value.includes('Telegram')))
  assert.ok(extractStringsFromBlobHex(utf16Hex).some((value) => value.includes('晚上同步一下')))
})

test('macOS notification center watcher filters and normalizes chat notifications', () => {
  const messages = filterNewNotificationMessages([
    {
      __rowid: 2,
      id: 'noise-1',
      source: 'com.apple.Safari',
      title: 'News',
      subtitle: '',
      body: 'not a chat message',
    },
    {
      __rowid: 1,
      id: 'wx-1',
      source: 'com.tencent.xinWeChat',
      title: '项目群',
      subtitle: '张三',
      body: '晚上同步一下',
    },
  ], {
    pattern: '微信|WeChat|com.tencent',
    seenKeys: new Set(['com.tencent.xinWeChat:old']),
  })

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.source, 'com.tencent.xinWeChat')
  assert.equal(messages[0]?.sender, '张三')
  assert.equal(messages[0]?.chatTitle, '项目群')
  assert.equal(messages[0]?.text, '晚上同步一下')
  assert.equal(messages[0]?.conversationId, 'com.tencent.xinWeChat:项目群')
  assert.equal(messages[0]?.messageId, 'com.tencent.xinWeChat:wx-1')
})

test('macOS notification center watcher dry-runs one poll and persists dedupe state', async () => {
  await withTempDirectory(async (directoryPath) => {
    const fakeSqlitePath = path.join(directoryPath, 'fake-sqlite.mjs')
    const stateFile = path.join(directoryPath, 'seen.json')
    const dbPath = path.join(directoryPath, 'notifications.db')

    await fs.writeFile(fakeSqlitePath, [
      '#!/usr/bin/env node',
      "const sql = process.argv.at(-1) || ''",
      "if (sql.includes('sqlite_master')) {",
      "  console.log(JSON.stringify([{ name: 'notifications' }]))",
      "} else if (sql.includes('PRAGMA table_info')) {",
      "  console.log(JSON.stringify(['id', 'source', 'title', 'subtitle', 'body', 'delivered_at'].map((name, cid) => ({ cid, name }))))",
      '} else {',
      '  console.log(JSON.stringify([',
      "    { __rowid: 2, id: 'noise-1', source: 'com.apple.Safari', title: 'News', subtitle: '', body: 'not a chat message', delivered_at: 1 },",
      "    { __rowid: 1, id: 'wx-1', source: 'com.tencent.xinWeChat', title: '项目群', subtitle: '张三', body: '晚上同步一下', delivered_at: 2 },",
      '  ]))',
      '}',
      '',
    ].join('\n'))
    await fs.chmod(fakeSqlitePath, 0o755)
    await fs.writeFile(dbPath, '')

    const args = [
      'scripts/communication-adapters/macos-notification-center-watch.mjs',
      '--db',
      dbPath,
      '--sqlite',
      fakeSqlitePath,
      '--state-file',
      stateFile,
      '--apps',
      '微信|WeChat|com.tencent',
      '--once',
      '--dry-run',
    ]

    const firstRun = await execFileAsync(process.execPath, args, { cwd: process.cwd() })
    const firstPayloads = firstRun.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

    assert.equal(firstPayloads.length, 1)
    assert.equal(firstPayloads[0].kind, 'message')
    assert.equal(firstPayloads[0].source, 'com.tencent.xinWeChat')
    assert.equal(firstPayloads[0].sender, '张三')
    assert.equal(firstPayloads[0].chatTitle, '项目群')
    assert.equal(firstPayloads[0].text, '晚上同步一下')

    const secondRun = await execFileAsync(process.execPath, args, { cwd: process.cwd() })
    assert.equal(secondRun.stdout.trim(), '')

    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    assert.ok(state.seen.includes('com.tencent.xinWeChat:wx-1'))
  })
})

test('package config ships message webhook cli and adapters', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>
    build?: {
      files?: string[]
      asarUnpack?: string[]
    }
  }

  assert.equal(pkg.scripts?.['message:send'], 'node scripts/send-message-webhook.mjs')
  assert.ok(pkg.build?.files?.includes('scripts/send-message-webhook.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/communication-adapters/**/*'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/send-message-webhook.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/communication-adapters/**/*'))
})
