#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FORBIDDEN_PATTERNS,
  HARD_CONTRACT_IDS,
  HARD_FORBIDDEN_PATTERN_IDS,
  IMAGE4_ROW_CONTAINER_SELECTORS,
  IMAGE4_WEIGHT_CONTAINER_SELECTORS,
  INTERACTION_STATE_FILES,
  INTERACTIVE_TRANSFORM_FILES,
  REQUIRED_CONTRACTS,
  REQUIRED_FILES,
  VALID_MODES,
} from './image4-visual-contract-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function normalizeMode(mode = 'all') {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported Image4 contract mode: ${mode}`)
  }
  return mode
}

function isHardContract(contract) {
  return HARD_CONTRACT_IDS.has(contract.id)
}

function isHardForbiddenPattern(rule) {
  return HARD_FORBIDDEN_PATTERN_IDS.has(rule.id)
}

function getContractsForMode(mode) {
  if (mode === 'hard') return REQUIRED_CONTRACTS.filter(isHardContract)
  if (mode === 'soft') return REQUIRED_CONTRACTS.filter((contract) => !isHardContract(contract))
  return REQUIRED_CONTRACTS
}

function getForbiddenPatternsForMode(mode) {
  if (mode === 'hard') return FORBIDDEN_PATTERNS.filter(isHardForbiddenPattern)
  if (mode === 'soft') return FORBIDDEN_PATTERNS.filter((rule) => !isHardForbiddenPattern(rule))
  return FORBIDDEN_PATTERNS
}

function getRequiredFilesForMode(mode, contracts, forbiddenRules) {
  if (mode === 'all') return REQUIRED_FILES
  const files = new Set([
    ...contracts.map((contract) => contract.file),
    ...forbiddenRules.map((rule) => rule.file),
  ])
  if (mode === 'soft') {
    for (const file of INTERACTIVE_TRANSFORM_FILES) files.add(file)
  }
  return [...files].sort()
}

function readRequiredFiles(root, requiredFiles) {
  const missingFiles = []
  const files = new Map()

  for (const file of requiredFiles) {
    const text = readProjectFile(root, file)
    if (text === null) {
      missingFiles.push({ file })
    } else {
      files.set(file, text)
    }
  }

  return { files, missingFiles }
}

function findMissingContracts(files, contracts) {
  const missingContracts = []

  for (const contract of contracts) {
    const text = files.get(contract.file)
    if (typeof text !== 'string') continue

    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      missingContracts.push({
        id: contract.id,
        file: contract.file,
        description: contract.description,
        missingPatterns,
      })
    }
  }

  return missingContracts
}

function findForbiddenPatterns(files, rules) {
  const forbiddenPatterns = []

  for (const rule of rules) {
    const text = files.get(rule.file)
    if (typeof text !== 'string') continue

    const matchedPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
    if (matchedPatterns.length) {
      forbiddenPatterns.push({
        id: rule.id,
        file: rule.file,
        description: rule.description,
        matchedPatterns,
      })
    }
  }

  return forbiddenPatterns
}

function findInteractiveTransformJumps(files) {
  const unsafeTransforms = []
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g

  for (const file of INTERACTIVE_TRANSFORM_FILES) {
    const text = files.get(file)
    if (typeof text !== 'string') continue

    let match
    while ((match = blockPattern.exec(text)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2]
      const isImage4Rule = selector.includes('.panel-window--image4') || selector.includes('.image4')
      const isInteractiveRule = /:(?:hover|focus|focus-visible)\b/.test(selector)
      if (!isImage4Rule || !isInteractiveRule) continue

      for (const transformMatch of body.matchAll(/transform\s*:\s*([^;]+);/g)) {
        const transform = transformMatch[1].trim()
        if (transform !== 'none') {
          unsafeTransforms.push({ file, selector, transform })
        }
      }
    }
  }

  return unsafeTransforms
}

function selectorTargets(selector, target) {
  return selector
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .some((part) => part === target || part.includes(`${target}:`) || part.endsWith(` ${target}`))
}

function selectorTargetsAny(selector, targets) {
  return targets.some((target) => selectorTargets(selector, target))
}

function isNoneOrTransparent(value) {
  return value === 'none' || value === 'transparent'
}

