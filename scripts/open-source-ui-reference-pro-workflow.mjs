import {
  PRO_REVIEW_DECISION_CHECKS,
  SURFACE_CRITICAL_QUESTIONS,
} from './open-source-ui-reference-evidence.mjs'
import { buildSurfacePatterns } from './open-source-ui-reference-patterns.mjs'

const IMPLEMENTATION_READY_STATUSES = new Set(['accepted-for-prototype', 'recorded'])
const REFERENCE_REFRESH_CHECK_COMMAND = 'npm run ui:references:audit -- --reference-refresh-check'

function buildAnswerQualityCommand(surface) {
  return surface ? `npm run ui:references:audit -- --surface=${surface} --pro-answer-quality` : ''
}

function buildImplementationReadinessCommand(surface) {
  return surface ? `npm run ui:references:audit -- --surface=${surface} --implementation-readiness` : ''
}

export function buildSurfaceQuestions(surfaceReview) {
  if (!surfaceReview) return null

  return {
    surface: surfaceReview.surface,
    questions: SURFACE_CRITICAL_QUESTIONS[surfaceReview.surface] ?? [
      '这个 surface 最值得借鉴的抽象范式是什么，哪些具体皮肤或尺寸必须避开？',
      '建议如何映射到 Nexus 当前 surface，而不是扩散成跨界面重做？',
      '哪些部分需要人工判断 polish，哪些部分可以变成自动审计？',
    ],
    decisionChecks: PRO_REVIEW_DECISION_CHECKS,
  }
}

export function formatSurfaceQuestions(surfaceQuestions) {
  if (!surfaceQuestions) return null

  const lines = [`Pro critical questions: ${surfaceQuestions.surface}`, '']
  lines.push('Questions:')
  for (const question of surfaceQuestions.questions) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('Decision checks:')
  for (const check of surfaceQuestions.decisionChecks) {
    lines.push(`- ${check}`)
  }
  return lines.join('\n')
}

export function buildProReviewPrompt(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const lines = [
    '你作为资深产品设计和前端架构顾问，帮我审 Nexus 的一个 UI surface。',
    '',
    `项目背景：Nexus 是开源桌面陪伴应用，目标是借鉴成熟开源 AI/UI 项目的范式，但不能复制任何产品皮肤、精确尺寸、颜色、圆角、阴影、组件树或视觉 chrome。`,
    `本次 surface：${surfaceReview.surface}`,
    `覆盖要求：至少 ${surfaceReview.minReferences} 个参考来源。当前参考来源 ${surfaceReview.references.length} 个。`,
    `为什么要审这个 surface：${surfaceReview.reason}`,
    '',
    '参考来源和边界：',
  ]

  for (const reference of surfaceReview.references) {
    lines.push(`- ${reference.name} (${reference.repository})`)
    lines.push(`  - 可以借鉴：${reference.borrow}`)
    lines.push(`  - 不要借鉴：${reference.avoid}`)
  }

  lines.push('')
  lines.push('硬性规则：')
  for (const rule of surfaceReview.reviewRules) {
    lines.push(`- ${rule}`)
  }

  appendEvidenceSection(lines, surfaceEvidence)
  appendPatternSection(lines, buildSurfacePatterns(surfaceReview))
  appendCriticalQuestionsSection(lines, buildSurfaceQuestions(surfaceReview))

  lines.push('')
  lines.push('请直接给可执行建议，不要泛泛讲 UI 美学。输出结构：')
  lines.push('1. 这个 surface 最重要的视觉/交互判断。')
  lines.push('2. 可以从每个参考项目借鉴的抽象范式。')
  lines.push('3. 明确不能复制或需要避开的东西。')
  lines.push('4. 推荐的实现路线，按最小可落地步骤排序。')
  lines.push('5. 需要人工 review 的点和可以自动审计的点。')
  lines.push('6. 如果建议会破坏 Nexus 的 companion-first 身份，请直接指出。')

  return lines.join('\n')
}

export function buildProHandoffPackage(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const prompt = buildProReviewPrompt(surfaceReview, surfaceEvidence)
  const questions = buildSurfaceQuestions(surfaceReview)
  const patterns = buildSurfacePatterns(surfaceReview)
  const recordTemplate = buildProRecordTemplate(surfaceReview, surfaceEvidence)
  const lines = [
    `# Nexus Pro Handoff: ${surfaceReview.surface}`,
    '',
    'Purpose: Ask Pro for one focused surface review, then convert the answer into an implementation decision.',
    '',
    'Privacy boundary:',
    '- Public open-source reference guidance only.',
    '- Do not include secrets, private logs, credentials, memory contents, personal data, or unrelated source dumps.',
    '- If Pro asks for more context, add only the surface evidence listed below.',
    '',
    '## Send This Prompt To Pro',
    '',
    prompt,
    '',
    '## Local Evidence Boundary',
  ]

  appendEvidenceChecklist(lines, surfaceEvidence)

  lines.push('')
  lines.push('## Pattern Matrix Snapshot')
  appendPatternChecklist(lines, patterns)
  lines.push('')
  lines.push('## Required Questions')
  appendQuestionChecklist(lines, questions)
  lines.push('')
  lines.push('## Record The Answer Here')
  lines.push('')
  lines.push(recordTemplate)

  return lines.join('\n')
}

