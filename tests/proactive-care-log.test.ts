import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildProactiveCareEventsExport,
  buildProactiveCareEvidenceReport,
  buildPublicProactiveCareEvidenceReport,
  clearProactiveCareEvents,
  loadProactiveCareEvents,
  normalizeProactiveCareEvents,
  recordProactiveCareEvent,
  recordProactiveCareUserAction,
  resolveProactiveCareAutonomyFocus,
  resolveProactiveCareSourceRefNavigation,
} from '../src/lib/storage/proactiveCare.ts'
import { PROACTIVE_CARE_EVENTS_STORAGE_KEY } from '../src/lib/storage/core.ts'
import {
  extractProactiveCareEventsFromLocalStorageLevelDb,
  parseProactiveCareEvidenceArgs,
  SAMPLE_PROACTIVE_CARE_EVENTS,
} from '../scripts/proactive-care-evidence.mjs'

const execFileAsync = promisify(execFile)

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }
}

function installStorage(initial: Record<string, string> = {}) {
  const localStorage = createLocalStorageMock(initial)
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })
  return localStorage
}

test('proactive care evidence args support sample report QA mode', () => {
  assert.deepEqual(parseProactiveCareEvidenceArgs([
    '--sample',
    '--generated-at=2026-06-16T14:00:00Z',
    '--output',
    'artifacts/v0.3.4/proactive-care-evidence.json',
    '--require-ready',
  ]), {
    eventsFile: '',
    generatedAt: '2026-06-16T14:00:00Z',
    localStorageLevelDb: '',
    outputPath: 'artifacts/v0.3.4/proactive-care-evidence.json',
    requireReady: true,
    sample: true,
    help: false,
  })
})

test('normalizeProactiveCareEvents filters malformed rows and sorts newest first', () => {
  const events = normalizeProactiveCareEvents([
    {
      id: 'old',
      source: 'away_notification',
      outcome: 'skipped',
      reason: 'below_threshold',
      detail: 'not enough idle time',
      createdAt: '2026-06-01T00:00:00Z',
      occurrences: 2,
    },
    {
      id: 'new',
      source: 'daily_bracket',
      outcome: 'fired',
      reason: 'fire',
      detail: 'morning bracket',
      createdAt: '2026-06-02T00:00:00Z',
      sourceRef: { kind: 'bracket', id: 'morning', label: 'Morning' },
    },
    { id: 'bad-source', source: 'unknown', outcome: 'skipped', reason: 'x' },
    { id: 'bad-reason', source: 'open_arc', outcome: 'skipped', reason: '' },
  ])

  assert.equal(events.length, 2)
  assert.equal(events[0]?.id, 'new')
  assert.equal(events[0]?.occurrences, 1)
  assert.deepEqual(events[0]?.sourceRef, { kind: 'bracket', id: 'morning', label: 'Morning' })
  assert.equal(events[1]?.occurrences, 2)
})

test('recordProactiveCareEvent dedupes repeated skip decisions inside the window', () => {
  installStorage()

  recordProactiveCareEvent({
    source: 'open_arc',
    outcome: 'skipped',
    reason: 'no-arcs',
    detail: 'no open arcs',
    createdAt: '2026-06-01T10:00:00Z',
  })
  recordProactiveCareEvent({
    source: 'open_arc',
    outcome: 'skipped',
    reason: 'no-arcs',
    detail: 'no open arcs',
    createdAt: '2026-06-01T10:05:00Z',
  })

  const events = loadProactiveCareEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0]?.occurrences, 2)
  assert.equal(events[0]?.createdAt, '2026-06-01T10:05:00.000Z')
})

test('recordProactiveCareEvent keeps distinct reasons as separate entries', () => {
  installStorage()

  recordProactiveCareEvent({
    source: 'away_notification',
    outcome: 'skipped',
    reason: 'below_threshold',
    createdAt: '2026-06-01T10:00:00Z',
  })
  recordProactiveCareEvent({
    source: 'away_notification',
    outcome: 'skipped',
    reason: 'quiet_hours',
    createdAt: '2026-06-01T10:01:00Z',
  })

  const events = loadProactiveCareEvents()
  assert.equal(events.length, 2)
  assert.equal(events[0]?.reason, 'quiet_hours')
  assert.equal(events[1]?.reason, 'below_threshold')
})

