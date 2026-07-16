#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
  'src/components/settingsFields.tsx',
  'src/components/settingsSections',
  'src/app/styles/settings.css',
  'src/app/styles/settings-home.css',
  'src/app/styles/settings-visual-system.css',
  'src/app/styles/settings-product-reference-final.css',
  'src/features/settingsV3/settings-v3.css',
]

const REQUIRED_FILE_READS = [
  'src/components/settingsFields.tsx',
  'src/components/settingsSections/ModelSection.tsx',
  'src/components/settingsSections/MemorySection.tsx',
  'src/components/settingsSections/ToolsSection.tsx',
  'src/components/settingsSections/WindowSection.tsx',
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
    id: 'settings-form-row-component',
    file: 'src/components/settingsFields.tsx',
    description: 'Shared settings text fields expose explicit form-row slots and accessible label/control state binding.',
    patterns: [
      'settings-form-row',
      'settings-form-row__label',
      'htmlFor',
      'aria-describedby',
      'aria-invalid',
      'settings-form-row__description',
      'settings-form-row__validation',
      'settings-form-row__status',
    ],
  },
  {
    id: 'settings-form-row-describedby-chain',
    file: 'src/components/settingsFields.tsx',
    description: 'Description and validation text stay connected to the same editable control through one aria-describedby chain.',
    patterns: [
      'const descriptionId = description ? `${inputId}-description` : undefined',
      'const validationId = validation ? `${inputId}-validation` : undefined',
      "const describedBy = [descriptionId, validationId].filter(Boolean).join(' ') || undefined",
      'id={descriptionId}',
      'id={validationId}',
      'aria-describedby={describedBy}',
      'aria-invalid={validation ? true : undefined}',
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

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function readProjectFiles(root, files) {
  return new Map(files.map((file) => [file, readProjectFile(root, file)]))
}

function findMissingFiles(root) {
  return REQUIRED_FILES.filter((file) => !existsSync(join(root, file)))
}

function findMissingContracts(files) {
  const missing = []
  for (const contract of REQUIRED_CONTRACTS) {
    const text = files.get(contract.file)
    if (text == null) continue
    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      missing.push({
        id: contract.id,
        file: contract.file,
        description: contract.description,
        missingPatterns,
      })
    }
  }
  return missing
}

function findForbiddenPatterns(files) {
  const matches = []
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    for (const file of rule.files) {
      const text = files.get(file)
      if (text == null) continue
      const foundPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
      if (foundPatterns.length) {
        matches.push({
          id: rule.id,
          file,
          description: rule.description,
          foundPatterns,
        })
      }
    }
  }
  return matches
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns }) {
  const errors = missingFiles.length + missingContracts.length + forbiddenPatterns.length
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildFormsSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, [
    'docs/FORMS_SURFACE_REFERENCE_REVIEW.md',
    ...REQUIRED_FILE_READS,
  ])
  const combinedSections = REQUIRED_FILE_READS
    .filter((file) => file.startsWith('src/components/settingsSections/'))
    .map((file) => files.get(file) ?? '')
    .join('\n')
  const settingsFields = files.get('src/components/settingsFields.tsx') ?? ''
  const css = [
    files.get('src/app/styles/settings.css') ?? '',
    files.get('src/app/styles/settings-home.css') ?? '',
    files.get('src/app/styles/settings-visual-system.css') ?? '',
  ].join('\n')
  const missingFiles = findMissingFiles(root)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)

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
    summary: buildSummary(report),
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildFormsSurfaceReport(ROOT)
  console.log(formatFormsSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