export function buildProSendPayload(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const lines = [
    `# Nexus Pro Send Payload: ${surfaceReview.surface}`,
    '',
    '## Before Browser Send',
    '',
    '- This output is a pre-send payload, not proof that Pro has been asked.',
    '- Confirm with the user before clicking Send in a third-party browser page.',
    '- Destination should be the user-approved ChatGPT/Pro conversation only.',
    '- Send only the prompt under "Copy Only This To Pro"; do not send the local after-send notes.',
    '- Do not update the registry while this payload has only been generated locally.',
    `- Before sending, run the manual reference freshness check if the open-source snapshot has not been refreshed for this review: ${REFERENCE_REFRESH_CHECK_COMMAND}`,
    '- Treat the reference freshness check as manual pre-send evidence only, not a default CI or release gate.',
    '',
    '## Copy Only This To Pro',
    '',
    buildProReviewPrompt(surfaceReview, surfaceEvidence),
    '',
    '## After Sending Locally',
    `- Registry surface: ${surfaceReview.surface}`,
    '- Set status/decision to `sent`/`pending` after the payload is actually sent.',
    `- Transition command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --pro-registry-transition=sent`,
    '- Next verification command: npm run ui:references:audit',
    `- Intake command after Pro replies: npm run ui:references:audit -- --surface=${surfaceReview.surface} --review-intake-template`,
    '- Do not store Pro response text, secrets, private logs, credentials, memory contents, personal data, or unrelated source dumps in the registry.',
  ]
  return lines.join('\n')
}

export function buildProReviewIntakeTemplate(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const lines = [
    `# Pro Review Intake: ${surfaceReview.surface}`,
    '',
    'Date: YYYY-MM-DD',
    `Surface: ${surfaceReview.surface}`,
    'Pro conversation link:',
    'Pro model label:',
    'Intake status: received | needs follow-up | accepted for prototype | rejected',
    '',
    '## Source Handoff',
    `- Handoff command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --pro-handoff`,
    `- Record template command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --record-template`,
    '- Sent only public reference guidance and bounded Nexus surface evidence.',
    '',
    '## Answer Triage',
    '- Strongest useful judgment:',
    '- Advice that maps cleanly to this surface:',
    '- Advice that is too broad or belongs to another surface:',
    '- Advice that risks copying a reference skin:',
    '- Advice that conflicts with companion-first identity:',
    '- Follow-up question for Pro, if needed:',
  ]

  if (surfaceEvidence?.researchNotes?.length) {
    lines.push('', '## Research Anchor Response')
    for (const note of surfaceEvidence.researchNotes) {
      lines.push(`- Anchor: ${note}`)
      lines.push('  - Pro response:')
      lines.push('  - Accept / reject / ask follow-up:')
    }
  }

  lines.push('', '## Accepted Abstract Patterns')
  appendPatternChecklist(lines, buildSurfacePatterns(surfaceReview))

  lines.push('')
  lines.push('## Decision')
  lines.push('Decision outcome: accepted | rejected | needs prototype | ask follow-up')
  lines.push('Reason:')
  lines.push('Smallest implementation route:')
  lines.push('Files likely to touch:')
  lines.push('')
  lines.push('## Verification Plan')
  appendEvidenceChecklist(lines, surfaceEvidence)
  lines.push('')
  lines.push('## Privacy Check')
  lines.push('- No secrets, private logs, credentials, memory contents, personal data, or unrelated source dumps were sent.')
  lines.push('- Pro advice is treated as review input, not an automatic implementation instruction.')

  return lines.join('\n')
}

export function buildProAnswerQualityChecklist(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const questions = buildSurfaceQuestions(surfaceReview)
  const patterns = buildSurfacePatterns(surfaceReview)
  const lines = [
    `# Pro Answer Quality Checklist: ${surfaceReview.surface}`,
    '',
    'Purpose: Decide whether a Pro answer is actionable before converting it into Nexus implementation intake.',
    '',
    'Pass requirements:',
    '- The answer names one strongest surface-specific judgment.',
    '- Every recommendation maps to this surface before implementation.',
    '- At least one abstract pattern to borrow and one concrete skin/detail to avoid are named.',
    '- The implementation route is small enough to prototype without rewriting adjacent surfaces.',
    '- Manual polish checks and automatic audit/test checks are separated.',
    '- The answer preserves companion-first identity and does not turn Nexus into a generic chat dashboard.',
    ...(surfaceEvidence?.researchNotes?.length
      ? ['- The answer explicitly responds to every research anchor before it can be accepted.']
      : []),
    '',
    'Reject or ask follow-up if:',
    '- It suggests copying exact layout, colors, spacing, radius, shadows, component tree, or product chrome.',
    '- It asks to change unrelated surfaces without explaining why this surface requires it.',
    '- It gives only generic UI taste advice without files, states, or review evidence.',
    '- It ignores disabled, focus, streaming, voice, short-height, or theme states that matter to this surface.',
    ...(surfaceEvidence?.researchNotes?.length
      ? ['- It ignores or contradicts any research anchor listed below.']
      : []),
    '- It conflicts with the local privacy boundary or asks for secrets, private logs, memory contents, or unrelated source dumps.',
    '',
    'Surface-specific questions that must be answered:',
  ]

  for (const question of questions?.questions ?? []) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('Pattern mapping to verify:')
  appendPatternChecklist(lines, patterns)
  if (surfaceEvidence?.researchNotes?.length) {
    lines.push('')
    lines.push('Research anchors that must be answered:')
    for (const note of surfaceEvidence.researchNotes) {
      lines.push(`- ${note}`)
    }
  }
  lines.push('')
  lines.push('Evidence to use locally:')
  appendEvidenceChecklist(lines, surfaceEvidence)
  lines.push('')
  lines.push('Local decision:')
  lines.push('- If all pass requirements are satisfied, fill the review intake and choose `accepted for prototype` or `accepted`.')
  lines.push('- If one focused clarification is needed, mark `needs follow-up` and ask only that question.')
  lines.push('- If the answer is generic, skin-copying, or identity-breaking, mark `rejected` and keep the current local direction.')

  return lines.join('\n')
}

