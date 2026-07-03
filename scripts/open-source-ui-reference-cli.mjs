import { formatPatternComparison, formatSurfacePatterns } from './open-source-ui-reference-patterns.mjs'
import {
  formatImplementationReadiness,
  formatImplementationStatus,
  buildProReviewBatchRunbook,
  formatProQuestionMatrix,
  formatProReviewReadiness,
  formatSurfaceQuestions,
} from './open-source-ui-reference-pro-workflow.mjs'
import {
  formatNextProReview,
  formatProReviewRegistryTransition,
  formatProReviewStateGuide,
} from './open-source-ui-reference-registry.mjs'

export function getArgValue(argv, name) {
  const prefix = `--${name}=`
  const inlineArg = argv.find((arg) => arg.startsWith(prefix))
  if (inlineArg) return inlineArg.slice(prefix.length)

  const argIndex = argv.indexOf(`--${name}`)
  if (argIndex >= 0) return argv[argIndex + 1] ?? ''
  return null
}

export function parseOpenSourceUiReferenceAuditArgs(argv) {
  const proHandoff = argv.includes('--pro-handoff')
    || argv.includes('--handoff')
    || argv.includes('--format=pro-handoff')
  const questions = argv.includes('--questions')
    || argv.includes('--pro-questions')
    || argv.includes('--format=questions')
  const patterns = argv.includes('--patterns')
    || argv.includes('--pattern-matrix')
    || argv.includes('--format=patterns')
  const intakeTemplate = argv.includes('--review-intake-template')
    || argv.includes('--intake-template')
    || argv.includes('--format=review-intake-template')
  const recordTemplate = argv.includes('--record-template')
    || argv.includes('--pro-record-template')
    || argv.includes('--format=record-template')
  const nextProReview = argv.includes('--next-pro-review')
    || argv.includes('--next-review')
    || argv.includes('--format=next-pro-review')
  const nextProHandoff = argv.includes('--next-pro-handoff')
    || argv.includes('--next-handoff')
    || argv.includes('--format=next-pro-handoff')
  const stateGuide = argv.includes('--pro-review-state-guide')
    || argv.includes('--registry-state-guide')
    || argv.includes('--format=pro-review-state-guide')
  const proReadiness = argv.includes('--pro-readiness')
    || argv.includes('--next-pro-readiness')
    || argv.includes('--format=pro-readiness')
  const proSendPayload = argv.includes('--pro-send-payload')
    || argv.includes('--next-pro-send-payload')
    || argv.includes('--format=pro-send-payload')
  const proAnswerQuality = argv.includes('--pro-answer-quality')
    || argv.includes('--answer-quality')
    || argv.includes('--format=pro-answer-quality')
  const questionMatrix = argv.includes('--question-matrix')
    || argv.includes('--pro-question-matrix')
    || argv.includes('--critical-question-matrix')
    || argv.includes('--format=question-matrix')
  const reviewRunbook = argv.includes('--review-runbook')
    || argv.includes('--batch-runbook')
    || argv.includes('--v04-ui-review-runbook')
    || argv.includes('--format=review-runbook')
  const implementationBrief = argv.includes('--implementation-brief')
    || argv.includes('--implement-brief')
    || argv.includes('--format=implementation-brief')
  const implementationReadiness = argv.includes('--implementation-readiness')
    || argv.includes('--implement-readiness')
    || argv.includes('--format=implementation-readiness')
  const implementationStatus = argv.includes('--implementation-status')
    || argv.includes('--implementation-queue')
    || argv.includes('--post-pro-status')
    || argv.includes('--format=implementation-status')
  const referenceRefreshCheck = argv.includes('--reference-refresh-check')
    || argv.includes('--live-reference-check')
    || argv.includes('--format=reference-refresh-check')
  const proRegistryTransition = getArgValue(argv, 'pro-registry-transition')
    ?? getArgValue(argv, 'pro-transition')
    ?? (argv.includes('--mark-pro-sent') ? 'sent' : null)

  return {
    json: argv.includes('--json') || argv.includes('--format=json'),
    options: {
      surface: getArgValue(argv, 'surface'),
      proPrompt: argv.includes('--pro-prompt') || argv.includes('--format=pro-prompt'),
      proHandoff,
      evidence: argv.includes('--evidence') || argv.includes('--format=evidence'),
      queue: argv.includes('--queue') || argv.includes('--review-queue') || argv.includes('--pro-review-queue') || argv.includes('--format=queue'),
      questions,
      patterns,
      patternComparison: argv.includes('--pattern-comparison')
        || argv.includes('--all-patterns')
        || argv.includes('--paradigms')
        || argv.includes('--reference-paradigms')
        || argv.includes('--format=pattern-comparison'),
      intakeTemplate,
      recordTemplate,
      nextProReview,
      nextProHandoff,
      stateGuide,
      proReadiness,
      proSendPayload,
      proAnswerQuality,
      questionMatrix,
      reviewRunbook,
      implementationBrief,
      implementationReadiness,
      implementationStatus,
      referenceRefreshCheck,
      proRegistryTransition,
    },
  }
}

