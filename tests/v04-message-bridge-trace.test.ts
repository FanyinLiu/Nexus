import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  DEFAULT_V04_BRIDGE_TRACE_FILE,
  buildV04MessageBridgeTraceReport,
  parseV04MessageBridgeTraceArgs,
} from '../scripts/v04-message-bridge-trace.mjs'

const execFileAsync = promisify(execFile)

async function withTempDirectory(fn: (directoryPath: string) => Promise<void>) {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-bridge-trace-'))
  try {
    await fn(directoryPath)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
}

test('v0.4 message bridge trace args default to v0.4 evidence file', () => {
  assert.deepEqual(parseV04MessageBridgeTraceArgs([]), {
    help: false,
    inputPath: '',
    telegramStatusFile: '',
    discordStatusFile: '',
    outputPath: DEFAULT_V04_BRIDGE_TRACE_FILE,
    sample: false,
    requireTrace: false,
  })

  const parsed = parseV04MessageBridgeTraceArgs([
    '--input',
    'tmp/gateway-status.json',
    '--telegram-status-file=tmp/telegram.json',
    '--discord',
    'tmp/discord.json',
    '--output',
    'tmp/trace.json',
    '--sample',
    '--require-trace',
  ])

  assert.equal(parsed.inputPath, 'tmp/gateway-status.json')
  assert.equal(parsed.telegramStatusFile, 'tmp/telegram.json')
  assert.equal(parsed.discordStatusFile, 'tmp/discord.json')
  assert.equal(parsed.outputPath, 'tmp/trace.json')
  assert.equal(parsed.sample, true)
  assert.equal(parsed.requireTrace, true)
})

test('v0.4 message bridge trace sanitizes gateway diagnostics without leaking private fields', async () => {
  await withTempDirectory(async (directoryPath) => {
    const inputFile = path.join(directoryPath, 'gateway-status.json')

    await writeFile(inputFile, JSON.stringify({
      telegramStatus: {
        state: 'connected',
        botUsername: 'PrivateNexusBot',
        allowedChatIds: [123456],
        lastEventAt: '2026-06-17T20:00:00Z',
        lastEventSource: 'telegram-private-source',
        lastEventId: 'update-private-id',
        updateOffset: '501',
        lastOutboundAt: '2026-06-17T20:01:00Z',
        lastOutboundKind: 'text',
        lastOutboundTarget: 'telegram:private-chat-id',
        lastOutboundError: 'Telegram API 429 for telegram:private-chat-id',
        privateMessageText: 'private telegram body',
      },
      discordStatus: {
        state: 'connected',
        applicationId: 'private-discord-app',
        allowedChannelIds: ['private-channel-id'],
        lastEventAt: '2026-06-17T21:00:00Z',
        lastEventSource: 'discord-private-source',
        lastEventId: 'discord-private-message-id',
        lastReconnectAt: '2026-06-17T21:02:00Z',
        lastReconnectReason: 'gateway_reconnect_requested',
        reconnectAttempt: 2,
        lastOutboundAt: '2026-06-17T21:03:00Z',
        lastOutboundKind: 'audio',
        lastOutboundTarget: 'discord:private-channel-id',
        lastOutboundError: 'Discord API 403 for discord:private-channel-id',
        privateMessageText: 'private discord body',
      },
      webhookPayload: { body: 'private webhook body' },
    }), 'utf8')

    const report = await buildV04MessageBridgeTraceReport({
      inputPath: inputFile,
    }, { now: '2026-06-17T22:00:00Z' })
    const json = JSON.stringify(report)

    assert.equal(report.gate, 'nexus-v04-message-bridge-trace')
    assert.equal(report.generatedAt, '2026-06-17T22:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'trace-evidence-available')
    assert.equal(report.telegram.state, 'connected')
    assert.equal(report.telegram.lastEventAt, '2026-06-17T20:00:00.000Z')
    assert.equal(report.telegram.updateOffset, 501)
    assert.equal(report.telegram.lastOutboundAt, '2026-06-17T20:01:00.000Z')
    assert.equal(report.telegram.lastOutboundKind, 'text')
    assert.equal(report.telegram.lastOutboundTargetPresent, true)
    assert.equal(report.telegram.lastOutboundErrorPresent, true)
    assert.equal(Object.hasOwn(report.telegram, 'lastOutboundTarget'), false)
    assert.equal(Object.hasOwn(report.telegram, 'lastOutboundError'), false)
    assert.equal(report.discord.state, 'connected')
    assert.equal(report.discord.lastEventAt, '2026-06-17T21:00:00.000Z')
    assert.equal(report.discord.lastReconnectAt, '2026-06-17T21:02:00.000Z')
    assert.equal(report.discord.lastReconnectReason, 'gateway_reconnect_requested')
    assert.equal(report.discord.reconnectAttempt, 2)
    assert.equal(report.discord.lastOutboundAt, '2026-06-17T21:03:00.000Z')
    assert.equal(report.discord.lastOutboundKind, 'audio')
    assert.equal(report.discord.lastOutboundTargetPresent, true)
    assert.equal(report.discord.lastOutboundErrorPresent, true)
    assert.equal(Object.hasOwn(report.discord, 'lastOutboundTarget'), false)
    assert.equal(Object.hasOwn(report.discord, 'lastOutboundError'), false)
    assert.equal(report.privacy.artifactContentsCopied, false)
    assert.doesNotMatch(
      json,
      /PrivateNexusBot|123456|telegram-private-source|update-private-id|telegram:private-chat-id|Telegram API 429|private telegram body|private-discord-app|private-channel-id|discord-private-message-id|Discord API 403|private discord body|private webhook body/,
    )
  })
})

test('v0.4 message bridge trace CLI writes a private-safe trace file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const inputFile = path.join(directoryPath, 'gateway-status.json')
    const outputFile = path.join(directoryPath, 'message-awareness-bridge-trace.json')

    await writeFile(inputFile, JSON.stringify({
      telegram: {
        state: 'connected',
        lastEventAt: '2026-06-17T20:00:00Z',
        updateOffset: 77,
        lastOutboundTarget: 'telegram:private-chat-id',
      },
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/v04-message-bridge-trace.mjs',
      '--input',
      inputFile,
      '--output',
      outputFile,
    ], { cwd: process.cwd() })

    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputFile, 'utf8'))
    assert.equal(stdoutReport.ok, true)
    assert.equal(fileReport.gate, 'nexus-v04-message-bridge-trace')
    assert.equal(fileReport.telegram.updateOffset, 77)
    assert.equal(fileReport.telegram.lastOutboundTargetPresent, true)
    assert.doesNotMatch(JSON.stringify(fileReport), /telegram:private-chat-id/)
  })
})

