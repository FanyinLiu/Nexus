import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { buildOpenSourceUiReferenceAuditReport } from '../scripts/open-source-ui-reference-audit.mjs'
import {
  buildImplementationReadiness,
  buildProReviewBatchRunbook,
  buildProReviewReadiness,
  formatImplementationReadiness,
  formatImplementationStatus,
  formatProQuestionMatrix,
  formatProReviewReadiness,
} from '../scripts/open-source-ui-reference-pro-workflow.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('open-source UI reference audit reports companion-tone as the next prototype Pro review', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, { nextProReview: true, proReadiness: true })
  const formatted = formatProReviewReadiness(report.proReviewReadiness)

  assert.equal(report.summary.ok, true)
  assert.equal(report.nextProReview?.surface, 'companion-tone')
  assert.equal(report.nextProReview?.status, 'accepted-for-prototype')
  assert.equal(report.nextProReview?.decision, 'needs-prototype')
  assert.equal(report.proReviewReadiness?.ok, true)
  assert.equal(report.proReviewReadiness?.surface, 'companion-tone')
  assert.equal(report.proReviewReadiness?.status, 'accepted-for-prototype')
  assert.match(formatted ?? '', /Pro review readiness: companion-tone/)
  assert.match(formatted ?? '', /referenceRefresh: npm run ui:references:audit -- --reference-refresh-check/)
  assert.match(formatted ?? '', /sendPayload: npm run ui:references:audit -- --surface=companion-tone --pro-send-payload/)
})

test('open-source UI reference audit still builds a focused agent-activity Pro send payload', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    proSendPayload: true,
  })

  assert.equal(report.summary.ok, true)
  assert.match(report.proSendPayload ?? '', /# Nexus Pro Send Payload: agent-activity/)
  assert.match(report.proSendPayload ?? '', /## Copy Only This To Pro/)
  assert.match(report.proSendPayload ?? '', /本次 surface：agent-activity/)
  assert.match(report.proSendPayload ?? '', /OpenHands/)
  assert.match(report.proSendPayload ?? '', /Companion activity boundaries/)
  assert.match(report.proSendPayload ?? '', /## Before Browser Send/)
  assert.match(report.proSendPayload ?? '', /Confirm with the user before clicking Send/)
  assert.match(report.proSendPayload ?? '', /Do not update the registry while this payload has only been generated locally/)
  assert.match(report.proSendPayload ?? '', /manual reference freshness check/)
  assert.match(report.proSendPayload ?? '', /npm run ui:references:audit -- --reference-refresh-check/)
  assert.match(report.proSendPayload ?? '', /not a default CI or release gate/)
  assert.match(report.proSendPayload ?? '', /Set status\/decision to `sent`\/`pending`/)
  assert.match(report.proSendPayload ?? '', /--surface=agent-activity --pro-registry-transition=sent/)
  assert.match(report.proSendPayload ?? '', /review-intake-template/)
  assert.doesNotMatch(report.proSendPayload ?? '', /# Pro Review Record:/)
  assert.doesNotMatch(report.proSendPayload ?? '', /API key|password/i)
})

test('open-source UI reference audit honors focused surface for Pro readiness', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    proReadiness: true,
  })
  const formatted = formatProReviewReadiness(report.proReviewReadiness)

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'agent-activity')
  assert.equal(report.proReviewReadiness?.surface, 'agent-activity')
  assert.equal(report.proReviewReadiness?.status, 'recorded')
  assert.match(report.proReviewReadiness?.commands.handoff ?? '', /--surface=agent-activity --pro-handoff/)
  assert.match(formatted ?? '', /OpenHands/)
  assert.match(formatted ?? '', /Cline/)
  assert.match(formatted ?? '', /LibreChat/)
})

test('open-source UI reference audit honors focused surface for Pro send payload', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    proSendPayload: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'agent-activity')
  assert.match(report.proSendPayload ?? '', /# Nexus Pro Send Payload: agent-activity/)
  assert.match(report.proSendPayload ?? '', /本次 surface：agent-activity/)
  assert.match(report.proSendPayload ?? '', /OpenHands/)
  assert.match(report.proSendPayload ?? '', /Cline/)
  assert.match(report.proSendPayload ?? '', /LibreChat/)
  assert.match(report.proSendPayload ?? '', /Send only the prompt under "Copy Only This To Pro"/)
  assert.doesNotMatch(report.proSendPayload ?? '', /image4-presence/)
})

