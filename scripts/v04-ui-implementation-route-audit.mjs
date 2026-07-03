#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const ROUTE_DOC = 'docs/V0.4_UI_IMPLEMENTATION_ROUTE.md'
const REFERENCE_AUDIT_DOC = 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'

const REQUIRED_FILES = [
  ROUTE_DOC,
  REFERENCE_AUDIT_DOC,
  'docs/open-source-ui-pro-review-registry.json',
  'docs/open-source-ui-reference-manifest.json',
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
  'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
  'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md',
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
  'package.json',
]

const REQUIRED_ROUTE_PATTERNS = [
  { id: 'title', text: '# Nexus 0.4 UI Implementation Route' },
  { id: 'source-of-truth', text: '## Source Of Truth' },
  { id: 'hard-rule', text: 'No raw Pro answer becomes code.' },
  { id: 'implementation-order', text: '## Implementation Order' },
  { id: 'contract-freeze', text: 'Contract freeze' },
  { id: 'image4-shell-and-rhythm', text: 'Image4 shell and rhythm' },
  { id: 'companion-tone-and-color', text: 'Companion tone and color' },
  { id: 'composer-and-input-controls', text: 'Composer and input controls' },
  { id: 'chat-and-streaming', text: 'Chat and streaming' },
  { id: 'settings-forms-and-focus', text: 'Settings, forms, and focus' },
  { id: 'agent-activity-and-desktop-awareness', text: 'Agent activity and desktop awareness' },
  { id: 'human-browser-review', text: 'Human browser review' },
  { id: 'cross-surface-guardrails', text: '## Cross-Surface Guardrails' },
  { id: 'verification-spine', text: '## Verification Spine' },
  { id: 'acceptance', text: '## Acceptance' },
  { id: 'pre-send-payload-boundary', text: 'Generating a Pro payload is not the same as asking Pro.' },
  { id: 'user-confirmed-external-send', text: 'after user confirmation' },
  { id: 'pending-surface-block', text: 'do not start implementation for that surface' },
]

const SURFACE_DOCS = [
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md',
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
  'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
  'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
  'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md',
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
]

const REQUIRED_COMMANDS = [
  'npm run v04:ui-route:audit',
  'npm run ui:references:audit',
  'npm run ui:references:audit -- --pro-readiness',
  'npm run ui:references:audit -- --implementation-status',
  'npm run ui:references:audit -- --surface=<surface> --pro-send-payload',
  'npm run ui:references:audit -- --surface=<surface> --pro-registry-transition=sent',
  'npm run image4:color:audit',
  'npm run image4:visual-contract:audit',
  'npm run image4:contract:check',
  'npm run composer:surface:audit',
  'npm run chat:surface:audit',
  'npm run settings:surface:audit',
  'npm run forms:surface:audit',
  'npm run focus:surface:audit',
  'npm run streaming:surface:audit',
  'npm run agent-activity:surface:audit',
  'npm run source-size:audit',
  'npx tsc -b --pretty false',
  'npm run build',
]

const REQUIRED_GUARDRAILS = [
  'Borrow constraints, not skins.',
  'Companion-first beats dashboard or workbench framing.',
  'No card stack, nested cards, cockpit, terminal log, timeline, or autonomous task board as default UI.',
  'Do not make headers, buttons, or utility controls larger to fix visual hierarchy.',
  'Text must fit within its own container on narrow and normal panel widths.',
  'Motion should clarify state only',
  'Theme changes must be scoped to the surface being changed.',
]

const FORBIDDEN_ROUTE_PATTERNS = [
  {
    id: 'raw-pro-to-source',
    patterns: [
      /paste Pro answer into source/i,
      /apply raw Pro output directly/i,
      /raw Pro output is implementation/i,
    ],
  },
  {
    id: 'clone-reference-skin',
    patterns: [
      /use cloned reference skin/i,
      /copy exact open-source skin into Nexus/i,
      /match .* product chrome exactly as implementation/i,
    ],
  },
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function findMissingFiles(root) {
  return REQUIRED_FILES.filter((file) => !existsSync(join(root, file)))
}

function findMissingPatterns(text, patterns) {
  if (text == null) return patterns
  return patterns.filter((item) => !text.includes(item.text))
}

function findMissingFragments(text, fragments) {
  if (text == null) return fragments
  return fragments.filter((fragment) => !text.includes(fragment))
}

function findForbiddenPatterns(text) {
  if (text == null) return []
  const matches = []
  for (const rule of FORBIDDEN_ROUTE_PATTERNS) {
    const foundPatterns = rule.patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)
    if (foundPatterns.length) matches.push({ id: rule.id, foundPatterns })
  }
  return matches
}