test('v0.4 message bridge trace require-trace fails when no safe trace evidence exists', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      'scripts/v04-message-bridge-trace.mjs',
      '--sample',
      '--output',
      path.join(os.tmpdir(), 'nexus-v04-empty-bridge-trace.json'),
      '--require-trace',
    ], { cwd: process.cwd() }),
    (error: unknown) => {
      const childError = error as { code?: number, stdout?: string }
      assert.equal(childError.code, 2)
      const report = JSON.parse(childError.stdout ?? '{}')
      assert.equal(report.ok, false)
      assert.equal(report.overallStatus, 'sample-template')
      return true
    },
  )
})

test('v0.4 message bridge trace package wiring stays available', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const scriptText = await readFile('scripts/v04-message-bridge-trace.mjs', 'utf8')
  const distributionAudit = await readFile('scripts/distribution-audit.mjs', 'utf8')
  const releasingDoc = await readFile('docs/RELEASING.md', 'utf8')

  assert.equal(
    packageJson.scripts?.['v04:message:bridge:trace'],
    'node scripts/v04-message-bridge-trace.mjs --output artifacts/v0.4.0/message-awareness-bridge-trace.json',
  )
  assert.equal(scriptText.includes('../src/'), false)
  assert.ok(packageJson.build?.files?.includes('scripts/v04-message-bridge-trace.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/v04-message-bridge-trace.mjs'))
  assert.match(distributionAudit, /v04:message:bridge:trace/)
  assert.match(releasingDoc, /npm run v04:message:bridge:trace/)
})
