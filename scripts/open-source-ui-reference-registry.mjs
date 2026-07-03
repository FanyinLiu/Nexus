export const PRO_REVIEW_REGISTRY_FILE = 'docs/open-source-ui-pro-review-registry.json'

const REQUIRED_POLICY = {
  statusSource: 'local-review-registry',
  doesNotStoreProResponse: true,
  doesNotStoreSecrets: true,
  requiresAnswerQualityBeforeIntake: true,
  requiresIntakeBeforeImplementation: true,
  requiresImplementationReadinessBeforeCodeChange: true,
}

const ALLOWED_STATUSES = new Set([
  'not-sent',
  'sent',
  'intake-needed',
  'needs-follow-up',
  'accepted-for-prototype',
  'rejected',
  'recorded',
])

const ALLOWED_DECISIONS = new Set([
  'pending',
  'ask-follow-up',
  'needs-prototype',
  'accepted',
  'rejected',
])

const STATUS_DECISION_RULES = new Map([
  ['not-sent', new Set(['pending'])],
  ['sent', new Set(['pending'])],
  ['intake-needed', new Set(['pending'])],
  ['needs-follow-up', new Set(['ask-follow-up'])],
  ['accepted-for-prototype', new Set(['needs-prototype'])],
  ['rejected', new Set(['rejected'])],
  ['recorded', new Set(['accepted'])],
])

const PRO_REVIEW_STATE_GUIDE = [
  {
    status: 'not-sent',
    decision: 'pending',
    meaning: 'No Pro handoff has been sent for this surface.',
    nextAction: 'Generate the bounded handoff, send it to Pro, then update the registry to sent or intake-needed.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --pro-handoff',
      'npm run ui:references:audit -- --next-pro-handoff',
    ],
  },
  {
    status: 'sent',
    decision: 'pending',
    meaning: 'The handoff was sent, but the answer has not been triaged locally.',
    nextAction: 'Wait for the answer, run answer quality, then generate the intake template before considering any UI change.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --pro-answer-quality',
      'npm run ui:references:audit -- --surface=<surface> --review-intake-template',
    ],
  },
  {
    status: 'intake-needed',
    decision: 'pending',
    meaning: 'A Pro answer exists, but it has not been converted into a local implementation decision.',
    nextAction: 'Run answer quality, then fill the intake template and choose ask-follow-up, needs-prototype, accepted, or rejected.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --pro-answer-quality',
      'npm run ui:references:audit -- --surface=<surface> --review-intake-template',
      'npm run ui:references:audit -- --surface=<surface> --record-template',
    ],
  },
  {
    status: 'needs-follow-up',
    decision: 'ask-follow-up',
    meaning: 'The answer is useful but still needs one focused clarification before implementation.',
    nextAction: 'Ask only the unresolved question, then re-run intake before changing UI.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --questions',
      'npm run ui:references:audit -- --surface=<surface> --evidence',
    ],
  },
  {
    status: 'accepted-for-prototype',
    decision: 'needs-prototype',
    meaning: 'The advice is accepted only as a small prototype route, not as final UI.',
    nextAction: 'Prototype the smallest surface-scoped change and run the listed local checks.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --pro-answer-quality',
      'npm run ui:references:audit -- --surface=<surface> --implementation-readiness',
      'npm run ui:references:audit -- --surface=<surface> --record-template',
      'npm run ui:references:audit -- --surface=<surface> --evidence',
    ],
  },
  {
    status: 'rejected',
    decision: 'rejected',
    meaning: 'The advice is rejected or conflicts with Nexus companion-first identity.',
    nextAction: 'Record the reason; the next-review selector skips this surface.',
    commands: [
      'npm run ui:references:audit',
    ],
  },
  {
    status: 'recorded',
    decision: 'accepted',
    meaning: 'The advice has been accepted, recorded, and no longer needs Pro action.',
    nextAction: 'Keep the record bounded; the next-review selector skips this surface.',
    commands: [
      'npm run ui:references:audit -- --surface=<surface> --implementation-readiness',
      'npm run ui:references:audit',
    ],
  },
]

const NEXT_REVIEW_STATUS_RANK = new Map([
  ['needs-follow-up', 0],
  ['sent', 1],
  ['intake-needed', 2],
  ['not-sent', 3],
  ['accepted-for-prototype', 4],
])