export function buildImplementationBrief(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const patterns = buildSurfacePatterns(surfaceReview)
  const questions = buildSurfaceQuestions(surfaceReview)
  const commands = surfaceEvidence?.commands ?? [`npm run ui:references:audit -- --surface=${surfaceReview.surface}`]
  const lines = [
    `# Nexus UI Implementation Brief: ${surfaceReview.surface}`,
    '',
    'Purpose: Convert open-source reference patterns and Pro review into the smallest local Nexus change.',
    '',
    'Preconditions:',
    '- Do not implement from a raw Pro answer alone; triage it through the review intake first.',
    '- Run the Pro answer quality checklist before intake, then run implementation readiness before code changes.',
    '- Every accepted recommendation must map to this surface and preserve companion-first identity.',
    ...(surfaceEvidence?.researchNotes?.length
      ? ['- Every accepted recommendation must answer the research anchors recorded in the intake.']
      : []),
    '- Borrow behavior and hierarchy only; do not copy product skin, exact spacing, colors, radius, shadow, or component chrome.',
    '',
    'Surface scope:',
    `- Surface: ${surfaceReview.surface}`,
    `- Reason: ${surfaceReview.reason}`,
    `- Reference coverage: ${surfaceReview.references.length}/${surfaceReview.minReferences}`,
  ]

  lines.push('')
  lines.push('Reference boundaries:')
  for (const reference of surfaceReview.references) {
    lines.push(`- ${reference.name}: borrow ${reference.borrow} Avoid ${reference.avoid}`)
  }

  lines.push('')
  lines.push('Accepted-pattern slots:')
  for (const pattern of patterns?.patterns ?? []) {
    lines.push(`- ${pattern.reference} [${pattern.axis}]`)
    lines.push(`  - Pattern: ${pattern.pattern}`)
    lines.push(`  - Nexus mapping: ${pattern.nexusMapping}`)
    lines.push(`  - Avoid: ${pattern.avoid}`)
  }

  lines.push('')
  lines.push('Implementation route:')
  lines.push('1. Restate the Pro judgment as one surface-specific decision.')
  lines.push('2. Name the smallest visible behavior or hierarchy change.')
  lines.push('3. Touch only the listed source/style boundaries unless the intake explicitly justifies a wider change.')
  lines.push('4. Keep manual polish checks separate from deterministic audits.')

  appendEvidenceChecklist(lines, surfaceEvidence)
  lines.push('')
  lines.push('Critical questions to keep open:')
  for (const question of questions?.questions ?? []) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('Done evidence:')
  for (const command of commands) {
    lines.push(`- ${command}`)
  }
  if (surfaceEvidence?.browserChecks.length) {
    for (const check of surfaceEvidence.browserChecks) {
      lines.push(`- Browser/manual: ${check}`)
    }
  }
  lines.push('- Record the URL/state, viewport or panel size, commands run, and any Pro review summary used for the decision.')

  return lines.join('\n')
}

