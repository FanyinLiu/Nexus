import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  buildMessageAwarenessEvidence,
  normalizeLiveEvidenceChecks,
  redactMessageAwarenessEvidence,
} from '../scripts/validate-message-awareness.mjs'

const execFileAsync = promisify(execFile)

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-prerelease-check-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

function completeMessageAwarenessEvidence() {
  return buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      sender: 'Private Sender',
      source: 'Nexus Validation',
      text: 'private local webhook payload',
    },
    response: {
      id: 'private-response-id',
      ok: true,
    },
    completedAt: '2026-06-17T12:40:00Z',
    liveEvidenceChecks: normalizeLiveEvidenceChecks([
      {
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-17T12:10:00Z',
        operator: 'Release Operator',
        notes: ['Observed one real app notification once after permission setup.'],
        evidence: {
          appName: 'Messages',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      },
      {
        id: 'telegram-live-bridge',
        status: 'pass',
        observedAt: '2026-06-17T12:20:00Z',
        operator: 'Release Operator',
        notes: ['Owner DM paired, replied, queued while busy, and did not replay.'],
        evidence: {
          pairingApproved: true,
          ownerTextReplyReturned: true,
          busyMessageQueuedOrRetried: true,
          reconnectReplayChecked: true,
        },
      },
      {
        id: 'discord-live-bridge',
        status: 'pass',
        observedAt: '2026-06-17T12:30:00Z',
        operator: 'Release Operator',
        notes: ['Approved Discord channel replied and reconnect status was visible.'],
        evidence: {
          approvedChannelReplyReturned: true,
          botEchoSuppressed: true,
          messageContentIntentEnabled: true,
          reconnectStatusVisible: true,
        },
      },
    ]),
    startedAt: '2026-06-17T12:39:00Z',
  })
}

test('prerelease check accepts spaced --only option without running earlier stages', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/prerelease-check.mjs',
    'v0.4.0-beta.1',
    '--only',
    'F',
    '--quick',
  ], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  })

  assert.match(stdout, /Stage A: Process & version .* skipped/)
  assert.match(stdout, /Stage F: Privacy \+ governance/)
  assert.match(stdout, /v0\.4 readiness and completion gates complete/)
  assert.match(stdout, /npm run v04:message:preflight:live/)
  assert.match(stdout, /--preflight/)
  assert.match(stdout, /discord --preflight/)
  assert.match(stdout, /REPLACE_WITH_OBSERVED_AT/)
  assert.match(stdout, /replace placeholders: operator, appName, observedAt/)
  assert.doesNotMatch(stdout, /package\.json\.version ===/)
})

test('prerelease check rejects raw message-awareness evidence overrides for stable tags', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    await fs.writeFile(evidencePath, JSON.stringify(completeMessageAwarenessEvidence()), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/prerelease-check.mjs',
        'v0.3.987',
        '--only',
        'F',
        '--quick',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXUS_MESSAGE_AWARENESS_EVIDENCE_FILE: evidencePath,
        },
        maxBuffer: 1024 * 1024,
      }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        assert.match(err.stdout ?? '', /message-awareness release evidence must be redacted/)
        assert.match(err.stdout ?? '', /DO NOT TAG v0\.3\.987/)
        return true
      },
    )
  })
})

test('prerelease check accepts redacted message-awareness evidence overrides for stable tags', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'v0.3.987-message-awareness.json')
    const evidence = completeMessageAwarenessEvidence()
    await fs.writeFile(evidencePath, JSON.stringify(redactMessageAwarenessEvidence(evidence)), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/prerelease-check.mjs',
      'v0.3.987',
      '--only',
      'F',
      '--quick',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXUS_MESSAGE_AWARENESS_EVIDENCE_FILE: evidencePath,
      },
      maxBuffer: 1024 * 1024,
    })

    assert.match(stdout, /v0\.3\.4\+ message-awareness release evidence complete .*OK/)
    assert.match(stdout, /All blocker checks passed/)
    assert.doesNotMatch(stdout, /private local webhook payload|Private Sender|private-response-id/)
  })
})