function isNegativeSpacing(value) {
  return /(^|[\s,(])-\.?\d/.test(value) || /calc\([^)]*-\s*\.?\d/.test(value)
}

function isInteractionStateSelector(selector) {
  return /:(?:hover|focus|focus-visible|focus-within|active)\b|\.is-(?:speaking|idle)\b/.test(selector)
}

function isAllowedStateLeaf(selector) {
  return selector.includes('companion-presence__signal-bar')
    || selector.includes('textarea:focus')
    || selector.includes('textarea:focus-visible')
    || selector.includes('svg')
    || selector.includes('__icon')
}

function isAllowedStateShadow(selector, value) {
  if (value === 'none') return true
  if (selector.includes('companion-presence__signal-bar')) return true
  if (selector.includes(':focus') && value === 'var(--image4-state-focus-ring)') return true
  if (selector.includes('textarea:focus') && value === 'var(--image4-composer-focus-shadow)') return true
  return false
}

function findPresenceWeightLeaks(files) {
  const leaks = []
  const file = 'src/app/styles/panel-companion-layout.css'
  const text = files.get(file)
  if (typeof text !== 'string') return leaks

  const blockPattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = blockPattern.exec(text)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ')
    const body = match[2]
    if (!selector.includes('.panel-window--image4')) continue
    if (!selector.includes('companion-presence__signal') && !selector.includes('image4-presence')) continue
    if (selector.includes('companion-presence__signal-bar')) continue

    const issues = []
    const checkProperties = [
      ['animation', /animation\s*:\s*([^;]+);/g],
      ['box-shadow', /box-shadow\s*:\s*([^;]+);/g],
      ['filter', /filter\s*:\s*([^;]+);/g],
      ['z-index', /z-index\s*:\s*([^;]+);/g],
    ]

    for (const [property, pattern] of checkProperties) {
      for (const propertyMatch of body.matchAll(pattern)) {
        const value = propertyMatch[1].trim()
        if (property === 'box-shadow' && value === 'none') continue
        if (property === 'filter' && value === 'none') continue
        issues.push({ property, value })
      }
    }

    for (const transformMatch of body.matchAll(/transform\s*:\s*([^;]+);/g)) {
      const value = transformMatch[1].trim()
      if (/scale/.test(value)) issues.push({ property: 'transform', value })
    }

    if (issues.length) leaks.push({ file, selector, issues })
  }

  return leaks
}

function findVisualWeightLeaks(files) {
  const leaks = []
  const file = 'src/app/styles/panel-companion-chat.css'
  const text = files.get(file)
  if (typeof text !== 'string') return leaks

  const blockPattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = blockPattern.exec(text)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ')
    const body = match[2]
    if (!selectorTargetsAny(selector, IMAGE4_WEIGHT_CONTAINER_SELECTORS)) continue

    const issues = []
    const isActionRule = selectorTargets(selector, '.panel-window--image4 .image4-action')
    const isActionHover = isActionRule && selector.includes(':hover')
    const isActionFocus = isActionRule && selector.includes(':focus-visible')
    const isActionListRule = selectorTargets(selector, '.panel-window--image4 .image4-action-list')
    const isComposerRule = selectorTargets(selector, '.panel-window--image4 .image4-composer')

    for (const propertyMatch of body.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      const value = propertyMatch[1].trim()
      if (value === 'none') continue
      if (isActionFocus) continue
      if (isActionRule && !isActionHover && /^inset\b/.test(value)) continue
      issues.push({ property: 'box-shadow', value })
    }

    if (isComposerRule || isActionListRule) {
      for (const propertyMatch of body.matchAll(/(?:^|\s)(?:-webkit-)?backdrop-filter\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!isNoneOrTransparent(value)) issues.push({ property: 'backdrop-filter', value })
      }
      for (const propertyMatch of body.matchAll(/filter\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!isNoneOrTransparent(value)) issues.push({ property: 'filter', value })
      }
    }

    if (isComposerRule) {
      for (const propertyMatch of body.matchAll(/background\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (value !== 'transparent') issues.push({ property: 'background', value })
      }
    }

    if (issues.length) leaks.push({ file, selector, issues })
  }

  return leaks
}

