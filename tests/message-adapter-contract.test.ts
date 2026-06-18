import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  buildMessageAdapterPayloadTemplate,
  buildMessageAdapterContractReport,
  classifyMessageAdapterSource,
  MESSAGE_ADAPTER_CAPTURE_METHODS,
  MESSAGE_ADAPTER_PAYLOAD_TEMPLATES,
  MESSAGE_ADAPTER_SURFACES,
  normalizeMessageAdapterPayload,
  parseMessageAdapterContractArgs,
} from '../scripts/message-adapter-contract.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('message adapter contract normalizes email payload aliases into a safe report', () => {
  const report = buildMessageAdapterContractReport({
    kind: 'message',
    app: 'Gmail',
    from: 'alerts@example.com',
    subject: 'Production alert',
    body: 'secret incident text should not be copied into the report',
    captureMethod: 'mail-rule',
    threadId: 'gmail-thread-1',
    eventId: 'gmail-msg-1',
  }, { generatedAt: '2026-06-17T10:00:00Z' })
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.dedupeReady, true)
  assert.equal(report.sourceCategory, 'email')
  assert.equal(report.support.path, 'email-forwarder')
  assert.equal(report.permissionBoundary.status, 'permissioned')
  assert.equal(report.permissionBoundary.captureMethod, 'mail-rule')
  assert.equal(report.payloadSummary.source, 'Gmail')
  assert.equal(report.payloadSummary.captureMethod, 'mail-rule')
  assert.equal(report.payloadSummary.textLength, 'secret incident text should not be copied into the report'.length)
  assert.equal(report.payloadSummary.senderPresent, true)
  assert.equal(report.payloadSummary.chatTitlePresent, true)
  assert.equal(report.payloadSummary.conversationIdPresent, true)
  assert.equal(report.payloadSummary.messageIdPresent, true)
  assert.equal(json.includes('alerts@example.com'), false)
  assert.equal(json.includes('secret incident text'), false)
  assert.equal(json.includes('gmail-thread-1'), false)
  assert.equal(json.includes('gmail-msg-1'), false)
})