export function buildImplementationReadiness({
  surfaceReview,
  surfaceEvidence,
  surfacePatterns,
  registryStatus,
} = {}) {
  const status = registryStatus?.status ?? 'missing'
  const decision = registryStatus?.decision ?? 'missing'
  const surface = surfaceReview?.surface ?? registryStatus?.surface ?? null
  const expectedAnswerQualityCommand = buildAnswerQualityCommand(surface)
  const expectedImplementationReadinessCommand = buildImplementationReadinessCommand(surface)
  const registryCommands = registryStatus?.commands ?? {}
  const requirements = [
    {
      id: 'surface-review-ready',
      ok: Boolean(surfaceReview?.ok && surfaceReview.references.length >= surfaceReview.minReferences),
      detail: surfaceReview ? `${surfaceReview.references.length}/${surfaceReview.minReferences} references` : 'No surface review.',
    },
    {
      id: 'pro-intake-decision-ready',
      ok: IMPLEMENTATION_READY_STATUSES.has(status),
      detail: `${status}/${decision}`,
    },
    {
      id: 'answer-quality-check-ready',
      ok: Boolean(expectedAnswerQualityCommand && registryCommands.quality === expectedAnswerQualityCommand),
      detail: registryCommands.quality ?? 'No registry quality command.',
    },
    {
      id: 'implementation-gate-command-ready',
      ok: Boolean(
        expectedImplementationReadinessCommand
          && registryCommands.implementation === expectedImplementationReadinessCommand,
      ),
      detail: registryCommands.implementation ?? 'No registry implementation gate command.',
    },
    {
      id: 'evidence-ready',
      ok: Boolean(surfaceEvidence?.docs.length && surfaceEvidence.commands.length),
      detail: surfaceEvidence ? `${surfaceEvidence.docs.length} docs, ${surfaceEvidence.commands.length} commands` : 'No evidence.',
    },
    {
      id: 'patterns-ready',
      ok: Boolean(surfacePatterns?.patterns.length),
      detail: surfacePatterns ? `${surfacePatterns.patterns.length} mapped patterns` : 'No patterns.',
    },
    {
      id: 'browser-check-ready',
      ok: Boolean(surfaceEvidence?.browserChecks.length),
      detail: surfaceEvidence?.browserChecks[0] ?? 'No browser/manual check.',
    },
  ]
  const issues = requirements
    .filter((requirement) => !requirement.ok)
    .map((requirement) => ({
      file: 'implementation-readiness',
      surface,
      issue: requirement.id,
      detail: requirement.detail,
    }))

  return {
    ok: issues.length === 0,
    surface,
    status,
    decision,
    nextAction: registryStatus?.nextAction ?? '',
    requirements,
    issues,
    commands: {
      answerQuality: expectedAnswerQualityCommand,
      implementationBrief: surface ? `npm run ui:references:audit -- --surface=${surface} --implementation-brief` : '',
      implementationReadiness: expectedImplementationReadinessCommand,
      intake: surface ? `npm run ui:references:audit -- --surface=${surface} --review-intake-template` : '',
      record: surface ? `npm run ui:references:audit -- --surface=${surface} --record-template` : '',
      localCheck: surfaceEvidence?.commands[0] ?? '',
      browserCheck: surfaceEvidence?.browserChecks[0] ?? '',
    },
  }
}

export function formatImplementationReadiness(readiness) {
  if (!readiness) return null

  const lines = [`Implementation readiness: ${readiness.surface ?? 'none'}`]
  lines.push(`- ok: ${readiness.ok}`)
  lines.push(`- registry: ${readiness.status}/${readiness.decision}`)
  if (readiness.nextAction) lines.push(`- next action: ${readiness.nextAction}`)
  lines.push('')
  lines.push('Requirements:')
  for (const requirement of readiness.requirements) {
    lines.push(`- ${requirement.id}: ${requirement.ok ? 'ok' : 'missing'} (${requirement.detail})`)
  }
  lines.push('')
  lines.push('Commands:')
  for (const [name, command] of Object.entries(readiness.commands)) {
    if (command) lines.push(`- ${name}: ${command}`)
  }
  return lines.join('\n')
}

export function buildProRecordTemplate(surfaceReview, surfaceEvidence = null) {
  if (!surfaceReview) return null

  const lines = [
    `# Pro Review Record: ${surfaceReview.surface}`,
    '',
    'Date: YYYY-MM-DD',
    `Surface: ${surfaceReview.surface}`,
    'Decision outcome: accepted | rejected | needs prototype',
    '',
    '## Commands',
    `- Pro prompt command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --pro-prompt --evidence`,
    `- Evidence command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --evidence`,
    `- Record template command: npm run ui:references:audit -- --surface=${surfaceReview.surface} --record-template`,
    '',
    '## Reference Sources',
  ]

  for (const reference of surfaceReview.references) {
    lines.push(`- ${reference.name}: borrow ${reference.borrow} Avoid ${reference.avoid}`)
  }

  appendPatternSection(lines, buildSurfacePatterns(surfaceReview))
  appendCriticalQuestionsSection(lines, buildSurfaceQuestions(surfaceReview))

  lines.push('')
  lines.push('## Pro Key Judgment')
  lines.push('- Paste the strongest judgment from Pro here.')
  lines.push('')
  lines.push('## Borrowed Abstract Patterns')
  lines.push('- Pattern:')
  lines.push('- Nexus mapping:')
  lines.push('- Why it fits this surface:')
  lines.push('')
  lines.push('## Do-Not-Copy Boundary')
  lines.push('- 不复制参考项目皮肤、精确尺寸、颜色、圆角、阴影、组件树或视觉 chrome。')
  lines.push('- 不发送密钥、私人日志、记忆内容、凭据或无关源码。')
  lines.push('')
  lines.push('## Implementation Route')
  lines.push('1. Smallest safe change:')
  lines.push('2. Files to touch:')
  lines.push('3. State or interaction contract to preserve:')
  lines.push('4. Checks before merge:')
  lines.push('')
  lines.push('## Manual Review Checks')
  if (surfaceEvidence?.browserChecks.length) {
    for (const check of surfaceEvidence.browserChecks) {
      lines.push(`- ${check}`)
    }
  } else {
    lines.push('- Review the selected surface in the local Nexus preview.')
  }
  lines.push('')
  lines.push('## Automatic Audit/Test Checks')
  const commands = surfaceEvidence?.commands ?? [`npm run ui:references:audit -- --surface=${surfaceReview.surface}`]
  for (const command of commands) {
    lines.push(`- ${command}`)
  }
  lines.push('')
  lines.push('## Follow-up Files And Commands')
  lines.push('- Files:')
  lines.push('- Commands:')
  lines.push('- Open questions:')

  return lines.join('\n')
}