function findRowBoundaryLeaks(files) {
  const leaks = []
  const filesToCheck = [
    'src/app/styles/panel-companion-layout.css',
    'src/app/styles/panel-companion-chat.css',
    'src/app/styles/panel-companion-messages.css',
  ]
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g

  for (const file of filesToCheck) {
    const text = files.get(file)
    if (typeof text !== 'string') continue

    let match
    while ((match = blockPattern.exec(text)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2]
      if (!selectorTargetsAny(selector, IMAGE4_ROW_CONTAINER_SELECTORS)) continue

      const issues = []
      for (const propertyMatch of body.matchAll(/margin(?:-(?:top|bottom|block|block-start|block-end))?\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (isNegativeSpacing(value)) issues.push({ property: 'margin', value })
      }

      for (const transformMatch of body.matchAll(/transform\s*:\s*([^;]+);/g)) {
        const value = transformMatch[1].trim()
        if (value !== 'none') issues.push({ property: 'transform', value })
      }

      if (issues.length) leaks.push({ file, selector, issues })
    }
  }

  return leaks
}

function findInteractionStateLeaks(files) {
  const leaks = []
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g

  for (const file of INTERACTION_STATE_FILES) {
    const text = files.get(file)
    if (typeof text !== 'string') continue

    let match
    while ((match = blockPattern.exec(text)) !== null) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      const body = match[2]
      if (!selector.includes('.panel-window--image4') || !isInteractionStateSelector(selector)) continue

      const issues = []
      const leafState = isAllowedStateLeaf(selector)

      for (const transformMatch of body.matchAll(/transform\s*:\s*([^;]+);/g)) {
        const value = transformMatch[1].trim()
        if (value !== 'none' && !leafState) issues.push({ property: 'transform', value })
      }

      for (const propertyMatch of body.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!isAllowedStateShadow(selector, value)) issues.push({ property: 'box-shadow', value })
      }

      for (const propertyMatch of body.matchAll(/(?:^|\s)(?:-webkit-)?backdrop-filter\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!isNoneOrTransparent(value)) issues.push({ property: 'backdrop-filter', value })
      }

      for (const propertyMatch of body.matchAll(/filter\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!isNoneOrTransparent(value)) issues.push({ property: 'filter', value })
      }

      for (const propertyMatch of body.matchAll(/z-index\s*:\s*([^;]+);/g)) {
        issues.push({ property: 'z-index', value: propertyMatch[1].trim() })
      }

      for (const propertyMatch of body.matchAll(/animation\s*:\s*([^;]+);/g)) {
        const value = propertyMatch[1].trim()
        if (!selector.includes('companion-presence__signal-bar') && value !== 'none') {
          issues.push({ property: 'animation', value })
        }
      }

      if (issues.length) leaks.push({ file, selector, issues })
    }
  }

  return leaks
}

function extractCssBlock(text, start) {
  const openIndex = text.indexOf('{', start)
  if (openIndex < 0) return ''

  let depth = 0
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return text.slice(start)
}

function findSignalAnimationDimensionLeaks(files) {
  const leaks = []
  const file = 'src/app/styles/panel-companion-motion.css'
  const text = files.get(file)
  if (typeof text !== 'string') return leaks

  for (const animationName of ['image4-wave-bar', 'image4-wave-bar-reduced']) {
    const start = text.indexOf(`@keyframes ${animationName}`)
    if (start < 0) continue
    const block = extractCssBlock(text, start)
    const issues = []

    for (const property of ['opacity', 'filter', 'box-shadow', 'background', 'background-color', 'color']) {
      const pattern = new RegExp(`(?:^|\\n)\\s*${property}\\s*:`, 'm')
      if (pattern.test(block)) {
        issues.push({
          property,
          value: 'animated in signal keyframes',
        })
      }
    }

    if (issues.length) {
      leaks.push({
        file,
        selector: `@keyframes ${animationName}`,
        issues,
      })
    }
  }

  return leaks
}

export function buildImage4VisualContractReport(root = ROOT, options = {}) {
  const mode = normalizeMode(options.mode)
  const contracts = getContractsForMode(mode)
  const forbiddenRules = getForbiddenPatternsForMode(mode)
  const requiredFiles = getRequiredFilesForMode(mode, contracts, forbiddenRules)
  const { files, missingFiles } = readRequiredFiles(root, requiredFiles)
  const missingContracts = findMissingContracts(files, contracts)
  const forbiddenPatterns = findForbiddenPatterns(files, forbiddenRules)
  const unsafeTransforms = mode === 'hard' ? [] : findInteractiveTransformJumps(files)
  const presenceWeightLeaks = mode === 'hard' ? [] : findPresenceWeightLeaks(files)
  const visualWeightLeaks = mode === 'hard' ? [] : findVisualWeightLeaks(files)
  const rowBoundaryLeaks = mode === 'hard' ? [] : findRowBoundaryLeaks(files)
  const interactionStateLeaks = mode === 'hard' ? [] : findInteractionStateLeaks(files)
  const signalAnimationLeaks = mode === 'hard' ? [] : findSignalAnimationDimensionLeaks(files)
  const errors = {
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    unsafeTransforms,
    presenceWeightLeaks,
    visualWeightLeaks,
    rowBoundaryLeaks,
    interactionStateLeaks,
    signalAnimationLeaks,
  }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    mode,
    checkedFiles: requiredFiles,
    checkedContracts: contracts.map((contract) => contract.id),
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Image4 visual contract audit']
  lines.push(`- mode: ${report.mode}`)
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
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
  if (item.missingPatterns) return `${item.file}:${item.id} missing ${item.missingPatterns.join(' | ')}`
  if (item.matchedPatterns) return `${item.file}:${item.id} matched ${item.matchedPatterns.join(' | ')}`
  if (item.transform) return `${item.file}:${item.selector} transform=${item.transform}`
  if (item.issues) return `${item.file}:${item.selector} ${item.issues.map((issue) => `${issue.property}=${issue.value}`).join(' | ')}`
  return item.file
}

function main(argv) {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='))
  const mode = modeArg ? modeArg.slice('--mode='.length) : 'all'
  const report = buildImage4VisualContractReport(ROOT, { mode })
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