test('open-source UI reference audit builds companion-tone Pro send payload with color-state boundaries', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'companion-tone',
    proSendPayload: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'companion-tone')
  assert.match(report.proSendPayload ?? '', /# Nexus Pro Send Payload: companion-tone/)
  assert.match(report.proSendPayload ?? '', /## Before Browser Send/)
  assert.match(report.proSendPayload ?? '', /Confirm with the user before clicking Send/)
  assert.match(report.proSendPayload ?? '', /This output is a pre-send payload, not proof that Pro has been asked/)
  assert.match(report.proSendPayload ?? '', /本次 surface：companion-tone/)
  assert.match(report.proSendPayload ?? '', /晨光、白天、夜间三档陪伴色/)
  assert.match(report.proSendPayload ?? '', /不能默认偏黑或偏冷/)
  assert.match(report.proSendPayload ?? '', /研究锚点/)
  assert.match(report.proSendPayload ?? '', /positive low-arousal comfort and relaxation/)
  assert.match(report.proSendPayload ?? '', /Peach\/apricot should stay a restrained warmth accent/)
  assert.match(report.proSendPayload ?? '', /W3C non-text contrast guidance keeps embedded plus, mic, send-ready, focus, and speaking cues legible/)
  assert.match(report.proSendPayload ?? '', /Morning warmth, daytime calm, and night low-light/)
  assert.match(report.proSendPayload ?? '', /Sampling reference palettes/)
  assert.match(report.proSendPayload ?? '', /Do not update the registry while this payload has only been generated locally/)
  assert.match(report.proSendPayload ?? '', /npm run ui:references:audit -- --reference-refresh-check/)
  assert.match(report.proSendPayload ?? '', /not a default CI or release gate/)
  assert.match(report.proSendPayload ?? '', /--surface=companion-tone --pro-registry-transition=sent/)
  assert.doesNotMatch(report.proSendPayload ?? '', /API key|password/i)
})

test('open-source UI reference audit builds companion-tone Pro answer quality checklist', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'companion-tone',
    proAnswerQuality: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'companion-tone')
  assert.match(report.proAnswerQualityChecklist ?? '', /# Pro Answer Quality Checklist: companion-tone/)
  assert.match(report.proAnswerQualityChecklist ?? '', /晨光、白天、夜间三档陪伴色/)
  assert.match(report.proAnswerQualityChecklist ?? '', /不能默认偏黑或偏冷/)
  assert.match(report.proAnswerQualityChecklist ?? '', /The answer explicitly responds to every research anchor/)
  assert.match(report.proAnswerQualityChecklist ?? '', /It ignores or contradicts any research anchor listed below/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Research anchors that must be answered:/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Research anchors:/)
  assert.match(report.proAnswerQualityChecklist ?? '', /positive low-arousal comfort and relaxation/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Morning warmth, daytime calm, and night low-light/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Sampling reference palettes/)
  assert.match(report.proAnswerQualityChecklist ?? '', /npm run image4:color:audit/)
  assert.match(report.proAnswerQualityChecklist ?? '', /generic, skin-copying, or identity-breaking/)
  assert.doesNotMatch(report.proAnswerQualityChecklist ?? '', /API key|password/i)
})

test('open-source UI reference audit builds companion-tone intake with research anchor response slots', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'companion-tone',
    intakeTemplate: true,
    implementationBrief: true,
  })

  assert.equal(report.summary.ok, true)
  assert.match(report.proReviewIntakeTemplate ?? '', /# Pro Review Intake: companion-tone/)
  assert.match(report.proReviewIntakeTemplate ?? '', /## Research Anchor Response/)
  assert.match(report.proReviewIntakeTemplate ?? '', /Anchor: Color-emotion research supports a light warm base/)
  assert.match(report.proReviewIntakeTemplate ?? '', /Pro response:/)
  assert.match(report.proReviewIntakeTemplate ?? '', /Accept \/ reject \/ ask follow-up:/)
  assert.match(report.implementationBrief ?? '', /Every accepted recommendation must answer the research anchors recorded in the intake/)
})

