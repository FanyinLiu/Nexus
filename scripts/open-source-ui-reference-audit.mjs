#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOpenSourceUiReferenceAuditCli } from './open-source-ui-reference-cli.mjs'
import { SURFACE_EVIDENCE, SURFACE_REVIEW_QUEUE } from './open-source-ui-reference-evidence.mjs'
import {
  buildImplementationBrief,
  buildImplementationReadiness,
  buildImplementationStatus,
  buildProAnswerQualityChecklist,
  buildProHandoffPackage,
  buildProQuestionMatrix,
  buildProReviewReadiness,
  buildProReviewIntakeTemplate,
  buildProRecordTemplate,
  buildProReviewPrompt,
  buildProSendPayload,
  buildSurfaceQuestions,
} from './open-source-ui-reference-pro-workflow.mjs'
import {
  SURFACE_PATTERN_MATRIX,
  buildPatternComparison,
  buildSurfacePatterns,
} from './open-source-ui-reference-patterns.mjs'
import {
  PRO_REVIEW_REGISTRY_FILE,
  buildNextProReview,
  buildProReviewRegistryTransition,
  buildProReviewStateGuide,
  buildRegistryStatus,
  findProReviewRegistryIssues,
  formatNextProReview,
  parseProReviewRegistry,
} from './open-source-ui-reference-registry.mjs'
import {
  AGENT_ACTIVITY_REVIEW_DOC,
  CHAT_REVIEW_DOC,
  COMPOSER_REVIEW_DOC,
  DESIGN_CHECKLIST_DOC,
  IMAGE4_PATTERNS_DOC,
  IMAGE4_REVIEW_DOC,
  OPEN_SOURCE_DOC,
  PACKAGE_FILE,
  REFERENCE_MANIFEST_FILE,
  REQUIRED_AGENT_ACTIVITY_REVIEW_PHRASES,
  REQUIRED_BORROWING_RULES,
  REQUIRED_CHAT_REVIEW_PHRASES,
  REQUIRED_COMPOSER_REVIEW_PHRASES,
  REQUIRED_CROSS_DOC_PHRASES,
  REQUIRED_FILES as BASE_REQUIRED_FILES,
  REQUIRED_IMAGE4_REVIEW_PHRASES,
  REQUIRED_MANIFEST_POLICY,
  REQUIRED_OPEN_SOURCE_SECTIONS,
  REQUIRED_SETTINGS_REVIEW_PHRASES,
  SETTINGS_REVIEW_DOC,
  UNSAFE_BORROWING_PATTERNS,
} from './open-source-ui-reference-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  ...BASE_REQUIRED_FILES.slice(0, 1),
  PRO_REVIEW_REGISTRY_FILE,
  ...BASE_REQUIRED_FILES.slice(1),
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function readRequiredFiles(root) {
  const missingFiles = []
  const files = new Map()

  for (const file of REQUIRED_FILES) {
    const text = readProjectFile(root, file)
    if (text === null) {
      missingFiles.push({ file })
    } else {
      files.set(file, text)
    }
  }

  return { files, missingFiles }
}