export function formatReferenceRefreshCheck(refreshCheck) {
  if (!refreshCheck) return null

  const lines = ['Open-source UI reference refresh check']
  lines.push(`- checked at: ${refreshCheck.checkedAt}`)
  lines.push('- manual only: true')
  lines.push('- live network: true')
  lines.push(`- references: ${refreshCheck.total}`)
  lines.push(`- changed: ${refreshCheck.changedCount}`)
  lines.push(`- unchanged: ${refreshCheck.unchangedCount}`)
  lines.push(`- failed: ${refreshCheck.failedCount}`)
  lines.push('')
  lines.push('This command reports GitHub head drift only. It does not update files, and it must not be added to CI or release gates.')
  lines.push('')
  lines.push('Results:')

  for (const item of refreshCheck.items) {
    if (item.status === 'changed') {
      lines.push(`- changed ${item.name}: ${item.observedCommit} -> ${item.currentCommit}`)
    } else if (item.status === 'failed') {
      lines.push(`- failed ${item.name}: ${item.error}`)
    } else {
      lines.push(`- unchanged ${item.name}: ${item.currentCommit}`)
    }
  }

  if (refreshCheck.changedCount > 0) {
    lines.push('')
    lines.push('Manual next step: update docs/open-source-ui-reference-manifest.json and the Remote Head Evidence table together, then run npm run ui:references:audit.')
  }

  return lines.join('\n')
}

export function formatRequestedOutput(report, flags, formatHumanReport) {
  if (flags.referenceRefreshCheck && report.referenceRefreshCheck) {
    return formatReferenceRefreshCheck(report.referenceRefreshCheck)
  }
  if ((flags.proHandoff || flags.nextProHandoff) && report.summary.ok && report.proHandoffPackage) {
    return report.proHandoffPackage
  }
  if (flags.proSendPayload && report.summary.ok && report.proSendPayload) return report.proSendPayload
  if (flags.proAnswerQuality && report.summary.ok && report.proAnswerQualityChecklist) {
    return report.proAnswerQualityChecklist
  }
  if (flags.intakeTemplate && report.summary.ok && report.proReviewIntakeTemplate) {
    return report.proReviewIntakeTemplate
  }
  if (flags.recordTemplate && report.summary.ok && report.proRecordTemplate) return report.proRecordTemplate
  if (flags.proPrompt && report.summary.ok && report.proPrompt) return report.proPrompt
  if (flags.questions && report.summary.ok && report.surfaceQuestions) {
    return formatSurfaceQuestions(report.surfaceQuestions)
  }
  if (flags.patterns && report.summary.ok && report.surfacePatterns) {
    return formatSurfacePatterns(report.surfacePatterns)
  }
  if (flags.patternComparison && report.summary.ok && report.patternComparison) {
    return formatPatternComparison(report.patternComparison)
  }
  if (flags.nextProReview && report.summary.ok) return formatNextProReview(report.nextProReview)
  if (flags.stateGuide && report.summary.ok) return formatProReviewStateGuide(report.proReviewStateGuide)
  if (flags.proReadiness && report.summary.ok && report.proReviewReadiness) {
    return formatProReviewReadiness(report.proReviewReadiness)
  }
  if (flags.questionMatrix && report.summary.ok && report.proQuestionMatrix) {
    return formatProQuestionMatrix(report.proQuestionMatrix)
  }
  if (flags.reviewRunbook && report.summary.ok && report.reviewQueue.length) {
    return buildProReviewBatchRunbook({
      reviewQueue: report.reviewQueue,
      registryStatus: report.proReviewRegistry.status,
    })
  }
  if (flags.implementationBrief && report.summary.ok && report.implementationBrief) {
    return report.implementationBrief
  }
  if (flags.implementationReadiness && report.implementationReadiness) {
    return formatImplementationReadiness(report.implementationReadiness)
  }
  if (flags.implementationStatus && report.summary.ok && report.implementationStatus) {
    return formatImplementationStatus(report.implementationStatus)
  }
  if (flags.proRegistryTransition && report.summary.ok && report.proReviewRegistryTransition) {
    return formatProReviewRegistryTransition(report.proReviewRegistryTransition)
  }
  if (flags.json) return JSON.stringify(report, null, 2)
  return formatHumanReport(report)
}

export function runOpenSourceUiReferenceAuditCli(
  argv,
  { root, buildReport, formatHumanReport, write = process.stdout.write.bind(process.stdout) },
) {
  const { json, options } = parseOpenSourceUiReferenceAuditArgs(argv)
  const report = buildReport(root, options)
  const output = formatRequestedOutput(report, { ...options, json }, formatHumanReport)
  write(`${output}\n`)
  if (!report.summary.ok) process.exit(1)
  return report
}
