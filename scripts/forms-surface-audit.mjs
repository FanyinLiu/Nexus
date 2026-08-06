#!/usr/bin/env node

import {
  buildSummary,
  countOccurrences,
  findForbiddenPatterns,
  findMissingContracts,
  findMissingFilesOnDisk,
  readProjectFiles,
  resolveProjectRoot,
  runAuditCli,
} from './lib/audit-framework.mjs'

const ROOT = resolveProjectRoot(import.meta.url)

const REQUIRED_FILES = [
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
  'src/components/settingsFields.tsx',
  'src/features/settingsV3',
  'src/app/styles/settings.css',
  'src/app/styles/settings-home.css',
  'src/app/styles/settings-visual-system.css',
  'src/app/styles/settings-product-reference-final.css',
  'src/features/settingsV3/settings-v3.css',
]

const REQUIRED_FILE_READS = [
  'src/components/settingsFields.tsx',
  'src/features/settingsV3/ModelSectionV3.tsx',
  'src/features/settingsV3/MemorySectionV3.tsx',
  'src/features/settingsV3/ToolsSectionV3.tsx',
  'src/features/settingsV3/WindowSectionV3.tsx',
  'src/app/styles/settings.css',
  'src/app/styles/settings-home.css',
  'src/app/styles/settings-visual-system.css',
  'src/app/styles/settings-product-reference-final.css',
  'src/features/settingsV3/settings-v3.css',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'forms-pro-contract-recorded',
    file: 'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
    description: 'The accepted Pro forms judgment is recorded as a bounded local contract.',
    patterns: [
      'low-noise configuration row system',
      'forms = low-noise configuration row system',
      'forms = card-heavy settings dashboard',
      'label, description, control, validation',
      'shadcn/ui',
      'Radix UI Primitives',
    ],
  },
  {
    id: 'forms-accessible-state-contract',
    file: 'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
    description: 'Forms preserve accessible label, disabled, and error state semantics.',
    patterns: [
      'htmlFor',
      'aria-labelledby',
      'aria-describedby',
      'aria-invalid',
      'aria-disabled',
      'Escape/Tab behavior',
    ],
  },
  {
    id: 'settings-row-rhythm-css',
    file: 'src/app/styles/settings-visual-system.css',
    description: 'The 0.4.2 visual system owns the shared settings control and row rhythm.',
    patterns: [
      '--nx-settings-control-height: 30px;',
      '--nx-settings-row-height: 38px;',
      '--nx-settings-field-height: 32px;',
      '--settings-child-control-height: var(--nx-settings-control-height);',
      '.settings-form-row',
      '.settings-form-row__validation',
    ],
  },
  {
    id: 'legacy-settings-toggle-state-css',
    file: 'src/app/styles/settings-product-reference-final.css',
    description: 'The fallback settings lane owns its checked toggle treatment in the conditional legacy product layer.',
    patterns: [
      '.sd-section .sp.sp .settings-toggle input:checked',
      'background: var(--nx-settings-accent);',
      'box-shadow: none;',
    ],
  },
  {
    id: 'v3-settings-toggle-state-css',
    file: 'src/features/settingsV3/settings-v3.css',
    description: 'The active V3 settings lane owns its checked switch treatment without depending on the legacy product layer.',
    patterns: [
      '.settings-v3-switch input:checked + .settings-v3-switch__track',
      'background: var(--sv3-accent);',
      '.settings-v3-switch input:focus-visible + .settings-v3-switch__track',
    ],
  },
  {
    id: 'settings-home-does-not-redefine-form-system',
    file: 'src/app/styles/settings-home.css',
    description: 'Home settings styles stay scoped and do not introduce a second form-row system.',
    patterns: [
      '.settings-home-card',
      '.settings-appearance-switch',
      ':focus-visible',
    ],
  },
]

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'forms-dashboard-card-chrome',
    files: ['docs/FORMS_SURFACE_REFERENCE_REVIEW.md', 'src/app/styles/settings.css', 'src/app/styles/settings-home.css'],
    description: 'Forms must not become a card-heavy dashboard or copied component demo surface.',
    patterns: [
      'form-dashboard',
      'settings-card-stack',
      'field-demo-skin',
      'card-heavy-settings-dashboard',
      'library-demo-field',
    ],
  },
  {
    id: 'forms-wrapper-hierarchy-tricks',
    files: ['src/app/styles/settings.css', 'src/app/styles/settings-home.css'],
    description: 'Form row wrappers should not steal hierarchy with transforms, row lift, or negative margins.',
    patterns: [
      'settings-form-row { transform:',
      'settings-form-row:hover { transform:',
      'settings-form-row { margin-top: -',
      'settings-form-row { margin-bottom: -',
      'settings-form-row { z-index:',
    ],
  },
]

export function buildFormsSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, [
    'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
    ...REQUIRED_FILE_READS,
  ])
  const combinedSections = REQUIRED_FILE_READS
    .filter((file) => file.startsWith('src/features/settingsV3/'))
    .map((file) => files.get(file) ?? '')
    .join('\n')
  const settingsFields = files.get('src/components/settingsFields.tsx') ?? ''
  const css = [
    files.get('src/app/styles/settings.css') ?? '',
    files.get('src/app/styles/settings-home.css') ?? '',
    files.get('src/app/styles/settings-visual-system.css') ?? '',
  ].join('\n')
  const missingFiles = findMissingFilesOnDisk(root, REQUIRED_FILES)
  const missingContracts = findMissingContracts(files, REQUIRED_CONTRACTS)
  const forbiddenPatterns = findForbiddenPatterns(files, FORBIDDEN_SOURCE_PATTERNS)

  const report = {
    audit: 'forms-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    formsDom: {
      labelOccurrences: countOccurrences(combinedSections, '<label'),
      htmlForOccurrences: countOccurrences(settingsFields, 'htmlFor'),
      ariaDescribedByOccurrences: countOccurrences(settingsFields, 'aria-describedby'),
      ariaInvalidOccurrences: countOccurrences(settingsFields, 'aria-invalid'),
      formRowOccurrences: countOccurrences(settingsFields, 'settings-form-row'),
      focusVisibleOccurrences: countOccurrences(css, ':focus-visible'),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
  }

  return {
    ...report,
    summary: buildSummary({ missingFiles, missingContracts, forbiddenPatterns }),
  }
}

export function formatFormsSurfaceReport(report) {
  const lines = ['Forms surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- label occurrences: ${report.formsDom.labelOccurrences}`)
  lines.push(`- form row occurrences: ${report.formsDom.formRowOccurrences}`)
  lines.push(`- htmlFor occurrences: ${report.formsDom.htmlForOccurrences}`)
  lines.push(`- aria-describedby occurrences: ${report.formsDom.ariaDescribedByOccurrences}`)
  lines.push(`- aria-invalid occurrences: ${report.formsDom.ariaInvalidOccurrences}`)
  lines.push(`- focus-visible selectors: ${report.formsDom.focusVisibleOccurrences}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)

  if (report.missingContracts.length) {
    lines.push('')
    for (const item of report.missingContracts) {
      lines.push(`missing contract ${item.id} in ${item.file}`)
      for (const pattern of item.missingPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.forbiddenPatterns.length) {
    lines.push('')
    for (const item of report.forbiddenPatterns) {
      lines.push(`forbidden pattern ${item.id} in ${item.file}`)
      for (const pattern of item.foundPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

runAuditCli({
  importMetaUrl: import.meta.url,
  root: ROOT,
  buildReport: buildFormsSurfaceReport,
  formatReport: formatFormsSurfaceReport,
})