function parseReferenceManifest(files) {
  const text = files.get(REFERENCE_MANIFEST_FILE)
  if (typeof text !== 'string') return { manifest: null, invalidManifest: [] }

  try {
    return { manifest: JSON.parse(text), invalidManifest: [] }
  } catch (error) {
    return {
      manifest: null,
      invalidManifest: [{
        file: REFERENCE_MANIFEST_FILE,
        issue: 'invalid-json',
        message: error.message,
      }],
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function findManifestIssues(manifest) {
  const issues = []

  if (!isPlainObject(manifest)) {
    return [{ file: REFERENCE_MANIFEST_FILE, path: '$', issue: 'manifest must be an object' }]
  }

  if (manifest.schemaVersion !== 1) {
    issues.push({
      file: REFERENCE_MANIFEST_FILE,
      path: 'schemaVersion',
      issue: 'schemaVersion must be 1',
    })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.lastChecked ?? '')) {
    issues.push({
      file: REFERENCE_MANIFEST_FILE,
      path: 'lastChecked',
      issue: 'lastChecked must be YYYY-MM-DD',
    })
  }

  for (const [key, expectedValue] of Object.entries(REQUIRED_MANIFEST_POLICY)) {
    if (manifest.policy?.[key] !== expectedValue) {
      issues.push({
        file: REFERENCE_MANIFEST_FILE,
        path: `policy.${key}`,
        issue: `must equal ${JSON.stringify(expectedValue)}`,
      })
    }
  }

  if (!Array.isArray(manifest.references) || manifest.references.length === 0) {
    issues.push({
      file: REFERENCE_MANIFEST_FILE,
      path: 'references',
      issue: 'references must be a non-empty array',
    })
    return issues
  }

  if (!Array.isArray(manifest.requiredSurfaceCoverage) || manifest.requiredSurfaceCoverage.length === 0) {
    issues.push({
      file: REFERENCE_MANIFEST_FILE,
      path: 'requiredSurfaceCoverage',
      issue: 'requiredSurfaceCoverage must be a non-empty array',
    })
  } else {
    const surfaces = new Set()
    for (const [index, coverage] of manifest.requiredSurfaceCoverage.entries()) {
      const path = `requiredSurfaceCoverage[${index}]`
      if (!isPlainObject(coverage)) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path, issue: 'coverage entry must be an object' })
        continue
      }
      if (!hasText(coverage.surface)) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.surface`, issue: 'missing surface' })
      } else if (surfaces.has(coverage.surface)) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.surface`, issue: 'duplicate required surface' })
      } else {
        surfaces.add(coverage.surface)
      }
      if (!Number.isInteger(coverage.minReferences) || coverage.minReferences < 1) {
        issues.push({
          file: REFERENCE_MANIFEST_FILE,
          path: `${path}.minReferences`,
          issue: 'minReferences must be a positive integer',
        })
      }
      if (!hasText(coverage.reason)) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.reason`, issue: 'missing reason' })
      }
    }
  }

  const ids = new Set()
  for (const [index, reference] of manifest.references.entries()) {
    const path = `references[${index}]`

    if (!isPlainObject(reference)) {
      issues.push({ file: REFERENCE_MANIFEST_FILE, path, issue: 'reference must be an object' })
      continue
    }

    for (const field of ['id', 'name', 'repository', 'borrow', 'avoid']) {
      if (!hasText(reference[field])) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.${field}`, issue: 'missing text value' })
      }
    }

    if (hasText(reference.id)) {
      if (ids.has(reference.id)) {
        issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.id`, issue: 'duplicate reference id' })
      }
      ids.add(reference.id)
    }

    if (hasText(reference.repository) && !reference.repository.startsWith('https://github.com/')) {
      issues.push({
        file: REFERENCE_MANIFEST_FILE,
        path: `${path}.repository`,
        issue: 'repository must be a GitHub HTTPS URL',
      })
    }

    if (!hasText(reference.observedHead?.branch)) {
      issues.push({ file: REFERENCE_MANIFEST_FILE, path: `${path}.observedHead.branch`, issue: 'missing branch' })
    }

    if (!/^[0-9a-f]{40}$/.test(reference.observedHead?.commit ?? '')) {
      issues.push({
        file: REFERENCE_MANIFEST_FILE,
        path: `${path}.observedHead.commit`,
        issue: 'commit must be a 40-character SHA-1',
      })
    }

    if (!Array.isArray(reference.surfaces) || reference.surfaces.length === 0 || !reference.surfaces.every(hasText)) {
      issues.push({
        file: REFERENCE_MANIFEST_FILE,
        path: `${path}.surfaces`,
        issue: 'surfaces must be a non-empty text array',
      })
    }
  }

  return issues
}

function getManifestReferences(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.references)) return []
  return manifest.references
}

function getRequiredSurfaceCoverage(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.requiredSurfaceCoverage)) return []
  return manifest.requiredSurfaceCoverage
}

function buildSurfaceCoverage(references, requiredCoverage) {
  return requiredCoverage
    .filter((coverage) => hasText(coverage.surface) && Number.isInteger(coverage.minReferences))
    .map((coverage) => {
      const coveredReferences = references
        .filter((reference) => Array.isArray(reference.surfaces) && reference.surfaces.includes(coverage.surface))
        .map((reference) => ({
          id: reference.id,
          name: reference.name,
          repository: reference.repository,
        }))

      return {
        surface: coverage.surface,
        minReferences: coverage.minReferences,
        coveredReferences,
        reason: coverage.reason ?? '',
        ok: coveredReferences.length >= coverage.minReferences,
      }
    })
}

function findSurfaceCoverageIssues(surfaceCoverage) {
  return surfaceCoverage
    .filter((coverage) => !coverage.ok)
    .map((coverage) => ({
      file: REFERENCE_MANIFEST_FILE,
      surface: coverage.surface,
      minReferences: coverage.minReferences,
      coveredReferences: coverage.coveredReferences,
    }))
}

function formatCoverageNames(coverage) {
  if (!coverage.coveredReferences.length) return 'none'
  return coverage.coveredReferences.map((reference) => reference.name).join(', ')
}

function buildCoverageSummaryLines(surfaceCoverage) {
  return surfaceCoverage.map((coverage) => (
    `  - ${coverage.surface}: ${coverage.coveredReferences.length}/${coverage.minReferences} ${formatCoverageNames(coverage)}`
  ))
}

function buildSurfaceReview(references, surfaceCoverage, surface) {
  if (!hasText(surface)) return null

  const coverage = surfaceCoverage.find((item) => item.surface === surface)
  if (!coverage) return null

  const surfaceReferences = references
    .filter((reference) => Array.isArray(reference.surfaces) && reference.surfaces.includes(surface))
    .map((reference) => ({
      id: reference.id,
      name: reference.name,
      repository: reference.repository,
      borrow: reference.borrow,
      avoid: reference.avoid,
      surfaces: reference.surfaces,
    }))

  return {
    surface,
    ok: coverage.ok,
    minReferences: coverage.minReferences,
    reason: coverage.reason,
    references: surfaceReferences,
    reviewRules: [
      'Borrow constraints, not skins.',
      'Map the borrowed behavior to this Nexus surface before changing UI.',
      'Do not copy exact spacing, color, radius, blur, shadow, or component skin.',
      'Use human review for perceived polish; keep hard CI to deterministic contracts.',
    ],
  }
}

function buildSurfaceEvidence(surfaceReview) {
  if (!surfaceReview) return null

  const evidence = SURFACE_EVIDENCE[surfaceReview.surface]
  if (!evidence) return {
    surface: surfaceReview.surface,
    docs: [OPEN_SOURCE_DOC],
    sourceFiles: [],
    commands: [`npm run ui:references:audit -- --surface=${surfaceReview.surface}`],
    researchNotes: [],
    browserChecks: [],
    privacy: {
      staticSourceOnly: true,
      excludes: ['secrets', 'private logs', 'credentials', 'memory contents', 'unrelated source dumps'],
    },
  }

  return {
    surface: surfaceReview.surface,
    docs: evidence.docs,
    sourceFiles: evidence.sourceFiles,
    commands: evidence.commands,
    researchNotes: evidence.researchNotes ?? [],
    browserChecks: evidence.browserChecks,
    privacy: {
      staticSourceOnly: true,
      excludes: ['secrets', 'private logs', 'credentials', 'memory contents', 'unrelated source dumps'],
    },
  }
}

function buildSurfaceReviewQueue(references, surfaceCoverage) {
  return SURFACE_REVIEW_QUEUE.map((queueItem) => {
    const surfaceReview = buildSurfaceReview(references, surfaceCoverage, queueItem.surface)
    const surfaceEvidence = buildSurfaceEvidence(surfaceReview)

    return {
      surface: queueItem.surface,
      priority: queueItem.priority,
      phase: queueItem.phase,
      focus: queueItem.focus,
      whyNow: queueItem.whyNow,
      ok: surfaceReview?.ok ?? false,
      references: surfaceReview?.references.map((reference) => reference.name) ?? [],
      proPromptCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --pro-prompt --evidence`,
      proHandoffCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --pro-handoff`,
      proSendPayloadCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --pro-send-payload`,
      questionsCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --questions`,
      patternsCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --patterns`,
      evidenceCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --evidence`,
      answerQualityCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --pro-answer-quality`,
      intakeTemplateCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --review-intake-template`,
      recordTemplateCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --record-template`,
      implementationReadinessCommand: `npm run ui:references:audit -- --surface=${queueItem.surface} --implementation-readiness`,
      firstLocalCommand: surfaceEvidence?.commands[0] ?? `npm run ui:references:audit -- --surface=${queueItem.surface}`,
      browserCheck: surfaceEvidence?.browserChecks[0] ?? '',
    }
  })
}