test('recordProactiveCareEvent keeps distinct source refs as separate entries', () => {
  installStorage()

  recordProactiveCareEvent({
    source: 'open_arc',
    outcome: 'fired',
    reason: 'fire',
    detail: 'arc check-in',
    sourceRef: { kind: 'arc', id: 'arc-a' },
    createdAt: '2026-06-01T10:00:00Z',
  })
  recordProactiveCareEvent({
    source: 'open_arc',
    outcome: 'fired',
    reason: 'fire',
    detail: 'arc check-in',
    sourceRef: { kind: 'arc', id: 'arc-b' },
    createdAt: '2026-06-01T10:05:00Z',
  })

  const events = loadProactiveCareEvents()
  assert.equal(events.length, 2)
  assert.deepEqual(events[0]?.sourceRef, { kind: 'arc', id: 'arc-b' })
  assert.deepEqual(events[1]?.sourceRef, { kind: 'arc', id: 'arc-a' })
})

test('recordProactiveCareUserAction accepts every v2 feedback action', () => {
  installStorage()

  const actions = ['snooze', 'less_like_this', 'mute_source', 'open_source'] as const
  const eventIds: string[] = []
  for (const action of actions) {
    const event = recordProactiveCareEvent({
      source: 'away_notification',
      outcome: 'fired',
      reason: `fire_${action}`,
      detail: `detail for ${action}`,
      createdAt: '2026-06-01T10:00:00Z',
    })
    assert.ok(event)
    eventIds.push(event.id)

    const updated = recordProactiveCareUserAction(event.id, action)
    assert.equal(updated?.userAction, action)
    assert.equal(updated?.carePolicyVersion, 2)
    assert.equal(updated?.userVisibleReason, `detail for ${action}`)
  }

  const report = buildProactiveCareEvidenceReport(loadProactiveCareEvents())
  assert.deepEqual(report.userActionCounts, {
    less_like_this: 1,
    mute_source: 1,
    open_source: 1,
    snooze: 1,
  })
  assert.equal(report.checks.find((check) => check.id === 'has-user-feedback-actions')?.pass, true)
  assert.deepEqual(
    loadProactiveCareEvents().map((event) => event.id).sort(),
    eventIds.sort(),
  )
})

test('loadProactiveCareEvents compacts malformed persisted logs', () => {
  const storage = installStorage({
    [PROACTIVE_CARE_EVENTS_STORAGE_KEY]: JSON.stringify([
      {
        id: 'keep',
        source: 'future_capsule',
        outcome: 'error',
        reason: 'notification_failed',
        detail: 'native notification failed',
        createdAt: '2026-06-01T10:00:00Z',
        occurrences: '3',
      },
      { id: 'drop', source: 'future_capsule', outcome: 'bad', reason: 'x' },
    ]),
  })

  const events = loadProactiveCareEvents()
  assert.deepEqual(events, [{
    id: 'keep',
    source: 'future_capsule',
    outcome: 'error',
    reason: 'notification_failed',
    detail: 'native notification failed',
    createdAt: '2026-06-01T10:00:00.000Z',
    occurrences: 3,
  }])
  assert.deepEqual(JSON.parse(storage.getItem(PROACTIVE_CARE_EVENTS_STORAGE_KEY) ?? '[]'), events)
})

