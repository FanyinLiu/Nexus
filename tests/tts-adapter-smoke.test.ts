import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  buildTtsAdapterSmokeReport,
  parseTtsAdapterSmokeArgs,
  TTS_ADAPTER_SMOKE_TARGETS,
} from '../scripts/tts-adapter-smoke.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

async function withTtsServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      handler(req, res, Buffer.concat(chunks).toString('utf8'))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}

test('tts adapter smoke parses target provider defaults and overrides', () => {
  const options = parseTtsAdapterSmokeArgs([
    '--provider',
    'kyutai-local',
    '--budget-ms',
    '900',
    '--timeout-ms=2500',
    '--output',
    'artifacts/v0.3.4/tts-smoke.json',
    '--require-ready',
    'hello from positional text',
  ])

  assert.equal(options.providerId, 'kyutai-local')
  assert.equal(options.budgetMs, 900)
  assert.equal(options.timeoutMs, 2500)
  assert.equal(options.outputPath, 'artifacts/v0.3.4/tts-smoke.json')
  assert.equal(options.requireReady, true)
  assert.equal(options.text, 'hello from positional text')
  assert.equal(TTS_ADAPTER_SMOKE_TARGETS['voxtral-local'].model, 'voxtral-tts')
})

test('tts adapter smoke measures first-byte evidence without copying private request values', async () => {
  let seenPath = ''
  let seenPayload: Record<string, unknown> | null = null
  const server = await withTtsServer((req, res, body) => {
    seenPath = req.url ?? ''
    seenPayload = JSON.parse(body)
    res.writeHead(200, { 'content-type': 'audio/wav' })
    res.write(Buffer.from([1, 2, 3, 4]))
    res.end(Buffer.from([5, 6]))
  })
  try {
    const report = await buildTtsAdapterSmokeReport({
      providerId: 'voxtral-local',
      baseUrl: server.baseUrl,
      model: 'private-model-id',
      voice: 'private-voice-id',
      text: 'private smoke text',
      budgetMs: 1_000,
      timeoutMs: 2_000,
    }, { generatedAt: '2026-06-17T15:00:00Z' })
    const json = JSON.stringify(report)

    assert.equal(seenPath, '/v1/audio/speech')
    assert.deepEqual(seenPayload, {
      input: 'private smoke text',
      model: 'private-model-id',
      response_format: 'wav',
      voice: 'private-voice-id',
    })
    assert.equal(report.gate, 'nexus-tts-adapter-smoke')
    assert.equal(report.generatedAt, '2026-06-17T15:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.adapter.providerId, 'voxtral-local')
    assert.equal(report.adapter.targetLocalEngine, true)
    assert.equal(report.adapter.baseUrlLocalhost, true)
    assert.equal(report.adapter.modelConfigured, true)
    assert.equal(report.adapter.voiceConfigured, true)
    assert.equal(report.request.inputChars, 'private smoke text'.length)
    assert.equal(report.response.httpStatus, 200)
    assert.equal(report.response.contentType, 'audio/wav')
    assert.equal(report.response.bytes, 6)
    assert.equal(report.response.receivedAudio, true)
    assert.equal(report.timing.firstByteLatencyMs !== null, true)
    assert.equal(report.timing.withinBudget, true)
    assert.equal(report.checks.every((check) => check.pass), true)
    assert.equal(json.includes('private-model-id'), false)
    assert.equal(json.includes('private-voice-id'), false)
    assert.equal(json.includes('private smoke text'), false)
    assert.equal(json.includes(server.baseUrl), false)
  } finally {
    await server.close()
  }
})

test('tts adapter smoke keeps HTTP errors private-safe and actionable', async () => {
  const server = await withTtsServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('private adapter stack trace')
  })
  try {
    const report = await buildTtsAdapterSmokeReport({
      providerId: 'kyutai-local',
      baseUrl: server.baseUrl,
      model: 'private-model-id',
      voice: 'private-voice-id',
      text: 'private text',
    }, { generatedAt: 'bad-date' })
    const json = JSON.stringify(report)

    assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
    assert.equal(report.ok, false)
    assert.equal(report.response.httpStatus, 500)
    assert.equal(report.checks.find((check) => check.id === 'http-ok')?.pass, false)
    assert.equal(report.nextActions.some((action) => action.includes('non-2xx')), true)
    assert.equal(json.includes('private adapter stack trace'), false)
    assert.equal(json.includes('private-model-id'), false)
    assert.equal(json.includes('private text'), false)
  } finally {
    await server.close()
  }
})

test('tts adapter smoke CLI outputs machine-readable local latency evidence', async () => {
  const server = await withTtsServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/wav' })
    res.end(Buffer.from([1, 2, 3]))
  })
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/tts-adapter-smoke.mjs',
      '--provider',
      'voxtral-local',
      '--base-url',
      server.baseUrl,
      '--text',
      'private cli text',
    ], { cwd: process.cwd() })
    const report = JSON.parse(stdout)

    assert.equal(report.ok, true)
    assert.equal(report.response.bytes, 3)
    assert.equal(JSON.stringify(report).includes('private cli text'), false)
  } finally {
    await server.close()
  }
})

test('tts adapter smoke CLI can persist the private-safe evidence artifact', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-tts-smoke-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'tts-smoke.json')
  const server = await withTtsServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'audio/wav' })
    res.end(Buffer.from([1, 2, 3, 4]))
  })
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/tts-adapter-smoke.mjs',
      '--provider',
      'voxtral-local',
      '--base-url',
      server.baseUrl,
      '--text',
      'private artifact text',
      '--output',
      outputPath,
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.equal(stdoutReport.ok, true)
    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.response.bytes, 4)
    assert.equal(json.includes('private artifact text'), false)
    assert.equal(json.includes(server.baseUrl), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await server.close()
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('tts adapter smoke package wiring stays available in builds', () => {
  assert.equal(packageJson.scripts?.['tts:adapter:smoke'], 'node scripts/tts-adapter-smoke.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/tts-adapter-smoke.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/tts-adapter-smoke.mjs'))
})
