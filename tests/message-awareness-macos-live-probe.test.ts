import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildMacosLiveProbeReport,
  parseMacosLiveProbeArgs,
} from '../scripts/message-awareness-macos-live-probe.mjs'
import packageJson from '../package.json' with { type: 'json' }

test('macOS live probe args support private-safe operator options', () => {
  assert.deepEqual(parseMacosLiveProbeArgs([
    '--apps',
    'WeChat|Telegram',
    '--db',
    '/tmp/notifications.db',
    '--sqlite',
    '/usr/bin/sqlite3',
    '--limit',
    '50',
    '--state-file',
    '/tmp/state.json',
    '--wait-ms',
    '250',
    '--send-test-notification',
    '--output',
    'artifacts/probe.json',
    '--require-observed',
  ]), {
    apps: 'WeChat|Telegram',
    db: '/tmp/notifications.db',
    help: false,
    limit: 50,
    outputPath: 'artifacts/probe.json',
    requireObserved: true,
    sendTestNotification: true,
    sqlite: '/usr/bin/sqlite3',
    stateFile: '/tmp/state.json',
    waitMs: 250,
  })
})

test('macOS live probe confirms one fresh candidate without leaking notification content', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-macos-probe-'))
  try {
    const stateFile = path.join(directoryPath, 'state.json')
    let queryCount = 0
    const oldRow = {
      __rowid: 'old-row',
      source: 'WeChat',
      title: 'Private Old Sender',
      body: 'private old body',
    }
    const freshRow = {
      __rowid: 'fresh-row',
      source: 'WeChat',
      title: 'Private Fresh Sender',
      body: 'private fresh body',
    }

    const report = await buildMacosLiveProbeReport({
      apps: 'WeChat',
      stateFile,
      waitMs: 1,
    }, {
      now: '2026-06-17T14:00:00Z',
      platform: 'darwin',
      resolveMacNotificationDb: async () => '/tmp/private-notifications.db',
      queryMacNotificationRows: async () => {
        queryCount += 1
        if (queryCount === 1) return [oldRow]
        return [oldRow, freshRow]
      },
      sleep: async () => {},
    })
    const json = JSON.stringify(report)

    assert.equal(report.gate, 'message-awareness-macos-live-probe')
    assert.equal(report.ok, true)
    assert.equal(report.status, 'observed-once')
    assert.equal(report.releaseEvidenceRecorded, false)
    assert.equal(report.releaseEvidenceCandidate, true)
    assert.equal(report.diagnostics.initialBacklogMarkedSeen, 1)
    assert.equal(report.diagnostics.observedFreshCount, 1)
    assert.equal(report.diagnostics.replayFreshCount, 0)
    assert.equal(json.includes('Private Fresh Sender'), false)
    assert.equal(json.includes('private fresh body'), false)
    assert.equal(json.includes('fresh-row'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('macOS live probe labels generated diagnostic notifications as non-release candidates', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-macos-probe-generated-'))
  try {
    const stateFile = path.join(directoryPath, 'state.json')
    let queryCount = 0
    let sentDiagnosticNotification = false
    const freshRow = {
      __rowid: 'generated-row',
      source: 'NexusLiveCheck',
      title: 'Private Diagnostic Sender',
      body: 'private diagnostic body',
    }

    const report = await buildMacosLiveProbeReport({
      apps: 'NexusLiveCheck',
      sendTestNotification: true,
      stateFile,
      waitMs: 1,
    }, {
      now: '2026-06-17T14:00:00Z',
      platform: 'darwin',
      resolveMacNotificationDb: async () => '/tmp/private-notifications.db',
      queryMacNotificationRows: async () => {
        queryCount += 1
        return queryCount === 1 ? [] : [freshRow]
      },
      sendDiagnosticNotification: async () => {
        sentDiagnosticNotification = true
      },
      sleep: async () => {},
    })

    assert.equal(sentDiagnosticNotification, true)
    assert.equal(report.ok, true)
    assert.equal(report.status, 'observed-once')
    assert.equal(report.releaseEvidenceCandidate, false)
    assert.equal(report.diagnostics.testNotificationRequested, true)
    assert.ok(report.nextActions.some((action) => action.includes('real communication-app notification')))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('macOS live probe CLI and package wiring stay available', async () => {
  await mkdir(path.join(os.tmpdir(), 'nexus-probe-read-check'), { recursive: true })
  const scriptText = await readFile('scripts/message-awareness-macos-live-probe.mjs', 'utf8')

  assert.equal(
    packageJson.scripts?.['v04:message:probe:macos'],
    'node scripts/message-awareness-macos-live-probe.mjs --output artifacts/v0.4.0/message-awareness-macos-live-probe.json',
  )
  assert.equal(scriptText.includes('message-awareness-macos-live-probe'), true)
  assert.ok(packageJson.build?.files?.includes('scripts/message-awareness-macos-live-probe.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/message-awareness-macos-live-probe.mjs'))
})