function findUnknownSurfaceRequests(surfaceCoverage, surface) {
  if (!hasText(surface)) return []
  if (surfaceCoverage.some((item) => item.surface === surface)) return []
  return [{
    file: REFERENCE_MANIFEST_FILE,
    surface,
    availableSurfaces: surfaceCoverage.map((item) => item.surface),
  }]
}

function findPromptRequestIssues(options, surface, surfaceReview) {
  if (!options.proPrompt) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'pro prompt requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findHandoffRequestIssues(options, surface, surfaceReview) {
  if (!options.proHandoff) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'pro handoff requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findEvidenceRequestIssues(options, surface, surfaceReview) {
  if (!options.evidence) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'evidence output requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findRecordTemplateRequestIssues(options, surface, surfaceReview) {
  if (!options.recordTemplate) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'record template requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findImplementationBriefRequestIssues(options, surface, surfaceReview) {
  if (!options.implementationBrief) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'implementation brief requires a valid --surface value or next Pro review',
    surface: surface ?? null,
  }]
}

function findIntakeTemplateRequestIssues(options, surface, surfaceReview) {
  if (!options.intakeTemplate) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'review intake template requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findQuestionsRequestIssues(options, surface, surfaceReview) {
  if (!options.questions) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'questions output requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findPatternsRequestIssues(options, surface, surfaceReview) {
  if (!options.patterns) return []
  if (surfaceReview) return []

  return [{
    file: REFERENCE_MANIFEST_FILE,
    issue: 'patterns output requires a valid --surface value',
    surface: surface ?? null,
  }]
}