function findPackageScriptIssues(packageText) {
  if (packageText == null) return [{ id: 'missing-package-json', detail: 'package.json is missing' }]
  const issues = []
  try {
    const pkg = JSON.parse(packageText)
    if (pkg.scripts?.['v04:ui-route:audit'] !== 'node scripts/v04-ui-implementation-route-audit.mjs') {
      issues.push({ id: 'missing-v04-ui-route-script', detail: 'v04:ui-route:audit must run the route audit script' })
    }
    if (pkg.scripts?.['image4:color:audit'] !== 'node scripts/image4-companion-color-audit.mjs') {
      issues.push({ id: 'missing-image4-color-audit-script', detail: 'image4:color:audit must run the Image4 companion color audit script' })
    }
  } catch (error) {
    issues.push({ id: 'invalid-package-json', detail: error instanceof Error ? error.message : String(error) })
  }
  return issues
}

function buildSummary(report) {
  const errors = report.missingFiles.length
    + report.missingRoutePatterns.length
    + report.missingSurfaceDocs.length
    + report.missingCommands.length
    + report.missingGuardrails.length
    + report.forbiddenPatterns.length
    + report.packageScriptIssues.length
    + report.auditBacklinkIssues.length

  return { ok: errors === 0, errors }
}

export function buildV04UiImplementationRouteReport(root = ROOT) {
  const routeText = readProjectFile(root, ROUTE_DOC)
  const referenceAuditText = readProjectFile(root, REFERENCE_AUDIT_DOC)
  const packageText = readProjectFile(root, 'package.json')
  const missingFiles = findMissingFiles(root)
  const missingRoutePatterns = findMissingPatterns(routeText, REQUIRED_ROUTE_PATTERNS)
  const missingSurfaceDocs = findMissingFragments(routeText, SURFACE_DOCS)
  const missingCommands = findMissingFragments(routeText, REQUIRED_COMMANDS)
  const missingGuardrails = findMissingFragments(routeText, REQUIRED_GUARDRAILS)
  const forbiddenPatterns = findForbiddenPatterns(routeText)
  const packageScriptIssues = findPackageScriptIssues(packageText)
  const auditBacklinkIssues = referenceAuditText?.includes(ROUTE_DOC)
    ? []
    : [{ id: 'missing-reference-audit-backlink', detail: `${REFERENCE_AUDIT_DOC} should link ${ROUTE_DOC}` }]

  const report = {
    audit: 'v04-ui-implementation-route',
    routeDoc: ROUTE_DOC,
    checkedFiles: REQUIRED_FILES,
    checkedCommands: REQUIRED_COMMANDS,
    missingFiles,
    missingRoutePatterns,
    missingSurfaceDocs,
    missingCommands,
    missingGuardrails,
    forbiddenPatterns,
    packageScriptIssues,
    auditBacklinkIssues,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

function formatHumanReport(report) {
  const lines = ['0.4 UI implementation route audit']
  lines.push(`- route doc: ${report.routeDoc}`)
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked commands: ${report.checkedCommands.length}`)
  lines.push('')
  for (const [name, items] of Object.entries({
    missingFiles: report.missingFiles,
    missingRoutePatterns: report.missingRoutePatterns,
    missingSurfaceDocs: report.missingSurfaceDocs,
    missingCommands: report.missingCommands,
    missingGuardrails: report.missingGuardrails,
    forbiddenPatterns: report.forbiddenPatterns,
    packageScriptIssues: report.packageScriptIssues,
    auditBacklinkIssues: report.auditBacklinkIssues,
  })) {
    lines.push(`ERROR ${name}: ${items.length}`)
    for (const item of items) {
      if (typeof item === 'string') {
        lines.push(`  - ${item}`)
      } else {
        lines.push(`  - ${item.id ?? item.text ?? item.detail}`)
        if (item.text) lines.push(`    missing ${item.text}`)
        if (item.detail) lines.push(`    ${item.detail}`)
        if (item.foundPatterns) {
          for (const pattern of item.foundPatterns) lines.push(`    found ${pattern}`)
        }
      }
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildV04UiImplementationRouteReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