test('message adapter contract reports missing IM permission boundary and dedupe ids separately', () => {
  const report = buildMessageAdapterContractReport({
    kind: 'message',
    source: '微信',
    sender: '张三',
    text: '晚上同步一下',
  }, { generatedAt: '2026-06-17T10:00:00Z' })

  assert.equal(report.ok, false)
  assert.equal(report.dedupeReady, false)
  assert.equal(report.sourceCategory, 'im')
  assert.equal(report.support.path, 'im-notification-exporter')
  assert.equal(report.permissionBoundary.status, 'missing')
  assert.equal(report.privacyWarnings.some((warning) => warning.id === 'no-private-database-scraping'), true)
  assert.equal(report.privacyWarnings.some((warning) => warning.id === 'missing-permissioned-capture-method'), true)
  assert.equal(report.checks.find((check) => check.id === 'kind-message')?.pass, true)
  assert.equal(report.checks.find((check) => check.id === 'has-source')?.pass, true)
  assert.equal(report.checks.find((check) => check.id === 'has-text')?.pass, true)
  assert.equal(report.checks.find((check) => check.id === 'has-permissioned-capture-method')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-conversation-id')?.pass, false)
  assert.equal(report.checks.find((check) => check.id === 'has-message-id')?.pass, false)
  assert.ok(report.nextActions.some((action) => action.includes('captureMethod')))
  assert.ok(report.nextActions.some((action) => action.includes('conversationId')))
  assert.ok(report.nextActions.some((action) => action.includes('messageId')))
})

test('message adapter contract blocks private database capture methods for planned adapters', () => {
  const report = buildMessageAdapterContractReport({
    kind: 'message',
    source: 'QQ',
    text: 'private message body',
    captureMethod: 'sqlite database',
    conversationId: 'qq-chat-1',
    messageId: 'qq-message-1',
  }, { generatedAt: '2026-06-17T10:00:00Z' })
  const json = JSON.stringify(report)

  assert.equal(report.ok, false)
  assert.equal(report.dedupeReady, true)
  assert.equal(report.sourceCategory, 'im')
  assert.equal(report.permissionBoundary.status, 'blocked')
  assert.equal(report.permissionBoundary.captureMethod, 'private-database')
  assert.equal(report.checks.find((check) => check.id === 'has-permissioned-capture-method')?.pass, false)
  assert.equal(report.privacyWarnings.some((warning) => warning.id === 'private-database-access-blocked'), true)
  assert.ok(report.nextActions.some((action) => action.includes('Replace private database access')))
  assert.equal(json.includes('private message body'), false)
  assert.equal(json.includes('qq-chat-1'), false)
  assert.equal(json.includes('qq-message-1'), false)
})

test('message adapter contract blocks private database capture methods even for generic sources', () => {
  const report = buildMessageAdapterContractReport({
    kind: 'message',
    source: 'CustomNotifier',
    text: 'private message body',
    captureMethod: 'app database',
    conversationId: 'custom-chat-1',
    messageId: 'custom-message-1',
  })

  assert.equal(report.ok, false)
  assert.equal(report.sourceCategory, 'generic-webhook')
  assert.equal(report.permissionBoundary.status, 'blocked')
  assert.equal(report.checks.find((check) => check.id === 'has-permissioned-capture-method')?.pass, false)
  assert.equal(report.privacyWarnings.some((warning) => warning.id === 'private-database-access-blocked'), true)
})

test('message adapter contract keeps Telegram and Discord on native-bridge boundary', () => {
  assert.deepEqual(classifyMessageAdapterSource('Telegram').category, 'native-bridge')
  assert.deepEqual(classifyMessageAdapterSource('Discord').category, 'native-bridge')

  const report = buildMessageAdapterContractReport({
    kind: 'message',
    source: 'Telegram',
    text: 'hello',
    conversationId: 'chat-1',
    messageId: 'msg-1',
  })

  assert.equal(report.support.path, 'telegram-native')
  assert.equal(report.privacyWarnings.some((warning) => warning.id === 'native-bridge-duplicate-risk'), true)
  assert.ok(report.nextActions.some((action) => action.includes('native Telegram/Discord bridge')))
})

test('message adapter contract marks raw non-message payloads incomplete', () => {
  const normalized = normalizeMessageAdapterPayload({
    sourceName: 'Mail',
    body: 'hello',
  })
  const report = buildMessageAdapterContractReport(normalized)

  assert.equal(normalized.kind, '')
  assert.equal(report.ok, false)
  assert.equal(report.checks.find((check) => check.id === 'kind-message')?.pass, false)
})

test('message adapter contract args expose an explicit require-ready gate', () => {
  const options = parseMessageAdapterContractArgs([
    '--json',
    './adapter-payload.json',
    '--output',
    'artifacts/v0.3.4/message-adapter-mail.json',
    '--require-ready',
  ])

  assert.equal(options.json, './adapter-payload.json')
  assert.equal(options.outputPath, 'artifacts/v0.3.4/message-adapter-mail.json')
  assert.equal(options.requireReady, true)
})

test('message adapter contract cli outputs machine-readable private-safe JSON', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/message-adapter-contract.mjs',
    '--json',
    JSON.stringify({
      kind: 'message',
      source: 'Outlook',
      sender: 'person@example.com',
      text: 'private email body',
      captureMethod: 'imap',
      conversationId: 'thread-1',
      messageId: 'msg-1',
    }),
  ], { cwd: process.cwd() })
  const report = JSON.parse(stdout)

  assert.equal(report.ok, true)
  assert.equal(report.sourceCategory, 'email')
  assert.equal(report.permissionBoundary.captureMethod, 'imap-api')
  assert.equal(JSON.stringify(report).includes('person@example.com'), false)
  assert.equal(JSON.stringify(report).includes('private email body'), false)
})