export function buildProReviewReadiness({
  nextProReview,
  surfaceReview,
  surfaceEvidence,
  surfaceQuestions,
  surfacePatterns,
  patternComparison,
} = {}) {
  const surface = nextProReview?.surface ?? surfaceReview?.surface ?? null
  if (!nextProReview?.surface && !surfaceReview) {
    return {
      ok: true,
      surface: null,
      status: 'complete',
      decision: 'accepted',
      phase: 'All 0.4 UI Pro review surfaces recorded',
      focus: 'No pending default Pro review surface.',
      whyNow: 'The registry queue has no not-sent, sent, intake-needed, needs-follow-up, or accepted-for-prototype items.',
      requirements: [{
        id: 'next-review-selected',
        ok: true,
        detail: 'No pending Pro review selected because the queue is complete.',
      }],
      issues: [],
      commands: {
        referenceRefresh: REFERENCE_REFRESH_CHECK_COMMAND,
        patternComparison: 'npm run ui:references:audit -- --pattern-comparison',
        stateGuide: 'npm run ui:references:audit -- --pro-review-state-guide',
      },
      questions: [],
      decisionChecks: [],
      patterns: [],
      evidence: null,
    }
  }
  const requirements = [
    {
      id: 'next-review-selected',
      ok: Boolean(nextProReview?.surface),
      detail: nextProReview?.surface ?? 'No next Pro review selected.',
    },
    {
      id: 'surface-review-ready',
      ok: Boolean(surfaceReview?.ok && surfaceReview.references.length >= surfaceReview.minReferences),
      detail: surfaceReview
        ? `${surfaceReview.references.length}/${surfaceReview.minReferences} references`
        : 'No focused surface review.',
    },
    {
      id: 'evidence-ready',
      ok: Boolean(surfaceEvidence?.docs.length && surfaceEvidence.commands.length),
      detail: surfaceEvidence
        ? `${surfaceEvidence.docs.length} docs, ${surfaceEvidence.commands.length} commands`
        : 'No bounded evidence package.',
    },
    {
      id: 'questions-ready',
      ok: Boolean(surfaceQuestions?.questions.length && surfaceQuestions.decisionChecks.length),
      detail: surfaceQuestions
        ? `${surfaceQuestions.questions.length} questions, ${surfaceQuestions.decisionChecks.length} decision checks`
        : 'No Pro questions.',
    },
    {
      id: 'patterns-ready',
      ok: Boolean(surfacePatterns?.patterns.length),
      detail: surfacePatterns
        ? `${surfacePatterns.patterns.length} mapped patterns`
        : 'No surface pattern matrix.',
    },
    {
      id: 'comparison-ready',
      ok: Boolean(patternComparison?.surfaces.some((item) => item.surface === surface)),
      detail: patternComparison
        ? `${patternComparison.surfaces.length} compared surfaces`
        : 'No cross-surface pattern comparison.',
    },
  ]
  const issues = requirements
    .filter((requirement) => !requirement.ok)
    .map((requirement) => ({
      file: 'pro-review-readiness',
      surface,
      issue: requirement.id,
      detail: requirement.detail,
    }))

  return {
    ok: issues.length === 0,
    surface,
    status: nextProReview?.status ?? 'missing',
    decision: nextProReview?.decision ?? 'missing',
    phase: nextProReview?.phase ?? '',
    focus: nextProReview?.focus ?? '',
    whyNow: nextProReview?.whyNow ?? '',
    requirements,
    issues,
    commands: {
      handoff: nextProReview?.proHandoffCommand ?? '',
      referenceRefresh: REFERENCE_REFRESH_CHECK_COMMAND,
      sendPayload: nextProReview?.proSendPayloadCommand ?? '',
      intake: nextProReview?.intakeTemplateCommand ?? '',
      record: nextProReview?.recordTemplateCommand ?? '',
      answerQuality: nextProReview?.answerQualityCommand ?? '',
      implementationReadiness: nextProReview?.implementationReadinessCommand ?? '',
      questions: nextProReview?.questionsCommand ?? '',
      patterns: nextProReview?.patternsCommand ?? '',
      evidence: nextProReview?.evidenceCommand ?? '',
      patternComparison: 'npm run ui:references:audit -- --pattern-comparison',
      stateGuide: 'npm run ui:references:audit -- --pro-review-state-guide',
      localCheck: nextProReview?.firstLocalCommand ?? '',
      browserCheck: nextProReview?.browserCheck ?? '',
    },
    questions: surfaceQuestions?.questions ?? [],
    decisionChecks: surfaceQuestions?.decisionChecks ?? [],
    patterns: surfacePatterns?.patterns ?? [],
    evidence: surfaceEvidence ?? null,
  }
}