test('buildProactiveCareEvidenceReport summarizes scheduler quality proof', () => {
  const events = normalizeProactiveCareEvents([
    {
      id: 'fire-away',
      source: 'away_notification',
      outcome: 'fired',
      reason: 'fire',
      detail: 'threshold=30m',
      createdAt: '2026-06-16T10:00:00Z',
      occurrences: 1,
      carePolicyVersion: 2,
      userVisibleReason: 'You were away long enough for a gentle check-in.',
      userAction: 'open_source',
      sourceRef: { kind: 'message', id: 'msg-1', label: '2026-06-16T09:20:00Z' },
    },
    {
      id: 'quiet-arc',
      source: 'open_arc',
      outcome: 'skipped',
      reason: 'quiet-hours',
      detail: 'open_arcs=1',
      createdAt: '2026-06-16T11:00:00Z',
      occurrences: 1,
      carePolicyVersion: 2,
      userVisibleReason: 'Quiet hours kept this open arc check-in silent.',
      sourceRef: { kind: 'arc', id: 'arc-1' },
    },
    {
      id: 'cooldown-bracket',
      source: 'daily_bracket',
      outcome: 'skipped',
      reason: 'morning_already_fired_today',
      detail: 'relationship=close_friend',
      createdAt: '2026-06-16T12:00:00Z',
      occurrences: 2,
      carePolicyVersion: 2,
      userVisibleReason: 'The morning bracket was skipped because it already fired today.',
    },
    {
      id: 'capsule-error',
      source: 'future_capsule',
      outcome: 'error',
      reason: 'notification_failed',
      detail: 'native failure',
      createdAt: '2026-06-16T13:00:00Z',
      occurrences: 1,
      carePolicyVersion: 2,
      userVisibleReason: 'The future capsule tried to notify you but the native notification failed.',
      sourceRef: { kind: 'capsule', id: 'capsule-1' },
    },
  ])

  const report = buildProactiveCareEvidenceReport(events, '2026-06-16T14:00:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.gate, 'proactive-care-observability')
  assert.equal(report.generatedAt, '2026-06-16T14:00:00.000Z')
  assert.equal(report.totalEvents, 4)
  assert.equal(report.totalOccurrences, 5)
  assert.equal(report.firstEventAt, '2026-06-16T10:00:00.000Z')
  assert.equal(report.lastEventAt, '2026-06-16T13:00:00.000Z')
  assert.equal(report.coverageWindowMs, 10_800_000)
  assert.equal(report.coverageWindowHours, 3)
  assert.deepEqual(report.outcomeCounts, { error: 1, fired: 1, skipped: 3 })
  assert.equal(report.sourceCounts.away_notification.fired, 1)
  assert.equal(report.sourceCounts.daily_bracket.skipped, 2)
  assert.equal(report.sourceCounts.future_capsule.error, 1)
  assert.equal(report.sourceCounts.open_arc.withSourceRef, 1)
  assert.equal(report.reasonCounts.morning_already_fired_today, 2)
  assert.deepEqual(report.decisionWindowCounts, {
    due_item: 1,
    error: 1,
    quiet_hours: 1,
    rate_limited: 2,
  })
  assert.equal(report.keyDecisionWindowCount, 3)
  assert.equal(report.sourceRefCount, 3)
  assert.equal(report.missingSourceRefCount, 1)
  assert.equal(report.openableSourceRefCount, 3)
  assert.equal(report.sourceRefCoverage, 0.75)
  assert.equal(report.openableSourceRefCoverage, 0.75)
  assert.equal(report.sourceCounts.away_notification.firstEventAt, '2026-06-16T10:00:00.000Z')
  assert.equal(report.sourceCounts.away_notification.lastEventAt, '2026-06-16T10:00:00.000Z')
  assert.equal(report.sourceCounts.away_notification.sourceRefCoverage, 1)
  assert.equal(report.sourceCounts.away_notification.openableSourceRefCoverage, 1)
  assert.equal(report.sourceCounts.away_notification.coverageWindowHours, 0)
  assert.equal(report.sourceCounts.away_notification.decisionWindowCounts.due_item, 1)
  assert.equal(report.sourceCounts.daily_bracket.sourceRefCoverage, 0)
  assert.equal(report.sourceCounts.daily_bracket.openableSourceRefCoverage, 0)
  assert.equal(report.sourceCounts.daily_bracket.decisionWindowCounts.rate_limited, 2)
  assert.equal(report.quietHoursSkipCount, 1)
  assert.equal(report.rateLimitSkipCount, 2)
  assert.equal(report.v2EventCount, 4)
  assert.equal(report.userVisibleReasonCount, 4)
  assert.deepEqual(report.userActionCounts, {
    less_like_this: 0,
    mute_source: 0,
    open_source: 1,
    snooze: 0,
  })
  assert.equal(report.qualityIssueCount > 0, true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'daily_bracket:missing-source-refs'), true)
  assert.deepEqual(report.nextActions, [])
  assert.equal(checks.get('has-events'), true)
  assert.equal(checks.get('has-fired'), true)
  assert.equal(checks.get('has-skipped'), true)
  assert.equal(checks.get('has-quiet-hours-skip'), true)
  assert.equal(checks.get('has-rate-limit-skip'), true)
  assert.equal(checks.get('has-key-decision-window-coverage'), true)
  assert.equal(checks.get('has-source-refs'), true)
  assert.equal(checks.get('has-openable-source-refs'), true)
  assert.equal(checks.get('has-source-ref-coverage'), true)
  assert.equal(checks.get('has-openable-source-ref-coverage'), true)
  assert.equal(checks.get('has-all-sources-observed'), true)
  assert.equal(checks.get('has-multi-hour-coverage'), true)
  assert.equal(checks.get('has-v2-policy-events'), true)
  assert.equal(checks.get('has-user-visible-reasons'), true)
  assert.equal(checks.get('has-user-feedback-actions'), true)
  assert.equal(report.latestEvents[0]?.id, 'capsule-error')
})