test('open-source UI reference audit builds a Pro answer quality checklist for a focused surface', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'composer',
    proAnswerQuality: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'composer')
  assert.match(report.proAnswerQualityChecklist ?? '', /# Pro Answer Quality Checklist: composer/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Pass requirements:/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Reject or ask follow-up if:/)
  assert.match(report.proAnswerQualityChecklist ?? '', /copying exact layout/)
  assert.match(report.proAnswerQualityChecklist ?? '', /composer 应该更像 intent gateway/)
  assert.match(report.proAnswerQualityChecklist ?? '', /内嵌工具默认无底板/)
  assert.match(report.proAnswerQualityChecklist ?? '', /LibreChat/)
  assert.match(report.proAnswerQualityChecklist ?? '', /ChatGPT-like/)
  assert.match(report.proAnswerQualityChecklist ?? '', /npm run composer:surface:audit/)
  assert.doesNotMatch(report.proAnswerQualityChecklist ?? '', /API key|password/i)
})

test('open-source UI reference audit builds focused agent-activity Pro answer quality checklist', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    proAnswerQuality: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'agent-activity')
  assert.match(report.proAnswerQualityChecklist ?? '', /# Pro Answer Quality Checklist: agent-activity/)
  assert.match(report.proAnswerQualityChecklist ?? '', /OpenHands/)
  assert.match(report.proAnswerQualityChecklist ?? '', /Cline/)
  assert.match(report.proAnswerQualityChecklist ?? '', /桌面感知触发陪伴/)
})

test('implementation readiness allows the bounded companion-tone prototype', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'companion-tone',
    implementationReadiness: true,
  })
  const formatted = formatImplementationReadiness(report.implementationReadiness)

  assert.equal(report.summary.ok, true)
  assert.equal(report.implementationReadiness?.ok, true)
  assert.equal(report.implementationReadiness?.status, 'accepted-for-prototype')
  assert.equal(report.implementationReadiness?.decision, 'needs-prototype')
  assert.match(formatted ?? '', /Implementation readiness: companion-tone/)
  assert.match(formatted ?? '', /pro-intake-decision-ready: ok/)
  assert.match(formatted ?? '', /bounded prototype only/)
  assert.match(formatted ?? '', /npm run ui:references:audit -- --surface=companion-tone --pro-answer-quality/)
  assert.match(formatted ?? '', /npm run image4:color:audit/)
})

test('open-source UI reference audit builds an all-surface Pro question matrix', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, { questionMatrix: true })
  const formatted = formatProQuestionMatrix(report.proQuestionMatrix)
  const composer = report.proQuestionMatrix?.surfaces.find((surface) => surface.surface === 'composer')

  assert.equal(report.summary.ok, true)
  assert.equal(report.proQuestionMatrix?.surfaces.length, 10)
  assert.equal(composer?.status, 'recorded')
  const companionTone = report.proQuestionMatrix?.surfaces.find((surface) => surface.surface === 'companion-tone')
  assert.equal(companionTone?.status, 'accepted-for-prototype')
  assert.ok(companionTone?.axes.includes('companion-tone'))
  assert.ok(companionTone?.questions.some((question) => question.includes('warm-day')))
  assert.ok(companionTone?.questions.some((question) => question.includes('晨光、白天、夜间三档陪伴色')))
  assert.ok(companionTone?.questions.some((question) => question.includes('不能默认偏黑或偏冷')))
  assert.ok(composer?.axes.includes('composer-state'))
  assert.ok(composer?.axes.includes('conversation-product-boundaries'))
  assert.ok(composer?.questions.some((question) => question.includes('麦克风')))
  assert.ok(composer?.questions.some((question) => question.includes('无底板')))
  assert.ok(composer?.questions.some((question) => question.includes('LibreChat')))
  assert.match(formatted ?? '', /Pro critical question matrix/)
  assert.match(formatted ?? '', /composer-state/)
  assert.match(formatted ?? '', /conversation-product-boundaries/)
  assert.match(formatted ?? '', /npm run ui:references:audit -- --surface=composer --pro-handoff/)
  assert.match(formatted ?? '', /By paradigm axis:/)
  assert.doesNotMatch(formatted ?? '', /API key|password/i)
})