function findMissingPatternMatrixEntries(surfaceCoverage) {
  return surfaceCoverage
    .filter((coverage) => !Array.isArray(SURFACE_PATTERN_MATRIX[coverage.surface])
      || SURFACE_PATTERN_MATRIX[coverage.surface].length === 0)
    .map((coverage) => ({
      file: 'scripts/open-source-ui-reference-patterns.mjs',
      surface: coverage.surface,
      issue: 'missing surface pattern matrix entries',
    }))
}

function findMissingReferences(files, references) {
  const text = files.get(OPEN_SOURCE_DOC)
  if (typeof text !== 'string') return []

  return references
    .filter((reference) => !text.includes(reference.name) || !text.includes(reference.repository))
    .map((reference) => ({
      reference: reference.name,
      missing: [
        !text.includes(reference.name) ? 'name' : null,
        !text.includes(reference.repository) ? 'repository' : null,
      ].filter(Boolean),
    }))
}

function findMissingRemoteEvidence(files, references) {
  const text = files.get(OPEN_SOURCE_DOC)
  if (typeof text !== 'string') return []

  return references
    .filter((reference) => !text.includes(reference.observedHead.branch) || !text.includes(reference.observedHead.commit))
    .map((reference) => ({
      reference: reference.name,
      missing: [
        !text.includes(reference.observedHead.branch) ? 'branch' : null,
        !text.includes(reference.observedHead.commit) ? 'commit' : null,
      ].filter(Boolean),
    }))
}