test('buildProactiveCareEvidenceReport identifies unobserved sources and weak source links', () => {
  const events = normalizeProactiveCareEvents([
    {
      id: 'only-away',
      source: 'away_notification',
      outcome: 'skipped',
      reason: 'quiet_hours',
      detail: 'inside quiet hours',
      createdAt: '2026-06-16T10:00:00Z',
      occurrences: 1,
    },
  ])

  const report = buildProactiveCareEvidenceReport(events, '2026-06-16T10:30:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.sourceRefCoverage, 0)
  assert.equal(report.openableSourceRefCoverage, 0)
  assert.equal(report.decisionWindowCounts.quiet_hours, 1)
  assert.equal(report.keyDecisionWindowCount, 1)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'daily_bracket:unobserved'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'low-source-ref-coverage'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'low-openable-source-ref-coverage'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'short-coverage-window'), true)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'missing-key-decision-window-coverage'), true)
  assert.ok(report.nextActions.some((action) => action.includes('native notification path')))
  assert.ok(report.nextActions.some((action) => action.includes('rate-limit skip')))
  assert.equal(checks.get('has-source-ref-coverage'), false)
  assert.equal(checks.get('has-openable-source-ref-coverage'), false)
  assert.equal(checks.get('has-key-decision-window-coverage'), false)
  assert.equal(checks.get('has-all-sources-observed'), false)
})

test('buildProactiveCareEvidenceReport distinguishes present refs from openable refs', () => {
  const events = normalizeProactiveCareEvents([
    {
      id: 'unknown-scheduler',
      source: 'daily_bracket',
      outcome: 'skipped',
      reason: 'in_cooldown',
      detail: 'scheduler id cannot route back to a known autonomy source',
      createdAt: '2026-06-16T10:00:00Z',
      sourceRef: { kind: 'scheduler', id: 'unknown-scheduler' },
    },
  ])

  const report = buildProactiveCareEvidenceReport(events, '2026-06-16T10:30:00Z')
  const checks = new Map(report.checks.map((check) => [check.id, check.pass]))

  assert.equal(report.sourceRefCount, 1)
  assert.equal(report.openableSourceRefCount, 0)
  assert.equal(report.sourceRefCoverage, 1)
  assert.equal(report.openableSourceRefCoverage, 0)
  assert.equal(report.sourceCounts.daily_bracket.withOpenableSourceRef, 0)
  assert.equal(report.sourceCounts.daily_bracket.openableSourceRefCoverage, 0)
  assert.equal(report.sourceCounts.daily_bracket.decisionWindowCounts.rate_limited, 1)
  assert.equal(checks.get('has-source-refs'), true)
  assert.equal(checks.get('has-source-ref-coverage'), true)
  assert.equal(checks.get('has-openable-source-refs'), false)
  assert.equal(checks.get('has-openable-source-ref-coverage'), false)
  assert.equal(report.qualityIssues.some((issue) => issue.id === 'low-openable-source-ref-coverage'), true)
})