test('open-source UI reference audit builds a 0.4 UI review runbook', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, { reviewRunbook: true })
  const runbook = buildProReviewBatchRunbook({
    reviewQueue: report.reviewQueue,
    registryStatus: report.proReviewRegistry.status,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.reviewQueue.length, 10)
  assert.match(runbook, /# Nexus 0\.4 UI Pro Review Runbook/)
  assert.match(runbook, /1\. image4-presence \(recorded\/accepted\)/)
  assert.match(runbook, /2\. dial \(recorded\/accepted\)/)
  assert.match(runbook, /3\. companion-tone \(accepted-for-prototype\/needs-prototype\)/)
  assert.match(runbook, /4\. composer \(recorded\/accepted\)/)
  assert.match(runbook, /5\. chat \(recorded\/accepted\)/)
  assert.match(runbook, /6\. settings \(recorded\/accepted\)/)
  assert.match(runbook, /7\. forms \(recorded\/accepted\)/)
  assert.match(runbook, /8\. focus-management \(recorded\/accepted\)/)
  assert.match(runbook, /9\. streaming \(recorded\/accepted\)/)
  assert.match(runbook, /10\. agent-activity \(recorded\/accepted\)/)
  assert.match(runbook, /Reference freshness: npm run ui:references:audit -- --reference-refresh-check/)
  assert.match(runbook, /keep it out of default CI and release gates/)
  assert.match(runbook, /Pre-send payload: npm run ui:references:audit -- --surface=companion-tone --pro-send-payload/)
  assert.match(runbook, /External send: paste only the send payload after user confirmation/)
  assert.match(runbook, /Mark sent: npm run ui:references:audit -- --surface=agent-activity --pro-registry-transition=sent/)
  assert.match(runbook, /Answer quality: npm run ui:references:audit -- --surface=agent-activity --pro-answer-quality/)
  assert.match(runbook, /Implementation gate: npm run ui:references:audit -- --surface=agent-activity --implementation-readiness/)
  assert.match(runbook, /Do not store Pro response text/)
  assert.doesNotMatch(runbook, /API key|password/i)
})

test('open-source UI reference audit builds a post-Pro implementation status', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, { implementationStatus: true })
  const formatted = formatImplementationStatus(report.implementationStatus)

  assert.equal(report.summary.ok, true)
  assert.equal(report.implementationStatus?.completeProQueue, true)
  assert.equal(report.implementationStatus?.readyCount, 10)
  assert.equal(report.implementationStatus?.totalCount, 10)
  assert.match(formatted ?? '', /0\.4 UI implementation status/)
  assert.match(formatted ?? '', /Pro queue complete: true/)
  assert.match(formatted ?? '', /1\. image4-presence \(recorded\/accepted\)/)
  assert.match(formatted ?? '', /3\. companion-tone \(accepted-for-prototype\/needs-prototype\)/)
  assert.match(formatted ?? '', /4\. composer \(recorded\/accepted\)/)
  assert.match(formatted ?? '', /gate: npm run ui:references:audit -- --surface=composer --implementation-readiness/)
  assert.match(formatted ?? '', /brief: npm run ui:references:audit -- --surface=agent-activity --implementation-brief/)
  assert.match(formatted ?? '', /check: npm run agent-activity:surface:audit/)
})

test('open-source UI reference audit builds surface-specific Pro registry transitions', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    proRegistryTransition: 'sent',
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.proReviewRegistryTransition?.surface, 'agent-activity')
  assert.equal(report.proReviewRegistryTransition?.from.status, 'recorded')
  assert.equal(report.proReviewRegistryTransition?.to.status, 'sent')
  assert.deepEqual(report.proReviewRegistryTransition?.entryPatch, {
    surface: 'agent-activity',
    status: 'sent',
    decision: 'pending',
    nextAction: 'Wait for Pro response, then generate the intake template before implementation.',
  })
})

test('open-source UI reference audit builds a focused agent-activity implementation brief', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    implementationBrief: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'agent-activity')
  assert.match(report.implementationBrief ?? '', /# Nexus UI Implementation Brief: agent-activity/)
  assert.match(report.implementationBrief ?? '', /Do not implement from a raw Pro answer alone/)
  assert.match(report.implementationBrief ?? '', /Accepted-pattern slots:/)
  assert.match(report.implementationBrief ?? '', /Review Nexus while idle/)
  assert.doesNotMatch(report.implementationBrief ?? '', /API key|password/i)
})

test('open-source UI reference audit builds a focused composer implementation brief', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'composer',
    implementationBrief: true,
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.surfaceReview?.surface, 'composer')
  assert.match(report.implementationBrief ?? '', /Chatbox/)
  assert.match(report.implementationBrief ?? '', /intent gateway/)
  assert.match(report.implementationBrief ?? '', /embedded tools/)
  assert.match(report.implementationBrief ?? '', /npm run composer:surface:audit/)
  assert.match(report.implementationBrief ?? '', /hover or focus/)
  assert.match(report.implementationBrief ?? '', /Compare normal chat composer and Image4 composer alignment/)
})