function findMissingSections(files) {
  const text = files.get(OPEN_SOURCE_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_OPEN_SOURCE_SECTIONS
    .filter((section) => !text.includes(`## ${section}`))
    .map((section) => ({ file: OPEN_SOURCE_DOC, section }))
}

function findMissingBorrowingRules(files) {
  const text = files.get(OPEN_SOURCE_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_BORROWING_RULES
    .filter((rule) => !text.includes(rule))
    .map((rule) => ({ file: OPEN_SOURCE_DOC, rule }))
}

function findMissingChatReviewPhrases(files) {
  const text = files.get(CHAT_REVIEW_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_CHAT_REVIEW_PHRASES
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({ file: CHAT_REVIEW_DOC, phrase }))
}

function findMissingImage4ReviewPhrases(files) {
  const text = files.get(IMAGE4_REVIEW_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_IMAGE4_REVIEW_PHRASES
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({ file: IMAGE4_REVIEW_DOC, phrase }))
}

function findMissingComposerReviewPhrases(files) {
  const text = files.get(COMPOSER_REVIEW_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_COMPOSER_REVIEW_PHRASES
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({ file: COMPOSER_REVIEW_DOC, phrase }))
}

function findMissingSettingsReviewPhrases(files) {
  const text = files.get(SETTINGS_REVIEW_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_SETTINGS_REVIEW_PHRASES
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({ file: SETTINGS_REVIEW_DOC, phrase }))
}

function findMissingAgentActivityReviewPhrases(files) {
  const text = files.get(AGENT_ACTIVITY_REVIEW_DOC)
  if (typeof text !== 'string') return []

  return REQUIRED_AGENT_ACTIVITY_REVIEW_PHRASES
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({ file: AGENT_ACTIVITY_REVIEW_DOC, phrase }))
}

function findMissingCrossLinks(files) {
  const missingCrossLinks = []

  for (const item of REQUIRED_CROSS_DOC_PHRASES) {
    const text = files.get(item.file)
    if (typeof text !== 'string' || !text.includes(item.text)) {
      missingCrossLinks.push(item)
    }
  }

  return missingCrossLinks
}

function findPackageScriptIssues(files) {
  const text = files.get(PACKAGE_FILE)
  if (typeof text !== 'string') return [{ file: PACKAGE_FILE, issue: 'missing-package-json' }]

  try {
    const pkg = JSON.parse(text)
    const scripts = pkg.scripts ?? {}
    const issues = []
    if (scripts['ui:references:audit'] !== 'node scripts/open-source-ui-reference-audit.mjs') {
      issues.push({
        file: PACKAGE_FILE,
        script: 'ui:references:audit',
        expected: 'node scripts/open-source-ui-reference-audit.mjs',
        actual: scripts['ui:references:audit'] ?? null,
      })
    }
    if (typeof scripts['verify:pr'] !== 'string' || !scripts['verify:pr'].includes('ui:references:audit')) {
      issues.push({
        file: PACKAGE_FILE,
        script: 'verify:pr',
        issue: 'reference audit must run in verify:pr so UI source-backed contracts cannot drift silently',
      })
    }
    return issues
  } catch (error) {
    return [{ file: PACKAGE_FILE, issue: 'invalid-json', message: error.message }]
  }
}

function findUnsafeBorrowingLanguage(files) {
  const unsafeBorrowingLanguage = []

  for (const file of [
    OPEN_SOURCE_DOC,
    CHAT_REVIEW_DOC,
    COMPOSER_REVIEW_DOC,
    IMAGE4_REVIEW_DOC,
    SETTINGS_REVIEW_DOC,
    AGENT_ACTIVITY_REVIEW_DOC,
    IMAGE4_PATTERNS_DOC,
    DESIGN_CHECKLIST_DOC,
  ]) {
    const text = files.get(file)
    if (typeof text !== 'string') continue
    const lines = text.split(/\r?\n/)

    lines.forEach((line, index) => {
      for (const rule of UNSAFE_BORROWING_PATTERNS) {
        if (rule.pattern.test(line)) {
          unsafeBorrowingLanguage.push({
            file,
            line: index + 1,
            id: rule.id,
            description: rule.description,
            text: line.trim(),
          })
        }
      }
    })
  }

  return unsafeBorrowingLanguage
}

function resolveRemoteHeadWithGit(reference) {
  const output = execFileSync('git', [
    'ls-remote',
    reference.repository,
    reference.observedHead.branch,
  ], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim()

  if (!output) {
    return {
      ok: false,
      error: `No remote head found for ${reference.observedHead.branch}`,
    }
  }

  const [commit, branch] = output.split(/\s+/)
  return { ok: true, commit, branch }
}

export function buildReferenceRefreshCheck(
  references,
  {
    resolveRemoteHead = resolveRemoteHeadWithGit,
    checkedAt = new Date().toISOString().slice(0, 10),
  } = {},
) {
  const items = references.map((reference) => {
    try {
      const remote = resolveRemoteHead(reference)
      if (!remote?.ok) {
        return {
          id: reference.id,
          name: reference.name,
          repository: reference.repository,
          branch: reference.observedHead.branch,
          observedCommit: reference.observedHead.commit,
          currentCommit: null,
          status: 'failed',
          error: remote?.error ?? 'Unknown remote check failure.',
        }
      }

      return {
        id: reference.id,
        name: reference.name,
        repository: reference.repository,
        branch: remote.branch ?? reference.observedHead.branch,
        observedCommit: reference.observedHead.commit,
        currentCommit: remote.commit,
        status: remote.commit === reference.observedHead.commit ? 'unchanged' : 'changed',
      }
    } catch (error) {
      return {
        id: reference.id,
        name: reference.name,
        repository: reference.repository,
        branch: reference.observedHead.branch,
        observedCommit: reference.observedHead.commit,
        currentCommit: null,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const changed = items.filter((item) => item.status === 'changed')
  const failed = items.filter((item) => item.status === 'failed')

  return {
    checkedAt,
    manualOnly: true,
    liveNetwork: true,
    command: 'npm run ui:references:audit -- --reference-refresh-check',
    total: items.length,
    changedCount: changed.length,
    failedCount: failed.length,
    unchangedCount: items.length - changed.length - failed.length,
    ok: failed.length === 0,
    items,
  }
}

export function buildOpenSourceUiReferenceAuditReport(root = ROOT, options = {}) {
  const { files, missingFiles } = readRequiredFiles(root)
  const { manifest, invalidManifest } = parseReferenceManifest(files)
  const { registry: proReviewRegistry, invalidRegistry } = parseProReviewRegistry(files.get(PRO_REVIEW_REGISTRY_FILE))
  const manifestIssues = findManifestIssues(manifest)
  const references = getManifestReferences(manifest)
  const surfaceCoverage = buildSurfaceCoverage(references, getRequiredSurfaceCoverage(manifest))
  const baseReviewQueue = buildSurfaceReviewQueue(references, surfaceCoverage)
  const requestedSurface = hasText(options.surface) ? options.surface.trim() : null
  const nextProReview = options.nextProReview || options.nextProHandoff || options.proReadiness || options.proSendPayload
    || options.proAnswerQuality || options.implementationBrief || options.implementationReadiness
    || options.proRegistryTransition
    ? buildNextProReview(baseReviewQueue, proReviewRegistry)
    : null
  const surface = options.nextProHandoff
    || ((options.proReadiness || options.proSendPayload) && !requestedSurface)
    || ((options.proAnswerQuality || options.implementationBrief || options.implementationReadiness) && !requestedSurface)
    ? nextProReview?.surface ?? null
    : requestedSurface
  const surfaceReview = buildSurfaceReview(references, surfaceCoverage, surface)
  const surfaceEvidence = options.evidence || options.proHandoff || options.nextProHandoff || options.proReadiness
    || options.proSendPayload || options.proAnswerQuality || options.implementationBrief
    ? buildSurfaceEvidence(surfaceReview)
    : null
  const registryStatus = buildRegistryStatus(proReviewRegistry, surfaceCoverage)
  const selectedRegistryStatus = registryStatus.find((item) => item.surface === surface) ?? null
  const selectedQueueItem = baseReviewQueue.find((item) => item.surface === surface) ?? null
  const selectedReviewTarget = selectedQueueItem && selectedRegistryStatus
    ? {
      ...selectedQueueItem,
      status: selectedRegistryStatus.status,
      decision: selectedRegistryStatus.decision,
      nextAction: selectedRegistryStatus.nextAction,
    }
    : nextProReview
  const reviewQueue = options.queue || options.reviewRunbook ? baseReviewQueue : []
  const implementationStatus = options.implementationStatus
    ? buildImplementationStatus({ reviewQueue: baseReviewQueue, registryStatus })
    : null
  const surfaceQuestions = options.questions || options.proReadiness ? buildSurfaceQuestions(surfaceReview) : null
  const surfacePatterns = options.patterns || options.proReadiness ? buildSurfacePatterns(surfaceReview) : null
  const patternComparison = options.patternComparison || options.proReadiness || options.questionMatrix
    ? buildPatternComparison()
    : null
  const proReviewStateGuide = options.stateGuide ? buildProReviewStateGuide() : []
  const proPrompt = options.proPrompt ? buildProReviewPrompt(surfaceReview, surfaceEvidence) : null
  const proHandoffPackage = options.proHandoff || options.nextProHandoff
    ? buildProHandoffPackage(surfaceReview, surfaceEvidence)
    : null
  const proSendPayload = options.proSendPayload ? buildProSendPayload(surfaceReview, surfaceEvidence) : null
  const proAnswerQualityChecklist = options.proAnswerQuality
    ? buildProAnswerQualityChecklist(surfaceReview, surfaceEvidence)
    : null
  const proReviewIntakeTemplate = options.intakeTemplate
    ? buildProReviewIntakeTemplate(surfaceReview, surfaceEvidence ?? buildSurfaceEvidence(surfaceReview))
    : null
  const proRecordTemplate = options.recordTemplate
    ? buildProRecordTemplate(surfaceReview, surfaceEvidence ?? buildSurfaceEvidence(surfaceReview))
    : null
  const implementationBrief = options.implementationBrief
    ? buildImplementationBrief(surfaceReview, surfaceEvidence ?? buildSurfaceEvidence(surfaceReview))
    : null
  const implementationReadiness = options.implementationReadiness
    ? buildImplementationReadiness({
      surfaceReview,
      surfaceEvidence: surfaceEvidence ?? buildSurfaceEvidence(surfaceReview),
      surfacePatterns: surfacePatterns ?? buildSurfacePatterns(surfaceReview),
      registryStatus: selectedRegistryStatus,
    })
    : null
  const proReviewReadiness = options.proReadiness
    ? buildProReviewReadiness({
      nextProReview: selectedReviewTarget,
      surfaceReview,
      surfaceEvidence,
      surfaceQuestions,
      surfacePatterns,
      patternComparison,
    })
    : null
  const proReviewRegistryTransition = options.proRegistryTransition
    ? buildProReviewRegistryTransition(selectedReviewTarget, options.proRegistryTransition)
    : null
  const proQuestionMatrix = options.questionMatrix
    ? buildProQuestionMatrix({
      reviewQueue: baseReviewQueue,
      registryStatus,
      patternComparison,
    })
    : null
  const referenceRefreshCheck = options.referenceRefreshCheck
    ? buildReferenceRefreshCheck(references, {
      resolveRemoteHead: options.referenceRefreshResolver,
      checkedAt: options.referenceRefreshDate,
    })
    : null
  const proReviewRegistryIssues = typeof files.get(PRO_REVIEW_REGISTRY_FILE) === 'string' && invalidRegistry.length === 0
    ? findProReviewRegistryIssues(proReviewRegistry, surfaceCoverage, baseReviewQueue)
    : []
  const errors = {
    missingFiles,
    invalidManifest,
    invalidRegistry,
    manifestIssues,
    proReviewRegistryIssues,
    surfaceCoverageIssues: findSurfaceCoverageIssues(surfaceCoverage),
    unknownSurfaceRequests: findUnknownSurfaceRequests(surfaceCoverage, requestedSurface),
    promptRequestIssues: findPromptRequestIssues(options, surface, surfaceReview),
    handoffRequestIssues: findHandoffRequestIssues(options, surface, surfaceReview),
    evidenceRequestIssues: findEvidenceRequestIssues(options, surface, surfaceReview),
    intakeTemplateRequestIssues: findIntakeTemplateRequestIssues(options, surface, surfaceReview),
    recordTemplateRequestIssues: findRecordTemplateRequestIssues(options, surface, surfaceReview),
    implementationBriefRequestIssues: findImplementationBriefRequestIssues(options, surface, surfaceReview),
    questionsRequestIssues: findQuestionsRequestIssues(options, surface, surfaceReview),
    patternsRequestIssues: findPatternsRequestIssues(options, surface, surfaceReview),
    proReadinessIssues: proReviewReadiness?.issues ?? [],
    implementationReadinessIssues: implementationReadiness?.issues ?? [],
    referenceRefreshIssues: referenceRefreshCheck && !referenceRefreshCheck.ok
      ? referenceRefreshCheck.items
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          file: REFERENCE_MANIFEST_FILE,
          reference: item.name,
          issue: 'remote-head-check-failed',
          detail: item.error,
        }))
      : [],
    proRegistryTransitionIssues: proReviewRegistryTransition && !proReviewRegistryTransition.ok
      ? [{ file: PRO_REVIEW_REGISTRY_FILE, issue: proReviewRegistryTransition.issue }]
      : [],
    missingReferences: findMissingReferences(files, references),
    missingRemoteEvidence: findMissingRemoteEvidence(files, references),
    missingSections: findMissingSections(files),
    missingBorrowingRules: findMissingBorrowingRules(files),
    missingChatReviewPhrases: findMissingChatReviewPhrases(files),
    missingComposerReviewPhrases: findMissingComposerReviewPhrases(files),
    missingImage4ReviewPhrases: findMissingImage4ReviewPhrases(files),
    missingSettingsReviewPhrases: findMissingSettingsReviewPhrases(files),
    missingAgentActivityReviewPhrases: findMissingAgentActivityReviewPhrases(files),
    missingPatternMatrixEntries: findMissingPatternMatrixEntries(surfaceCoverage),
    missingCrossLinks: findMissingCrossLinks(files),
    missingPackageScripts: findPackageScriptIssues(files),
    unsafeBorrowingLanguage: findUnsafeBorrowingLanguage(files),
  }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    manifest: {
      file: REFERENCE_MANIFEST_FILE,
      lastChecked: manifest?.lastChecked ?? null,
      schemaVersion: manifest?.schemaVersion ?? null,
    },
    requiredSurfaceCoverage: getRequiredSurfaceCoverage(manifest),
    surfaceCoverage,
    surfaceReview,
    surfaceEvidence,
    surfaceQuestions,
    surfacePatterns,
    patternComparison,
    proReviewRegistry: {
      file: PRO_REVIEW_REGISTRY_FILE,
      lastUpdated: proReviewRegistry?.lastUpdated ?? null,
      status: registryStatus,
    },
    proReviewStateGuide,
    nextProReview,
    reviewQueue,
    implementationStatus,
    proPrompt,
    proHandoffPackage,
    proSendPayload,
    proAnswerQualityChecklist,
    proReviewIntakeTemplate,
    proRecordTemplate,
    implementationBrief,
    implementationReadiness,
    referenceRefreshCheck,
    proReviewReadiness,
    proReviewRegistryTransition,
    proQuestionMatrix,
    references,
    checkedFiles: REQUIRED_FILES,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    policy: manifest?.policy ?? REQUIRED_MANIFEST_POLICY,
  }
}

function formatHumanReport(report) {
  const lines = ['Open-source UI reference audit']
  lines.push(`- references: ${report.references.length}`)
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.policy.staticSourceOnly}`)
  lines.push(`- live network gate: ${report.policy.liveNetworkGate}`)
  lines.push(`- surface coverage: ${report.surfaceCoverage.filter((coverage) => coverage.ok).length}/${report.surfaceCoverage.length}`)
  lines.push(...buildCoverageSummaryLines(report.surfaceCoverage))
  if (report.proReviewRegistry.status.length) {
    lines.push('- Pro review registry:')
    for (const item of report.proReviewRegistry.status) {
      lines.push(`  - ${item.surface}: ${item.status}/${item.decision} ${item.nextAction}`)
    }
  }

  if (report.nextProReview) {
    lines.push('')
    lines.push(formatNextProReview(report.nextProReview))
  }

  if (report.surfaceReview) {
    lines.push('')
    lines.push(`Surface review: ${report.surfaceReview.surface}`)
    lines.push(`- references: ${report.surfaceReview.references.length}/${report.surfaceReview.minReferences}`)
    lines.push(`- reason: ${report.surfaceReview.reason}`)
    for (const reference of report.surfaceReview.references) {
      lines.push(`  - ${reference.name}: borrow ${reference.borrow} Avoid ${reference.avoid}`)
    }
    lines.push('- review rules:')
    for (const rule of report.surfaceReview.reviewRules) {
      lines.push(`  - ${rule}`)
    }
  }

  if (report.surfaceEvidence) {
    lines.push('')
    lines.push(`Surface evidence: ${report.surfaceEvidence.surface}`)
    lines.push('- docs:')
    for (const doc of report.surfaceEvidence.docs) {
      lines.push(`  - ${doc}`)
    }
    if (report.surfaceEvidence.sourceFiles.length) {
      lines.push('- source files:')
      for (const file of report.surfaceEvidence.sourceFiles) {
        lines.push(`  - ${file}`)
      }
    }
    lines.push('- commands:')
    for (const command of report.surfaceEvidence.commands) {
      lines.push(`  - ${command}`)
    }
    if (report.surfaceEvidence.researchNotes?.length) {
      lines.push('- research anchors:')
      for (const note of report.surfaceEvidence.researchNotes) {
        lines.push(`  - ${note}`)
      }
    }
    if (report.surfaceEvidence.browserChecks.length) {
      lines.push('- browser checks:')
      for (const check of report.surfaceEvidence.browserChecks) {
        lines.push(`  - ${check}`)
      }
    }
  }

  if (report.reviewQueue.length) {
    lines.push('')
    lines.push('Review queue:')
    for (const item of report.reviewQueue) {
      lines.push(`${item.priority}. ${item.surface} (${item.phase})`)
      lines.push(`  - focus: ${item.focus}`)
      lines.push(`  - why now: ${item.whyNow}`)
      lines.push(`  - references: ${item.references.length ? item.references.join(', ') : 'none'}`)
      lines.push(`  - Pro: ${item.proPromptCommand}`)
      lines.push(`  - handoff: ${item.proHandoffCommand}`)
      lines.push(`  - send payload: ${item.proSendPayloadCommand}`)
      lines.push(`  - questions: ${item.questionsCommand}`)
      lines.push(`  - patterns: ${item.patternsCommand}`)
      lines.push(`  - intake: ${item.intakeTemplateCommand}`)
      lines.push(`  - record: ${item.recordTemplateCommand}`)
      lines.push(`  - check: ${item.firstLocalCommand}`)
    }
  }
  lines.push('')

  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map(formatErrorItem).join(', ')}`)
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function formatErrorItem(item) {
  if (item.reference) return `${item.reference} missing ${item.missing.join(' | ')}`
  if (item.availableSurfaces) return `${item.file}:${item.surface} unknown surface, available ${item.availableSurfaces.join(' | ')}`
  if (item.issue && Object.hasOwn(item, 'surface')) return `${item.file}:${item.issue}${item.surface ? ` (${item.surface})` : ''}`
  if (item.surface) return `${item.file}:${item.surface} covered ${item.coveredReferences.length}/${item.minReferences}`
  if (item.section) return `${item.file} missing section ${item.section}`
  if (item.rule) return `${item.file} missing rule ${item.rule}`
  if (item.phrase) return `${item.file} missing phrase ${item.phrase}`
  if (item.path) return `${item.file}:${item.path} ${item.issue}`
  if (item.text) return `${item.file}:${item.line} ${item.id}`
  if (item.script) return `${item.file}:${item.script}`
  return item.file
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  runOpenSourceUiReferenceAuditCli(process.argv.slice(2), {
    root: ROOT,
    buildReport: buildOpenSourceUiReferenceAuditReport,
    formatHumanReport,
  })
}