test('buildProactiveCareEvidenceReport keeps empty evidence explicit', () => {
  const report = buildProactiveCareEvidenceReport([], 'bad-date')

  assert.equal(report.totalEvents, 0)
  assert.equal(report.totalOccurrences, 0)
  assert.equal(report.firstEventAt, null)
  assert.equal(report.lastEventAt, null)
  assert.equal(report.coverageWindowMs, 0)
  assert.equal(report.coverageWindowHours, 0)
  assert.equal(report.sourceRefCount, 0)
  assert.equal(report.openableSourceRefCount, 0)
  assert.equal(report.sourceRefCoverage, 0)
  assert.equal(report.openableSourceRefCoverage, 0)
  assert.deepEqual(report.decisionWindowCounts, {
    due_item: 0,
    error: 0,
    quiet_hours: 0,
    rate_limited: 0,
  })
  assert.equal(report.keyDecisionWindowCount, 0)
  assert.equal(report.quietHoursSkipCount, 0)
  assert.equal(report.rateLimitSkipCount, 0)
  assert.equal(report.qualityIssueCount, 4)
  assert.ok(report.nextActions.some((action) => action.includes('proactive care enabled')))
  assert.equal(report.checks.every((check) => check.pass === false), true)
  assert.equal(Number.isFinite(Date.parse(report.generatedAt)), true)
})

test('buildPublicProactiveCareEvidenceReport omits private event fields', () => {
  const events = normalizeProactiveCareEvents([
    {
      id: 'private-event-id',
      source: 'open_arc',
      outcome: 'skipped',
      reason: 'private detail accidentally placed in reason',
      detail: 'private proactive care detail',
      createdAt: '2026-06-16T10:00:00Z',
      occurrences: 1,
      sourceRef: { kind: 'arc', id: 'private-arc-id', label: 'Private arc label' },
    },
  ])

  const report = buildPublicProactiveCareEvidenceReport(events, '2026-06-16T10:30:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, false)
  assert.equal(report.reasonCounts.custom_reason, 1)
  assert.ok(report.nextActions.some((action) => action.includes('native notification path')))
  assert.equal(report.latestEvents[0]?.reason, 'custom_reason')
  assert.deepEqual(report.latestEvents[0]?.sourceRef, {
    focus: 'arc',
    kind: 'arc',
    openable: true,
    route: 'autonomy',
  })
  assert.equal(json.includes('private-event-id'), false)
  assert.equal(json.includes('private proactive care detail'), false)
  assert.equal(json.includes('private detail accidentally placed in reason'), false)
  assert.equal(json.includes('private-arc-id'), false)
  assert.equal(json.includes('Private arc label'), false)
})

test('buildProactiveCareEventsExport preserves local event rows for release evidence generation', () => {
  const exportPayload = buildProactiveCareEventsExport([
    {
      id: 'private-event-id',
      source: 'open_arc',
      outcome: 'fired',
      reason: 'fire',
      detail: 'private event detail needed for local audit',
      createdAt: '2026-06-16T10:00:00Z',
      occurrences: 1,
      sourceRef: { kind: 'arc', id: 'private-arc-id', label: 'Private arc label' },
    },
  ], '2026-06-16T10:30:00Z')
  const json = JSON.stringify(exportPayload)

  assert.equal(exportPayload.schemaVersion, 1)
  assert.equal(exportPayload.kind, 'nexus.proactive-care-events-export')
  assert.equal(exportPayload.generatedAt, '2026-06-16T10:30:00.000Z')
  assert.equal(exportPayload.containsPrivateEventRows, true)
  assert.equal(exportPayload.events.length, 1)
  assert.equal(exportPayload.events[0]?.createdAt, '2026-06-16T10:00:00.000Z')
  assert.equal(exportPayload.usage.command.includes('proactive:care:evidence'), true)
  assert.equal(json.includes('private-event-id'), true)
  assert.equal(json.includes('private event detail needed for local audit'), true)
  assert.equal(json.includes('private-arc-id'), true)
  assert.equal(json.includes('Private arc label'), true)
})

test('built-in proactive care sample produces private-safe ready QA evidence', () => {
  const report = buildPublicProactiveCareEvidenceReport(
    normalizeProactiveCareEvents(SAMPLE_PROACTIVE_CARE_EVENTS),
    '2026-06-16T14:00:00Z',
  )
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.gate, 'proactive-care-observability')
  assert.equal(report.generatedAt, '2026-06-16T14:00:00.000Z')
  assert.equal(report.totalEvents, 4)
  assert.equal(report.keyDecisionWindowCount, 3)
  assert.equal(report.sourceCounts.away_notification.events, 1)
  assert.equal(report.sourceCounts.daily_bracket.events, 1)
  assert.equal(report.sourceCounts.open_arc.events, 1)
  assert.equal(report.sourceCounts.future_capsule.events, 1)
  assert.equal(report.checks.every((check) => check.pass), true)
  assert.deepEqual(report.nextActions, [])
  assert.equal(json.includes('sample-message'), false)
  assert.equal(json.includes('sample-arc'), false)
  assert.equal(json.includes('sample-capsule'), false)
  assert.equal(json.includes('Synthetic'), false)
})