test('open-source UI reference audit allows implementation readiness after agent-activity is recorded', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    surface: 'agent-activity',
    implementationReadiness: true,
  })
  const formatted = formatImplementationReadiness(report.implementationReadiness)

  assert.equal(report.summary.ok, true)
  assert.equal(report.implementationReadiness?.ok, true)
  assert.equal(report.implementationReadiness?.status, 'recorded')
  assert.match(formatted ?? '', /Implementation readiness: agent-activity/)
  assert.match(formatted ?? '', /pro-intake-decision-ready: ok/)
  assert.match(formatted ?? '', /answer-quality-check-ready: ok/)
  assert.match(formatted ?? '', /implementation-gate-command-ready: ok/)
  assert.match(formatted ?? '', /answerQuality: npm run ui:references:audit -- --surface=agent-activity --pro-answer-quality/)
  assert.match(formatted ?? '', /implementationReadiness: npm run ui:references:audit -- --surface=agent-activity --implementation-readiness/)
})

test('implementation readiness allows accepted prototype states', () => {
  const readiness = buildImplementationReadiness({
    surfaceReview: { surface: 'composer', ok: true, references: [{ name: 'Chatbox' }, { name: 'Vercel AI Chatbot' }], minReferences: 2 },
    surfaceEvidence: { docs: ['docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md'], commands: ['npm run composer:surface:audit'], browserChecks: ['Compare composers.'] },
    surfacePatterns: { surface: 'composer', patterns: [{ reference: 'Chatbox' }] },
    registryStatus: {
      surface: 'composer',
      status: 'accepted-for-prototype',
      decision: 'needs-prototype',
      nextAction: 'Prototype only the smallest surface-scoped change.',
      commands: {
        quality: 'npm run ui:references:audit -- --surface=composer --pro-answer-quality',
        implementation: 'npm run ui:references:audit -- --surface=composer --implementation-readiness',
      },
    },
  })

  assert.equal(readiness.ok, true)
  assert.equal(readiness.commands.implementationBrief, 'npm run ui:references:audit -- --surface=composer --implementation-brief')
  assert.deepEqual(readiness.issues, [])
})

test('implementation readiness rejects surfaces without answer quality and gate commands', () => {
  const readiness = buildImplementationReadiness({
    surfaceReview: { surface: 'composer', ok: true, references: [{ name: 'Chatbox' }, { name: 'Vercel AI Chatbot' }], minReferences: 2 },
    surfaceEvidence: { docs: ['docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md'], commands: ['npm run composer:surface:audit'], browserChecks: ['Compare composers.'] },
    surfacePatterns: { surface: 'composer', patterns: [{ reference: 'Chatbox' }] },
    registryStatus: {
      surface: 'composer',
      status: 'recorded',
      decision: 'accepted',
      nextAction: 'Keep the bounded record.',
      commands: {
        quality: 'npm run ui:references:audit -- --surface=composer --questions',
      },
    },
  })

  assert.equal(readiness.ok, false)
  assert.ok(readiness.issues.some((issue) => issue.issue === 'answer-quality-check-ready'))
  assert.ok(readiness.issues.some((issue) => issue.issue === 'implementation-gate-command-ready'))
})

test('Pro readiness reports missing pre-send materials', () => {
  const readiness = buildProReviewReadiness({
    nextProReview: { surface: 'composer', status: 'not-sent', decision: 'pending' },
    surfaceReview: { surface: 'composer', ok: true, references: [], minReferences: 2 },
    surfaceEvidence: null,
    surfaceQuestions: null,
    surfacePatterns: { surface: 'composer', patterns: [] },
    patternComparison: { surfaces: [], references: [], guardrails: [] },
  })

  assert.equal(readiness.ok, false)
  assert.ok(readiness.issues.some((issue) => issue.issue === 'surface-review-ready'))
  assert.ok(readiness.issues.some((issue) => issue.issue === 'evidence-ready'))
  assert.ok(readiness.issues.some((issue) => issue.issue === 'questions-ready'))
  assert.ok(readiness.issues.some((issue) => issue.issue === 'patterns-ready'))
  assert.ok(readiness.issues.some((issue) => issue.issue === 'comparison-ready'))
})