test('message adapter contract cli can persist a private-safe evidence artifact', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-message-adapter-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'message-adapter-mail.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/message-adapter-contract.mjs',
      '--source',
      'Mail',
      '--capture-method',
      'mail-rule',
      '--sender',
      'private-sender@example.com',
      '--chat-title',
      'Private subject',
      '--conversation-id',
      'private-thread-1',
      '--message-id',
      'private-message-1',
      '--text',
      'private adapter body',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.equal(stdoutReport.ok, true)
    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.sourceCategory, 'email')
    assert.equal(fileReport.permissionBoundary.captureMethod, 'mail-rule')
    assert.equal(json.includes('private-sender@example.com'), false)
    assert.equal(json.includes('Private subject'), false)
    assert.equal(json.includes('private-thread-1'), false)
    assert.equal(json.includes('private-message-1'), false)
    assert.equal(json.includes('private adapter body'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('message adapter contract cli require-ready fails incomplete payloads without leaking private fields', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-message-adapter-incomplete-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'message-adapter-im.json')
  try {
    let caught: unknown
    try {
      await execFileAsync(process.execPath, [
        'scripts/message-adapter-contract.mjs',
        '--source',
        'WeChat',
        '--sender',
        'Private Person',
        '--text',
        'private IM body',
        '--conversation-id',
        'private-room-1',
        '--message-id',
        'private-message-1',
        '--output',
        outputPath,
        '--require-ready',
      ], { cwd: process.cwd() })
    } catch (error) {
      caught = error
    }

    assert.ok(caught && typeof caught === 'object')
    assert.equal((caught as { code?: number }).code, 1)

    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.equal(fileReport.ok, false)
    assert.equal(fileReport.sourceCategory, 'im')
    assert.equal(fileReport.permissionBoundary.status, 'missing')
    assert.equal(json.includes('Private Person'), false)
    assert.equal(json.includes('private IM body'), false)
    assert.equal(json.includes('private-room-1'), false)
    assert.equal(json.includes('private-message-1'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('message adapter payload templates produce contract-compliant starter payloads', () => {
  const email = buildMessageAdapterPayloadTemplate('email', { generatedAt: '2026-06-17T11:00:00Z' })
  const im = buildMessageAdapterPayloadTemplate('im')
  const emailReport = buildMessageAdapterContractReport(email.payload)
  const wrappedEmailReport = buildMessageAdapterContractReport(email)
  const imReport = buildMessageAdapterContractReport(im.payload)
  const json = JSON.stringify({ email, im })

  assert.equal(email.template.id, 'email-mail-rule')
  assert.equal(email.generatedAt, '2026-06-17T11:00:00.000Z')
  assert.equal(email.payload.captureMethod, 'mail-rule')
  assert.equal(emailReport.ok, true)
  assert.equal(wrappedEmailReport.ok, true)
  assert.equal(emailReport.dedupeReady, true)
  assert.equal(emailReport.sourceCategory, 'email')
  assert.equal(im.template.id, 'im-system-notification')
  assert.equal(im.payload.captureMethod, 'system-notification')
  assert.equal(imReport.ok, true)
  assert.equal(imReport.dedupeReady, true)
  assert.equal(imReport.sourceCategory, 'im')
  assert.match(email.checkCommand, /message:adapter:check/)
  assert.match(email.evidenceCommand, /artifacts\/v0\.3\.4\/message-adapter-email-mail-rule\.json/)
  assert.match(email.evidenceCommand, /--require-ready/)
  assert.equal(json.includes('private database'), false)
})

test('message adapter contract cli can emit and persist starter templates', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-message-adapter-template-'))
  const outputPath = path.join(outputRoot, 'message-adapter-email-template.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/message-adapter-contract.mjs',
      '--template',
      'email',
      '--output',
      outputPath,
    ], { cwd: process.cwd() })
    const stdoutTemplate = JSON.parse(stdout)
    const fileTemplate = JSON.parse(await readFile(outputPath, 'utf8'))
    const report = buildMessageAdapterContractReport(fileTemplate)

    assert.deepEqual(fileTemplate, stdoutTemplate)
    assert.equal(fileTemplate.template.id, 'email-mail-rule')
    assert.equal(fileTemplate.payload.kind, 'message')
    assert.equal(fileTemplate.payload.captureMethod, 'mail-rule')
    assert.equal(report.ok, true)
    assert.equal(report.dedupeReady, true)
    assert.equal(JSON.stringify(fileTemplate).includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('message adapter contract list includes payload template manifest', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/message-adapter-contract.mjs',
    '--list',
  ], { cwd: process.cwd() })
  const manifest = JSON.parse(stdout)

  assert.ok(manifest.payloadTemplates.some((entry: { id: string }) => entry.id === 'email-mail-rule'))
  assert.ok(manifest.payloadTemplates.some((entry: { id: string }) => entry.id === 'im-system-notification'))
  assert.ok(manifest.payloadTemplates.every((entry: { payload?: unknown }) => entry.payload == null))
})

test('message adapter contract manifest and package wiring stay available in builds', () => {
  assert.ok(MESSAGE_ADAPTER_SURFACES.some((entry) => entry.id === 'email-forwarder'))
  assert.ok(MESSAGE_ADAPTER_SURFACES.some((entry) => entry.id === 'im-notification-exporter'))
  assert.ok(MESSAGE_ADAPTER_SURFACES.some((entry) => entry.id === 'email-forwarder' && entry.allowedCaptureMethods?.includes('mail-rule')))
  assert.ok(MESSAGE_ADAPTER_SURFACES.some((entry) => entry.id === 'im-notification-exporter' && entry.allowedCaptureMethods?.includes('system-notification')))
  assert.ok(MESSAGE_ADAPTER_CAPTURE_METHODS.some((entry) => entry.id === 'user-automation'))
  assert.ok(MESSAGE_ADAPTER_PAYLOAD_TEMPLATES.some((entry) => entry.id === 'email-mail-rule'))
  assert.ok(MESSAGE_ADAPTER_PAYLOAD_TEMPLATES.some((entry) => entry.id === 'im-public-api'))
  assert.equal(packageJson.scripts?.['message:adapter:check'], 'node scripts/message-adapter-contract.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/message-adapter-contract.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/message-adapter-contract.mjs'))
})