test('proactive care evidence CLI accepts the runtime event export object', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-proactive-care-export-'))
  const inputPath = path.join(outputRoot, 'proactive-care-events.json')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'proactive-care-evidence.json')
  try {
    await writeFile(inputPath, JSON.stringify(
      buildProactiveCareEventsExport(
        normalizeProactiveCareEvents(SAMPLE_PROACTIVE_CARE_EVENTS),
        '2026-06-16T14:00:00Z',
      ),
    ), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/proactive-care-evidence.mjs',
      '--events-file',
      inputPath,
      '--generated-at',
      '2026-06-16T14:05:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, 'proactive-care-observability')
    assert.equal(fileReport.evidenceSource, 'runtime-events')
    assert.equal(fileReport.generatedAt, '2026-06-16T14:05:00.000Z')
    assert.equal(fileReport.checks.every((check: { pass: boolean }) => check.pass), true)
    assert.equal(json.includes('sample-message'), false)
    assert.equal(json.includes('Synthetic'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('proactive care evidence CLI can read Chromium localStorage LevelDB directly', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-proactive-care-leveldb-'))
  const levelDbDir = path.join(outputRoot, 'Local Storage', 'leveldb')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'proactive-care-evidence.json')
  const olderEvents = SAMPLE_PROACTIVE_CARE_EVENTS.slice(0, 1)
  try {
    await mkdir(levelDbDir, { recursive: true })
    await writeFile(path.join(levelDbDir, '000001.log'), Buffer.concat([
      Buffer.from('binary-prefix'),
      Buffer.from('nexus:proactive:care-events'),
      Buffer.from([0, 1, 2]),
      Buffer.from(JSON.stringify({ events: olderEvents })),
      Buffer.from('middle-fragment'),
      Buffer.from('nexus:proactive:care-events'),
      Buffer.from([0, 3, 4]),
      Buffer.from(JSON.stringify({ events: SAMPLE_PROACTIVE_CARE_EVENTS })),
      Buffer.from('binary-suffix'),
    ]))

    const extracted = await extractProactiveCareEventsFromLocalStorageLevelDb(levelDbDir)
    assert.equal(extracted.length, SAMPLE_PROACTIVE_CARE_EVENTS.length)

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/proactive-care-evidence.mjs',
      '--local-storage-leveldb',
      levelDbDir,
      '--generated-at',
      '2026-06-16T14:05:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.evidenceSource, 'runtime-events')
    assert.equal(fileReport.totalEvents, SAMPLE_PROACTIVE_CARE_EVENTS.length)
    assert.equal(fileReport.sourceCounts.daily_bracket.events, 1)
    assert.equal(json.includes(levelDbDir), false)
    assert.equal(json.includes('sample-message'), false)
    assert.equal(json.includes('Synthetic'), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('proactive care evidence CLI can persist a private-safe report', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-proactive-care-'))
  const inputPath = path.join(outputRoot, 'events.json')
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'proactive-care-evidence.json')
  try {
    await writeFile(inputPath, JSON.stringify([
      {
        id: 'private-event-id',
        source: 'daily_bracket',
        outcome: 'skipped',
        reason: 'quiet_hours',
        detail: 'private quiet-hours detail',
        createdAt: '2026-06-16T10:00:00Z',
        sourceRef: { kind: 'scheduler', id: 'daily_bracket', label: 'Private bracket label' },
      },
    ]), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/proactive-care-evidence.mjs',
      '--events-file',
      inputPath,
      '--generated-at',
      '2026-06-16T10:30:00Z',
      '--output',
      outputPath,
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.gate, 'proactive-care-observability')
    assert.equal(fileReport.evidenceSource, 'runtime-events')
    assert.equal(fileReport.reasonCounts.quiet_hours, 1)
    assert.equal(fileReport.latestEvents[0]?.sourceRef?.route, 'autonomy')
    assert.equal(json.includes('private-event-id'), false)
    assert.equal(json.includes('private quiet-hours detail'), false)
    assert.equal(json.includes('daily_bracket","label'), false)
    assert.equal(json.includes('Private bracket label'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('proactive care evidence CLI can persist the built-in sample QA report', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'nexus-proactive-care-sample-'))
  const outputPath = path.join(outputRoot, 'artifacts', 'v0.3.4', 'proactive-care-evidence.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/proactive-care-evidence.mjs',
      '--sample',
      '--generated-at',
      '2026-06-16T14:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, 'proactive-care-observability')
    assert.equal(fileReport.evidenceSource, 'sample-qa')
    assert.equal(fileReport.keyDecisionWindowCount, 3)
    assert.equal(json.includes('sample-message'), false)
    assert.equal(json.includes('sample-arc'), false)
    assert.equal(json.includes('sample-capsule'), false)
    assert.equal(json.includes('Synthetic'), false)
    assert.equal(json.includes(outputRoot), false)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('clearProactiveCareEvents empties the log', () => {
  installStorage()
  recordProactiveCareEvent({
    source: 'daily_bracket',
    outcome: 'fired',
    reason: 'fire',
  })

  clearProactiveCareEvents()

  assert.deepEqual(loadProactiveCareEvents(), [])
})

test('resolveProactiveCareSourceRefNavigation routes messages to history and other care sources to autonomy', () => {
  assert.deepEqual(
    resolveProactiveCareSourceRefNavigation({ kind: 'message', id: 'msg-1' }),
    { section: 'history', historySourceRef: 'chat:msg-1' },
  )
  assert.deepEqual(
    resolveProactiveCareSourceRefNavigation({ kind: 'arc', id: 'arc-1' }),
    { section: 'autonomy', focus: 'arc' },
  )
  assert.deepEqual(
    resolveProactiveCareSourceRefNavigation({ kind: 'scheduler', id: 'daily_bracket' }),
    { section: 'autonomy', focus: 'daily_bracket' },
  )
})

test('resolveProactiveCareAutonomyFocus maps scheduler and object refs to concrete source views', () => {
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'scheduler', id: 'away_notification' }), 'away_notification')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'scheduler', id: 'open_arc' }), 'open_arc')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'scheduler', id: 'future_capsule' }), 'future_capsule')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'bracket', id: 'morning' }), 'daily_bracket')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'errand', id: 'errand-1' }), 'errand')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'arc', id: 'arc-1' }), 'arc')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'capsule', id: 'capsule-1' }), 'capsule')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'scheduler', id: 'unknown-scheduler' }), 'unknown')
  assert.equal(resolveProactiveCareAutonomyFocus({ kind: 'message', id: 'msg-1' }), 'unknown')
})

test('proactive care evidence wiring stays available in packaged builds', async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))

  assert.equal(
    pkg.scripts?.['proactive:care:evidence'],
    'node --experimental-strip-types scripts/proactive-care-evidence.mjs',
  )
  assert.ok(pkg.build?.files?.includes('scripts/proactive-care-evidence.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/proactive-care-runtime-rehearsal.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/proactive-care-evidence.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/proactive-care-runtime-rehearsal.mjs'))
})