const TRANSITION_GUIDE = {
  sent: {
    decision: 'pending',
    nextAction: 'Wait for Pro response, then generate the intake template before implementation.',
    command: 'npm run ui:references:audit',
  },
  'intake-needed': {
    decision: 'pending',
    nextAction: 'Generate the intake template and triage the Pro response before implementation.',
    command: 'npm run ui:references:audit -- --surface=<surface> --review-intake-template',
  },
  'needs-follow-up': {
    decision: 'ask-follow-up',
    nextAction: 'Ask one focused follow-up question, then re-run intake before implementation.',
    command: 'npm run ui:references:audit -- --surface=<surface> --questions',
  },
  'accepted-for-prototype': {
    decision: 'needs-prototype',
    nextAction: 'Prototype only the smallest surface-scoped change and run the listed local checks.',
    command: 'npm run ui:references:audit -- --surface=<surface> --record-template',
  },
  rejected: {
    decision: 'rejected',
    nextAction: 'Record the rejection reason; do not implement this Pro advice.',
    command: 'npm run ui:references:audit',
  },
  recorded: {
    decision: 'accepted',
    nextAction: 'Keep the bounded record and move to the next actionable Pro review.',
    command: 'npm run ui:references:audit -- --next-pro-review',
  },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseProReviewRegistry(text) {
  if (typeof text !== 'string') return { registry: null, invalidRegistry: [] }

  try {
    return { registry: JSON.parse(text), invalidRegistry: [] }
  } catch (error) {
    return {
      registry: null,
      invalidRegistry: [{
        file: PRO_REVIEW_REGISTRY_FILE,
        issue: 'invalid-json',
        message: error.message,
      }],
    }
  }
}

export function buildRegistryMap(registry) {
  if (!isPlainObject(registry) || !Array.isArray(registry.surfaces)) return new Map()

  return new Map(
    registry.surfaces
      .filter((entry) => hasText(entry?.surface))
      .map((entry) => [entry.surface, entry]),
  )
}

export function buildRegistryStatus(registry, surfaceCoverage) {
  const registryMap = buildRegistryMap(registry)

  return surfaceCoverage.map((coverage) => {
    const entry = registryMap.get(coverage.surface) ?? null
    return {
      surface: coverage.surface,
      status: entry?.status ?? 'missing',
      decision: entry?.decision ?? 'missing',
      nextAction: entry?.nextAction ?? '',
      commands: entry?.commands ?? {},
    }
  })
}

export function buildNextProReview(reviewQueue, registry) {
  const registryMap = buildRegistryMap(registry)
  const candidates = reviewQueue
    .map((queueItem, queueIndex) => {
      const entry = registryMap.get(queueItem.surface)
      const status = entry?.status ?? 'missing'
      const statusRank = NEXT_REVIEW_STATUS_RANK.get(status)
      if (statusRank === undefined) return null

      return {
        surface: queueItem.surface,
        priority: queueItem.priority,
        phase: queueItem.phase,
        focus: queueItem.focus,
        whyNow: queueItem.whyNow,
        status,
        decision: entry?.decision ?? 'missing',
        nextAction: entry?.nextAction ?? '',
        references: queueItem.references,
        proHandoffCommand: queueItem.proHandoffCommand,
        questionsCommand: queueItem.questionsCommand,
        patternsCommand: queueItem.patternsCommand,
        evidenceCommand: queueItem.evidenceCommand,
        intakeTemplateCommand: queueItem.intakeTemplateCommand,
        recordTemplateCommand: queueItem.recordTemplateCommand,
        answerQualityCommand: queueItem.answerQualityCommand,
        implementationReadinessCommand: queueItem.implementationReadinessCommand,
        firstLocalCommand: queueItem.firstLocalCommand,
        browserCheck: queueItem.browserCheck,
        statusRank,
        queueIndex,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.statusRank - b.statusRank || a.priority - b.priority || a.queueIndex - b.queueIndex)

  const next = candidates[0]
  if (!next) return null

  const result = { ...next }
  delete result.statusRank
  delete result.queueIndex
  return result
}

export function formatNextProReview(nextProReview) {
  const lines = ['Next Pro review']
  if (!nextProReview) {
    lines.push('- surface: none')
    lines.push('- reason: all registry surfaces are recorded, rejected, or unavailable')
    return lines.join('\n')
  }

  lines.push(`- surface: ${nextProReview.surface}`)
  lines.push(`- status: ${nextProReview.status}`)
  lines.push(`- decision: ${nextProReview.decision}`)
  lines.push(`- priority: ${nextProReview.priority}`)
  lines.push(`- phase: ${nextProReview.phase}`)
  lines.push(`- focus: ${nextProReview.focus}`)
  lines.push(`- why now: ${nextProReview.whyNow}`)
  lines.push(`- next action: ${nextProReview.nextAction}`)
  lines.push(`- references: ${nextProReview.references.length ? nextProReview.references.join(', ') : 'none'}`)
  lines.push(`- handoff: ${nextProReview.proHandoffCommand}`)
  lines.push(`- questions: ${nextProReview.questionsCommand}`)
  lines.push(`- patterns: ${nextProReview.patternsCommand}`)
  lines.push(`- evidence: ${nextProReview.evidenceCommand}`)
  lines.push(`- quality: ${nextProReview.answerQualityCommand}`)
  lines.push(`- intake: ${nextProReview.intakeTemplateCommand}`)
  lines.push(`- record: ${nextProReview.recordTemplateCommand}`)
  lines.push(`- implementation gate: ${nextProReview.implementationReadinessCommand}`)
  lines.push(`- check: ${nextProReview.firstLocalCommand}`)
  if (nextProReview.browserCheck) lines.push(`- browser: ${nextProReview.browserCheck}`)
  return lines.join('\n')
}

export function buildProReviewStateGuide() {
  return PRO_REVIEW_STATE_GUIDE.map((item) => ({
    ...item,
    allowedDecision: [...STATUS_DECISION_RULES.get(item.status)],
  }))
}

export function formatProReviewStateGuide(stateGuide = buildProReviewStateGuide()) {
  const lines = ['Pro review state guide']
  for (const item of stateGuide) {
    lines.push('')
    lines.push(`- ${item.status}/${item.decision}`)
    lines.push(`  - meaning: ${item.meaning}`)
    lines.push(`  - next action: ${item.nextAction}`)
    lines.push(`  - allowed decision: ${item.allowedDecision.join(' | ')}`)
    lines.push('  - commands:')
    for (const command of item.commands) {
      lines.push(`    - ${command}`)
    }
  }
  return lines.join('\n')
}

export function buildProReviewRegistryTransition(nextProReview, targetStatus = 'sent') {
  const transition = TRANSITION_GUIDE[targetStatus]
  if (!nextProReview || !transition) {
    return {
      ok: false,
      surface: nextProReview?.surface ?? null,
      targetStatus,
      issue: transition ? 'missing next Pro review' : 'unknown target status',
    }
  }

  return {
    ok: true,
    surface: nextProReview.surface,
    from: {
      status: nextProReview.status,
      decision: nextProReview.decision,
      nextAction: nextProReview.nextAction,
    },
    to: {
      status: targetStatus,
      decision: transition.decision,
      nextAction: transition.nextAction,
    },
    file: PRO_REVIEW_REGISTRY_FILE,
    pathHint: `surfaces[?surface=${nextProReview.surface}]`,
    entryPatch: {
      surface: nextProReview.surface,
      status: targetStatus,
      decision: transition.decision,
      nextAction: transition.nextAction,
    },
    commands: {
      verify: 'npm run ui:references:audit',
      next: transition.command.replaceAll('<surface>', nextProReview.surface),
    },
    policy: {
      doesNotStoreProResponse: true,
      doesNotStoreSecrets: true,
    },
  }
}

export function formatProReviewRegistryTransition(transition) {
  const lines = ['Pro review registry transition']
  if (!transition?.ok) {
    lines.push(`- ok: false`)
    lines.push(`- issue: ${transition?.issue ?? 'unknown transition issue'}`)
    if (transition?.targetStatus) lines.push(`- target status: ${transition.targetStatus}`)
    return lines.join('\n')
  }

  lines.push(`- ok: true`)
  lines.push(`- surface: ${transition.surface}`)
  lines.push(`- from: ${transition.from.status}/${transition.from.decision}`)
  lines.push(`- to: ${transition.to.status}/${transition.to.decision}`)
  lines.push(`- nextAction: ${transition.to.nextAction}`)
  lines.push('- dry-run: true')
  lines.push(`- file: ${transition.file}`)
  lines.push(`- path: ${transition.pathHint}`)
  lines.push('- entry patch:')
  lines.push(JSON.stringify(transition.entryPatch, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n'))
  lines.push(`- verify: ${transition.commands.verify}`)
  lines.push(`- next: ${transition.commands.next}`)
  lines.push('- policy: do not store Pro response text, secrets, private logs, credentials, memory contents, personal data, or unrelated source dumps in the registry.')
  return lines.join('\n')
}

export function findProReviewRegistryIssues(registry, surfaceCoverage, reviewQueue) {
  const issues = []
  const requiredSurfaces = surfaceCoverage.map((coverage) => coverage.surface)
  const requiredSurfaceSet = new Set(requiredSurfaces)
  const queueBySurface = new Map(reviewQueue.map((item) => [item.surface, item]))

  if (!isPlainObject(registry)) {
    return [{ file: PRO_REVIEW_REGISTRY_FILE, path: '$', issue: 'registry must be an object' }]
  }

  if (registry.schemaVersion !== 1) {
    issues.push({
      file: PRO_REVIEW_REGISTRY_FILE,
      path: 'schemaVersion',
      issue: 'schemaVersion must be 1',
    })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.lastUpdated ?? '')) {
    issues.push({
      file: PRO_REVIEW_REGISTRY_FILE,
      path: 'lastUpdated',
      issue: 'lastUpdated must be YYYY-MM-DD',
    })
  }

  for (const [key, expectedValue] of Object.entries(REQUIRED_POLICY)) {
    if (registry.policy?.[key] !== expectedValue) {
      issues.push({
        file: PRO_REVIEW_REGISTRY_FILE,
        path: `policy.${key}`,
        issue: `must equal ${JSON.stringify(expectedValue)}`,
      })
    }
  }

  if (!Array.isArray(registry.surfaces)) {
    issues.push({
      file: PRO_REVIEW_REGISTRY_FILE,
      path: 'surfaces',
      issue: 'surfaces must be an array',
    })
    return issues
  }

  const seen = new Set()
  for (const [index, entry] of registry.surfaces.entries()) {
    const path = `surfaces[${index}]`
    if (!isPlainObject(entry)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path, issue: 'surface entry must be an object' })
      continue
    }

    if (!hasText(entry.surface)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.surface`, issue: 'missing surface' })
    } else if (seen.has(entry.surface)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.surface`, issue: 'duplicate surface' })
    } else {
      seen.add(entry.surface)
      if (!requiredSurfaceSet.has(entry.surface)) {
        issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.surface`, issue: 'unknown required surface' })
      }
    }

    if (!ALLOWED_STATUSES.has(entry.status)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.status`, issue: 'invalid status' })
    }

    if (!ALLOWED_DECISIONS.has(entry.decision)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.decision`, issue: 'invalid decision' })
    } else {
      const allowedDecisions = STATUS_DECISION_RULES.get(entry.status)
      if (allowedDecisions && !allowedDecisions.has(entry.decision)) {
        issues.push({
          file: PRO_REVIEW_REGISTRY_FILE,
          path: `${path}.decision`,
          issue: 'status/decision mismatch',
          expected: [...allowedDecisions],
          actual: entry.decision,
        })
      }
    }

    if (!hasText(entry.nextAction)) {
      issues.push({ file: PRO_REVIEW_REGISTRY_FILE, path: `${path}.nextAction`, issue: 'missing next action' })
    }

    const queueItem = queueBySurface.get(entry.surface)
    if (queueItem) {
      assertRegistryCommand(issues, path, entry, 'handoff', queueItem.proHandoffCommand)
      assertRegistryCommand(issues, path, entry, 'quality', queueItem.answerQualityCommand)
      assertRegistryCommand(issues, path, entry, 'intake', queueItem.intakeTemplateCommand)
      assertRegistryCommand(issues, path, entry, 'record', queueItem.recordTemplateCommand)
      assertRegistryCommand(issues, path, entry, 'implementation', queueItem.implementationReadinessCommand)
      assertRegistryCommand(issues, path, entry, 'check', queueItem.firstLocalCommand)
    }
  }

  for (const surface of requiredSurfaces) {
    if (!seen.has(surface)) {
      issues.push({
        file: PRO_REVIEW_REGISTRY_FILE,
        path: 'surfaces',
        surface,
        issue: 'missing required surface',
      })
    }
  }

  return issues
}

function assertRegistryCommand(issues, path, entry, commandName, expected) {
  const actual = entry.commands?.[commandName]
  if (actual !== expected) {
    issues.push({
      file: PRO_REVIEW_REGISTRY_FILE,
      path: `${path}.commands.${commandName}`,
      issue: 'command drift',
      expected,
      actual: actual ?? null,
    })
  }
}