export function buildProQuestionMatrix({
  reviewQueue = [],
  registryStatus = [],
  patternComparison = null,
} = {}) {
  const statusBySurface = new Map(registryStatus.map((item) => [item.surface, item]))
  const patternsBySurface = new Map((patternComparison?.surfaces ?? []).map((item) => [item.surface, item.patterns]))

  return {
    policy: {
      sendsNothing: true,
      boundedPublicEvidenceOnly: true,
      excludes: ['secrets', 'private logs', 'credentials', 'memory contents', 'unrelated source dumps'],
    },
    decisionChecks: PRO_REVIEW_DECISION_CHECKS,
    surfaces: reviewQueue.map((queueItem) => {
      const status = statusBySurface.get(queueItem.surface) ?? {}
      const patterns = patternsBySurface.get(queueItem.surface) ?? []

      return {
        surface: queueItem.surface,
        priority: queueItem.priority,
        phase: queueItem.phase,
        focus: queueItem.focus,
        whyNow: queueItem.whyNow,
        status: status.status ?? 'missing',
        decision: status.decision ?? 'missing',
        references: queueItem.references,
        axes: [...new Set(patterns.map((pattern) => pattern.axis))],
        questions: SURFACE_CRITICAL_QUESTIONS[queueItem.surface] ?? [],
        patterns: patterns.map((pattern) => ({ ...pattern })),
        commands: {
          handoff: queueItem.proHandoffCommand,
          sendPayload: queueItem.proSendPayloadCommand,
          questions: queueItem.questionsCommand,
          patterns: queueItem.patternsCommand,
          evidence: queueItem.evidenceCommand,
          answerQuality: queueItem.answerQualityCommand,
          intake: queueItem.intakeTemplateCommand,
          record: queueItem.recordTemplateCommand,
          implementationReadiness: queueItem.implementationReadinessCommand,
          localCheck: queueItem.firstLocalCommand,
          browserCheck: queueItem.browserCheck,
        },
      }
    }),
    axes: patternComparison?.axes ?? [],
  }
}

export function formatProQuestionMatrix(questionMatrix) {
  if (!questionMatrix) return null

  const lines = ['Pro critical question matrix']
  lines.push(`- surfaces: ${questionMatrix.surfaces.length}`)
  lines.push('- sends: nothing')
  lines.push('- evidence: bounded public reference and surface evidence only')
  lines.push(`- excludes: ${questionMatrix.policy.excludes.join(', ')}`)
  lines.push('')
  lines.push('Surfaces:')

  for (const surface of questionMatrix.surfaces) {
    lines.push(`${surface.priority}. ${surface.surface} (${surface.status}/${surface.decision})`)
    lines.push(`  - phase: ${surface.phase}`)
    lines.push(`  - focus: ${surface.focus}`)
    lines.push(`  - references: ${surface.references.length ? surface.references.join(', ') : 'none'}`)
    lines.push(`  - axes: ${surface.axes.length ? surface.axes.join(', ') : 'none'}`)
    lines.push('  - questions:')
    for (const question of surface.questions) {
      lines.push(`    - ${question}`)
    }
    lines.push('  - pattern boundaries:')
    for (const pattern of surface.patterns) {
      lines.push(`    - ${pattern.reference} [${pattern.axis}]: ${pattern.pattern}`)
      lines.push(`      - Nexus mapping: ${pattern.nexusMapping}`)
      lines.push(`      - avoid: ${pattern.avoid}`)
    }
    lines.push('  - commands:')
    for (const [name, command] of Object.entries(surface.commands)) {
      if (command) lines.push(`    - ${name}: ${command}`)
    }
  }

  lines.push('')
  lines.push('By paradigm axis:')
  for (const axis of questionMatrix.axes) {
    lines.push(`- ${axis.axis}: ${axis.surfaces.join(', ')}`)
    lines.push(`  - references: ${axis.references.join(', ')}`)
  }

  lines.push('')
  lines.push('Decision checks:')
  for (const check of questionMatrix.decisionChecks) {
    lines.push(`- ${check}`)
  }

  return lines.join('\n')
}

