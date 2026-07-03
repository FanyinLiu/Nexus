import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatRequestedOutput,
  parseOpenSourceUiReferenceAuditArgs,
  runOpenSourceUiReferenceAuditCli,
} from '../scripts/open-source-ui-reference-cli.mjs'

test('open-source UI reference CLI parses Pro workflow aliases', () => {
  const parsed = parseOpenSourceUiReferenceAuditArgs([
    '--surface=image4-presence',
    '--format=pro-send-payload',
    '--pro-answer-quality',
    '--paradigms',
    '--review-runbook',
    '--next-review',
    '--registry-state-guide',
    '--question-matrix',
    '--implementation-brief',
    '--implementation-readiness',
    '--implementation-status',
    '--reference-refresh-check',
    '--pro-review-queue',
    '--pro-transition=sent',
    '--json',
  ])

  assert.equal(parsed.json, true)
  assert.equal(parsed.options.surface, 'image4-presence')
  assert.equal(parsed.options.proSendPayload, true)
  assert.equal(parsed.options.proAnswerQuality, true)
  assert.equal(parsed.options.patternComparison, true)
  assert.equal(parsed.options.reviewRunbook, true)
  assert.equal(parsed.options.nextProReview, true)
  assert.equal(parsed.options.stateGuide, true)
  assert.equal(parsed.options.questionMatrix, true)
  assert.equal(parsed.options.implementationBrief, true)
  assert.equal(parsed.options.implementationReadiness, true)
  assert.equal(parsed.options.implementationStatus, true)
  assert.equal(parsed.options.referenceRefreshCheck, true)
  assert.equal(parsed.options.queue, true)
  assert.equal(parsed.options.proRegistryTransition, 'sent')
})

test('open-source UI reference CLI selects requested non-json output first', () => {
  const report = {
    summary: { ok: true },
    proSendPayload: 'payload',
    proHandoffPackage: 'handoff',
  }

  assert.equal(
    formatRequestedOutput(report, { proSendPayload: true, json: true }, () => 'human'),
    'payload',
  )
  assert.equal(
    formatRequestedOutput({
      summary: { ok: true },
      proAnswerQualityChecklist: 'quality',
    }, { proAnswerQuality: true }, () => 'human'),
    'quality',
  )
  assert.equal(
    formatRequestedOutput(report, { json: true }, () => 'human'),
    JSON.stringify(report, null, 2),
  )
  assert.equal(
    formatRequestedOutput({ summary: { ok: true }, implementationBrief: 'brief' }, { implementationBrief: true }, () => 'human'),
    'brief',
  )
  assert.match(
    formatRequestedOutput({
      summary: { ok: false },
      implementationReadiness: {
        surface: 'composer',
        ok: false,
        status: 'not-sent',
        decision: 'pending',
        nextAction: 'Ask Pro first.',
        requirements: [],
        commands: {},
      },
    }, { implementationReadiness: true }, () => 'human'),
    /Implementation readiness: composer/,
  )
  assert.match(
    formatRequestedOutput({
      summary: { ok: true },
      referenceRefreshCheck: {
        checkedAt: '2026-06-29',
        manualOnly: true,
        liveNetwork: true,
        total: 2,
        changedCount: 1,
        unchangedCount: 1,
        failedCount: 0,
        items: [
          {
            name: 'Chatbox',
            observedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            currentCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            status: 'changed',
          },
          {
            name: 'Open WebUI',
            observedCommit: 'cccccccccccccccccccccccccccccccccccccccc',
            currentCommit: 'cccccccccccccccccccccccccccccccccccccccc',
            status: 'unchanged',
          },
        ],
      },
    }, { referenceRefreshCheck: true }, () => 'human'),
    /changed Chatbox/,
  )
  assert.match(
    formatRequestedOutput({
      summary: { ok: false },
      referenceRefreshCheck: {
        checkedAt: '2026-06-29',
        manualOnly: true,
        liveNetwork: true,
        total: 1,
        changedCount: 0,
        unchangedCount: 0,
        failedCount: 1,
        items: [
          {
            name: 'Open WebUI',
            status: 'failed',
            error: 'network unavailable',
          },
        ],
      },
    }, { referenceRefreshCheck: true, json: true }, () => 'human'),
    /failed Open WebUI: network unavailable/,
  )
  assert.match(
    formatRequestedOutput({
      summary: { ok: true },
      implementationStatus: {
        completeProQueue: true,
        readyCount: 1,
        totalCount: 1,
        items: [{
          surface: 'composer',
          priority: 1,
          phase: 'Input control system',
          focus: 'Composer focus.',
          status: 'recorded',
          decision: 'accepted',
          nextAction: 'Implement locally.',
          commands: {
            implementationReadiness: 'npm run ui:references:audit -- --surface=composer --implementation-readiness',
            implementationBrief: 'npm run ui:references:audit -- --surface=composer --implementation-brief',
            localCheck: 'npm run composer:surface:audit',
          },
        }],
      },
    }, { implementationStatus: true }, () => 'human'),
    /0\.4 UI implementation status/,
  )
  assert.match(
    formatRequestedOutput({
      summary: { ok: true },
      reviewQueue: [{
        surface: 'composer',
        priority: 1,
        phase: 'Input control system',
        focus: 'Composer focus.',
        whyNow: 'Composer is next.',
        references: ['Chatbox'],
        proHandoffCommand: 'npm run ui:references:audit -- --surface=composer --pro-handoff',
        intakeTemplateCommand: 'npm run ui:references:audit -- --surface=composer --review-intake-template',
        recordTemplateCommand: 'npm run ui:references:audit -- --surface=composer --record-template',
        firstLocalCommand: 'npm run composer:surface:audit',
        browserCheck: 'Compare composers.',
      }],
      proReviewRegistry: {
        status: [{ surface: 'composer', status: 'not-sent', decision: 'pending' }],
      },
    }, { reviewRunbook: true }, () => 'human'),
    /Nexus 0\.4 UI Pro Review Runbook/,
  )
})

test('open-source UI reference CLI writes one trailing newline', () => {
  const writes = []
  const report = { summary: { ok: true }, proSendPayload: 'payload' }
  const returnedReport = runOpenSourceUiReferenceAuditCli(['--pro-send-payload'], {
    root: '/tmp/nexus',
    buildReport: () => report,
    formatHumanReport: () => 'human',
    write: (text) => writes.push(text),
  })

  assert.equal(returnedReport, report)
  assert.deepEqual(writes, ['payload\n'])
})
