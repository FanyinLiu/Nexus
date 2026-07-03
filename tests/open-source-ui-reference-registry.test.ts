import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildProReviewRegistryTransition,
  buildProReviewStateGuide,
  findProReviewRegistryIssues,
  formatProReviewRegistryTransition,
  formatProReviewStateGuide,
} from '../scripts/open-source-ui-reference-registry.mjs'

const SURFACE = 'image4-presence'

const SURFACE_COVERAGE = [{ surface: SURFACE }]

const REVIEW_QUEUE = [{
  surface: SURFACE,
  proHandoffCommand: 'npm run ui:references:audit -- --surface=image4-presence --pro-handoff',
  answerQualityCommand: 'npm run ui:references:audit -- --surface=image4-presence --pro-answer-quality',
  intakeTemplateCommand: 'npm run ui:references:audit -- --surface=image4-presence --review-intake-template',
  recordTemplateCommand: 'npm run ui:references:audit -- --surface=image4-presence --record-template',
  implementationReadinessCommand: 'npm run ui:references:audit -- --surface=image4-presence --implementation-readiness',
  firstLocalCommand: 'npm run image4:visual-contract:audit',
}]

function buildRegistryEntry(status, decision) {
  return {
    surface: SURFACE,
    status,
    decision,
    nextAction: 'Follow the local Pro review state guide.',
    commands: {
      handoff: REVIEW_QUEUE[0].proHandoffCommand,
      quality: REVIEW_QUEUE[0].answerQualityCommand,
      intake: REVIEW_QUEUE[0].intakeTemplateCommand,
      record: REVIEW_QUEUE[0].recordTemplateCommand,
      implementation: REVIEW_QUEUE[0].implementationReadinessCommand,
      check: REVIEW_QUEUE[0].firstLocalCommand,
    },
  }
}

function buildRegistry(status, decision) {
  return {
    schemaVersion: 1,
    lastUpdated: '2026-06-28',
    policy: {
      statusSource: 'local-review-registry',
      doesNotStoreProResponse: true,
      doesNotStoreSecrets: true,
      requiresAnswerQualityBeforeIntake: true,
      requiresIntakeBeforeImplementation: true,
      requiresImplementationReadinessBeforeCodeChange: true,
    },
    surfaces: [buildRegistryEntry(status, decision)],
  }
}

test('Pro review state guide names every registry state and command path', () => {
  const guide = buildProReviewStateGuide()
  const formatted = formatProReviewStateGuide(guide)

  assert.deepEqual(
    guide.map((item) => item.status),
    ['not-sent', 'sent', 'intake-needed', 'needs-follow-up', 'accepted-for-prototype', 'rejected', 'recorded'],
  )
  assert.ok(guide.every((item) => item.allowedDecision.includes(item.decision)))
  assert.match(formatted, /not-sent\/pending/)
  assert.match(formatted, /needs-follow-up\/ask-follow-up/)
  assert.match(formatted, /accepted-for-prototype\/needs-prototype/)
  assert.match(formatted, /npm run ui:references:audit -- --surface=<surface> --pro-handoff/)
})

test('Pro review registry accepts every state guide status and decision pair', () => {
  for (const item of buildProReviewStateGuide()) {
    const issues = findProReviewRegistryIssues(
      buildRegistry(item.status, item.decision),
      SURFACE_COVERAGE,
      REVIEW_QUEUE,
    )

    assert.deepEqual(issues, [])
  }
})

test('Pro review registry rejects state guide decision drift', () => {
  const issues = findProReviewRegistryIssues(
    buildRegistry('accepted-for-prototype', 'accepted'),
    SURFACE_COVERAGE,
    REVIEW_QUEUE,
  )

  assert.ok(issues.some((item) => (
    item.path === 'surfaces[0].decision'
      && item.issue === 'status/decision mismatch'
  )))
})

test('Pro review registry transition formats a no-write sent update', () => {
  const transition = buildProReviewRegistryTransition({
    surface: SURFACE,
    status: 'not-sent',
    decision: 'pending',
    nextAction: 'Generate the handoff package.',
  }, 'sent')
  const formatted = formatProReviewRegistryTransition(transition)

  assert.equal(transition.ok, true)
  assert.equal(transition.file, 'docs/open-source-ui-pro-review-registry.json')
  assert.equal(transition.pathHint, 'surfaces[?surface=image4-presence]')
  assert.equal(transition.to.status, 'sent')
  assert.equal(transition.to.decision, 'pending')
  assert.deepEqual(transition.entryPatch, {
    surface: SURFACE,
    status: 'sent',
    decision: 'pending',
    nextAction: 'Wait for Pro response, then generate the intake template before implementation.',
  })
  assert.match(formatted, /from: not-sent\/pending/)
  assert.match(formatted, /to: sent\/pending/)
  assert.match(formatted, /dry-run: true/)
  assert.match(formatted, /file: docs\/open-source-ui-pro-review-registry\.json/)
  assert.match(formatted, /"status": "sent"/)
  assert.match(formatted, /"decision": "pending"/)
  assert.match(formatted, /do not store Pro response text/)
})

test('Pro review registry transition rejects unknown target statuses', () => {
  const transition = buildProReviewRegistryTransition({ surface: SURFACE }, 'done')

  assert.equal(transition.ok, false)
  assert.equal(transition.issue, 'unknown target status')
})