export function buildProReviewBatchRunbook({
  reviewQueue = [],
  registryStatus = [],
} = {}) {
  const statusBySurface = new Map(registryStatus.map((item) => [item.surface, item]))
  const lines = [
    '# Nexus 0.4 UI Pro Review Runbook',
    '',
    'Purpose: Run the full 0.4 UI review sequence one surface at a time, using Pro and open-source references without turning raw advice into code.',
    '',
    'Batch rules:',
    '- Work one surface at a time in queue order.',
    '- Send only bounded public reference guidance and surface evidence.',
    '- Do not store Pro response text, secrets, private logs, memory contents, personal data, or unrelated source dumps in the registry.',
    '- Run answer quality before intake, and implementation readiness before code changes.',
    '- Before each browser send, run the manual reference freshness check; keep it out of default CI and release gates.',
    '- If a surface needs follow-up, ask one focused question before opening a new surface.',
    '',
    'Global commands:',
    '- npm run ui:references:audit',
    `- ${REFERENCE_REFRESH_CHECK_COMMAND}`,
    '- npm run ui:references:audit -- --question-matrix',
    '- npm run ui:references:audit -- --pro-review-state-guide',
    '',
    'Surface sequence:',
  ]

  for (const item of reviewQueue) {
    const status = statusBySurface.get(item.surface) ?? {}
    lines.push('')
    lines.push(`${item.priority}. ${item.surface} (${status.status ?? 'missing'}/${status.decision ?? 'missing'})`)
    lines.push(`   - phase: ${item.phase}`)
    lines.push(`   - focus: ${item.focus}`)
    lines.push(`   - why now: ${item.whyNow}`)
    lines.push(`   - references: ${item.references.length ? item.references.join(', ') : 'none'}`)
    lines.push('   - run order:')
    lines.push(`     1. Reference freshness: ${REFERENCE_REFRESH_CHECK_COMMAND}`)
    lines.push(`     2. Handoff: ${item.proHandoffCommand}`)
    lines.push(`     3. Pre-send payload: ${item.proSendPayloadCommand}`)
    lines.push('     4. External send: paste only the send payload after user confirmation.')
    lines.push(`     5. Mark sent: npm run ui:references:audit -- --surface=${item.surface} --pro-registry-transition=sent`)
    lines.push(`     6. Answer quality: npm run ui:references:audit -- --surface=${item.surface} --pro-answer-quality`)
    lines.push(`     7. Intake: ${item.intakeTemplateCommand}`)
    lines.push(`     8. Record: ${item.recordTemplateCommand}`)
    lines.push(`     9. Implementation gate: npm run ui:references:audit -- --surface=${item.surface} --implementation-readiness`)
    lines.push(`     10. Implementation brief: npm run ui:references:audit -- --surface=${item.surface} --implementation-brief`)
    lines.push(`     11. Local check: ${item.firstLocalCommand}`)
    if (item.browserCheck) lines.push(`     12. Browser/manual: ${item.browserCheck}`)
  }

  return lines.join('\n')
}

export function buildImplementationStatus({ reviewQueue = [], registryStatus = [] } = {}) {
  const statusBySurface = new Map(registryStatus.map((item) => [item.surface, item]))
  const items = reviewQueue.map((item) => {
    const status = statusBySurface.get(item.surface) ?? {}
    const ready = status.status === 'recorded' || status.status === 'accepted-for-prototype'
    return {
      surface: item.surface,
      priority: item.priority,
      phase: item.phase,
      focus: item.focus,
      ready,
      status: status.status ?? 'missing',
      decision: status.decision ?? 'missing',
      nextAction: status.nextAction ?? '',
      commands: {
        implementationReadiness: item.implementationReadinessCommand,
        implementationBrief: `npm run ui:references:audit -- --surface=${item.surface} --implementation-brief`,
        answerQuality: item.answerQualityCommand,
        localCheck: item.firstLocalCommand,
        browserCheck: item.browserCheck,
      },
    }
  })

  return {
    completeProQueue: items.every((item) => item.ready),
    readyCount: items.filter((item) => item.ready).length,
    totalCount: items.length,
    items,
  }
}

export function formatImplementationStatus(status) {
  if (!status) return null

  const lines = ['0.4 UI implementation status']
  lines.push(`- Pro queue complete: ${status.completeProQueue}`)
  lines.push(`- implementation-ready surfaces: ${status.readyCount}/${status.totalCount}`)
  lines.push('')
  lines.push('Surface order:')
  for (const item of status.items) {
    lines.push(`${item.priority}. ${item.surface} (${item.status}/${item.decision})`)
    lines.push(`   - phase: ${item.phase}`)
    lines.push(`   - focus: ${item.focus}`)
    lines.push(`   - next: ${item.nextAction}`)
    lines.push(`   - gate: ${item.commands.implementationReadiness}`)
    lines.push(`   - brief: ${item.commands.implementationBrief}`)
    lines.push(`   - check: ${item.commands.localCheck}`)
    if (item.commands.browserCheck) lines.push(`   - browser/manual: ${item.commands.browserCheck}`)
  }
  return lines.join('\n')
}

export function formatProReviewReadiness(readiness) {
  if (!readiness) return null

  const lines = [`Pro review readiness: ${readiness.surface ?? 'none'}`]
  lines.push(`- ok: ${readiness.ok}`)
  lines.push(`- status: ${readiness.status}`)
  lines.push(`- decision: ${readiness.decision}`)
  lines.push(`- phase: ${readiness.phase}`)
  lines.push(`- focus: ${readiness.focus}`)
  lines.push(`- why now: ${readiness.whyNow}`)
  lines.push('')
  lines.push('Requirements:')
  for (const requirement of readiness.requirements) {
    lines.push(`- ${requirement.id}: ${requirement.ok ? 'ok' : 'missing'} (${requirement.detail})`)
  }
  lines.push('')
  lines.push('Commands:')
  for (const [name, command] of Object.entries(readiness.commands)) {
    if (command) lines.push(`- ${name}: ${command}`)
  }
  lines.push('')
  lines.push('Questions:')
  for (const question of readiness.questions) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('Pattern boundaries:')
  for (const pattern of readiness.patterns) {
    lines.push(`- ${pattern.reference}: ${pattern.pattern}`)
    lines.push(`  - axis: ${pattern.axis}`)
    lines.push(`  - Nexus mapping: ${pattern.nexusMapping}`)
    lines.push(`  - avoid: ${pattern.avoid}`)
  }
  return lines.join('\n')
}

function appendEvidenceChecklist(lines, surfaceEvidence) {
  if (!surfaceEvidence) {
    lines.push('- Run with `--evidence` when Pro needs current Nexus implementation boundaries.')
    return
  }

  lines.push('- Docs:')
  for (const doc of surfaceEvidence.docs) {
    lines.push(`  - ${doc}`)
  }
  if (surfaceEvidence.sourceFiles.length) {
    lines.push('- Source/style boundaries:')
    for (const file of surfaceEvidence.sourceFiles) {
      lines.push(`  - ${file}`)
    }
  }
  lines.push('- Local commands:')
  for (const command of surfaceEvidence.commands) {
    lines.push(`  - ${command}`)
  }
  if (surfaceEvidence.researchNotes?.length) {
    lines.push('- Research anchors:')
    for (const note of surfaceEvidence.researchNotes) {
      lines.push(`  - ${note}`)
    }
  }
  if (surfaceEvidence.browserChecks.length) {
    lines.push('- Browser/manual checks:')
    for (const check of surfaceEvidence.browserChecks) {
      lines.push(`  - ${check}`)
    }
  }
}

function appendPatternChecklist(lines, surfacePatterns) {
  if (!surfacePatterns?.patterns.length) {
    lines.push('- No surface-specific pattern matrix entries configured.')
    return
  }

  for (const pattern of surfacePatterns.patterns) {
    lines.push(`- ${pattern.reference}: ${pattern.pattern}`)
    lines.push(`  - Axis: ${pattern.axis}`)
    lines.push(`  - Nexus mapping: ${pattern.nexusMapping}`)
    lines.push(`  - Avoid: ${pattern.avoid}`)
  }
}

function appendQuestionChecklist(lines, surfaceQuestions) {
  if (!surfaceQuestions) return

  for (const question of surfaceQuestions.questions) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('Decision checks:')
  for (const check of surfaceQuestions.decisionChecks) {
    lines.push(`- ${check}`)
  }
}

function appendEvidenceSection(lines, surfaceEvidence) {
  if (!surfaceEvidence) return

  lines.push('')
  lines.push('当前 Nexus 本地证据边界：')
  lines.push('- 这些是公开项目内的审查入口和文件边界；不要要求我发送密钥、私人日志、记忆内容或无关源码。')
  lines.push('- 相关文档：')
  for (const doc of surfaceEvidence.docs) {
    lines.push(`  - ${doc}`)
  }
  if (surfaceEvidence.sourceFiles.length) {
    lines.push('- 相关源码/样式边界：')
    for (const file of surfaceEvidence.sourceFiles) {
      lines.push(`  - ${file}`)
    }
  }
  lines.push('- 本地验证命令：')
  for (const command of surfaceEvidence.commands) {
    lines.push(`  - ${command}`)
  }
  if (surfaceEvidence.researchNotes?.length) {
    lines.push('- 研究锚点：')
    for (const note of surfaceEvidence.researchNotes) {
      lines.push(`  - ${note}`)
    }
  }
  if (surfaceEvidence.browserChecks.length) {
    lines.push('- 人工/浏览器检查：')
    for (const check of surfaceEvidence.browserChecks) {
      lines.push(`  - ${check}`)
    }
  }
}

function appendPatternSection(lines, surfacePatterns) {
  if (!surfacePatterns?.patterns.length) return

  lines.push('')
  lines.push('可借鉴的开源 UI 抽象范式：')
  for (const pattern of surfacePatterns.patterns) {
    lines.push(`- ${pattern.reference}: ${pattern.pattern}`)
    lines.push(`  - 范式轴：${pattern.axis}`)
    lines.push(`  - Nexus 映射：${pattern.nexusMapping}`)
    lines.push(`  - 避免：${pattern.avoid}`)
  }
}

function appendCriticalQuestionsSection(lines, surfaceQuestions) {
  if (!surfaceQuestions) return

  lines.push('')
  lines.push('必须回答的关键问题：')
  for (const question of surfaceQuestions.questions) {
    lines.push(`- ${question}`)
  }
  lines.push('')
  lines.push('回答是否可落地的判断标准：')
  for (const check of surfaceQuestions.decisionChecks) {
    lines.push(`- ${check}`)
  }
}
