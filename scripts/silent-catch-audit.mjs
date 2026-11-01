#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
// TypeScript 7 removed the classic compiler API from the main export.
// Audit tooling keeps using the TS 6 API via the typescript6 alias.
import ts from 'typescript6'
import {
  normalizePath,
  resolveProjectRoot,
  runAuditCli,
} from './lib/audit-framework.mjs'
import { SCOPED_SECTIONS } from './silent-catch-audit-rules.mjs'

const DEFAULT_ROOT = resolveProjectRoot(import.meta.url)
const SOURCE_PATTERN = /\.(?:ts|tsx|js|mjs)$/
const HANDLER_PROPERTY_NAMES = new Set(['catch'])

function readText(root, file) {
  return readFileSync(join(root, file), 'utf8')
}

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function walkSourceFiles(root, directory) {
  const base = join(root, directory)
  if (!existsSync(base)) return []

  const files = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const fullPath = join(base, entry.name)
    const relativePath = normalizePath(relative(root, fullPath))
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(root, relativePath))
    } else if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) {
      files.push(relativePath)
    }
  }
  return files
}

export function collectScopedFiles(root = DEFAULT_ROOT) {
  const files = new Set()

  for (const section of SCOPED_SECTIONS) {
    for (const directory of section.directories ?? []) {
      for (const file of walkSourceFiles(root, directory)) files.add(file)
    }
    for (const file of section.files ?? []) {
      if (existsSync(join(root, file))) files.add(normalizePath(file))
    }
  }

  return [...files].sort()
}

function lineAt(source, position) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  let lineEnd = source.indexOf('\n', position)
  if (lineEnd === -1) lineEnd = source.length
  return source.slice(lineStart, lineEnd)
}

function lineNumberAt(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '')
    .trim()
}

function firstContentLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
}

function parseOptOutComment(text) {
  const lineComment = /\/\/\s*silent-catch-ok\s*:\s*([^\n\r]*)/.exec(text)
  const blockComment = /\/\*\s*silent-catch-ok\s*:\s*([\s\S]*?)\*\//.exec(text)
  const match = lineComment ?? blockComment
  if (!match) return null
  return { reason: match[1].trim() }
}

function findOptOut(source, handlerStart, block) {
  const handlerLine = lineAt(source, handlerStart)
  const onHandlerLine = parseOptOutComment(handlerLine)
  if (onHandlerLine) return onHandlerLine

  if (!block) return null
  const inner = source.slice(block.getStart() + 1, block.getEnd() - 1)
  const firstLine = firstContentLine(inner).trim()
  // A trailing marker on a line of code is the inner handler's opt-out, not
  // this block's: only a comment that starts the first body line opts out.
  if (!firstLine.startsWith('//') && !firstLine.startsWith('/*')) return null
  return parseOptOutComment(firstLine)
}

function isSilentLiteral(expression) {
  if (!expression) return true
  if (expression.kind === ts.SyntaxKind.NullKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return true
  if (ts.isIdentifier(expression)) return expression.text === 'undefined'
  if (ts.isVoidExpression(expression)) return true
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.length === 0
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.length === 0
  return false
}

function isSilentStatement(statement) {
  if (ts.isReturnStatement(statement)) return isSilentLiteral(statement.expression)
  return ts.isContinueStatement(statement) || ts.isBreakStatement(statement)
}

function isLoggingName(name) {
  const normalized = name.toLowerCase()
  if (normalized === 'log') return true
  return /(?:_|^)(debug|info|warn|error|trace)$/.test(normalized)
    || normalized.includes('log')
    || normalized.includes('warn')
    || normalized.includes('error')
    || normalized.includes('report')
    || normalized.includes('telemetry')
    || normalized.includes('audit')
}

function containsLoggingCall(node) {
  let found = false

  function visit(current) {
    if (found) return
    if (ts.isCallExpression(current)) {
      const callee = current.expression
      if (ts.isPropertyAccessExpression(callee) && isLoggingName(callee.name.text)) {
        found = true
        return
      }
      if (ts.isIdentifier(callee) && isLoggingName(callee.text)) {
        found = true
        return
      }
    }
    ts.forEachChild(current, visit)
  }

  visit(node)
  return found
}

function classifyBlock(source, handlerStart, block) {
  const optOut = findOptOut(source, handlerStart, block)
  if (optOut) {
    return optOut.reason
      ? { status: 'opt-out', optOut }
      : { status: 'opt-out-missing-reason' }
  }

  const inner = source.slice(block.getStart() + 1, block.getEnd() - 1)
  if (!stripComments(inner)) return { status: 'empty' }

  if (
    block.statements.length > 0
    && block.statements.every(isSilentStatement)
    && !containsLoggingCall(block)
  ) {
    return { status: 'return-only' }
  }

  return { status: 'ok' }
}

function classifyNoOpCatch(source, sourceFile, call) {
  const argument = call.arguments[0]
  if (!argument) return { status: 'ok' }

  const handlerStart = call.expression.name.getStart(sourceFile)
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    if (argument.body && ts.isBlock(argument.body)) {
      const result = classifyBlock(source, handlerStart, argument.body)
      if (result.status === 'empty' || result.status === 'return-only') {
        return { status: 'no-op-promise-catch' }
      }
      return result
    }
    if (isSilentLiteral(argument.body)) {
      const optOut = findOptOut(source, handlerStart, null)
      if (optOut) {
        return optOut.reason
          ? { status: 'opt-out', optOut }
          : { status: 'opt-out-missing-reason' }
      }
      return { status: 'no-op-promise-catch' }
    }
  }

  return { status: 'ok' }
}

function statusToViolation(status) {
  switch (status) {
    case 'empty':
      return { kind: 'empty-catch', message: 'catch block is empty' }
    case 'return-only':
      return { kind: 'silent-return', message: 'catch block only returns/continues/breaks without logging' }
    case 'no-op-promise-catch':
      return { kind: 'no-op-promise-catch', message: 'promise catch handler silently returns a no-op value' }
    case 'opt-out-missing-reason':
      return { kind: 'opt-out-missing-reason', message: 'silent-catch-ok marker requires a non-empty reason' }
    default:
      return null
  }
}

function analyzeFile(root, file) {
  const source = readText(root, file)
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const violations = []
  const optOuts = []

  function handleStatus(result, node) {
    if (result.status === 'opt-out') {
      const line = lineNumberAt(sourceFile, node.getStart(sourceFile))
      optOuts.push({ file, line, reason: result.optOut.reason })
      return
    }
    const violation = statusToViolation(result.status)
    if (violation) {
      const line = lineNumberAt(sourceFile, node.getStart(sourceFile))
      violations.push({ file, line, ...violation })
    }
  }

  function visit(node) {
    if (ts.isCatchClause(node)) {
      handleStatus(classifyBlock(source, node.getStart(sourceFile), node.block), node)
    } else if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && HANDLER_PROPERTY_NAMES.has(node.expression.name.text)
    ) {
      handleStatus(classifyNoOpCatch(source, sourceFile, node), node)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { violations, optOuts }
}

export function buildSilentCatchReport(root = DEFAULT_ROOT) {
  const files = collectScopedFiles(root)
  const violations = []
  const optOuts = []

  for (const file of files) {
    try {
      const result = analyzeFile(root, file)
      violations.push(...result.violations)
      optOuts.push(...result.optOuts)
    } catch (error) {
      // A syntax error in one scoped file must fail the audit, not crash it.
      violations.push({
        file,
        line: 0,
        kind: 'parse-error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    scopes: SCOPED_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      directories: section.directories ?? [],
      files: section.files ?? [],
    })),
    checkedFiles: files,
    violations,
    optOuts,
    summary: {
      ok: violations.length === 0,
      errors: violations.length,
      filesChecked: files.length,
      optOuts: optOuts.length,
    },
    privacy: {
      staticSourceOnly: true,
      readsUserData: false,
      readsSecrets: false,
    },
  }
}

export function formatSilentCatchReport(report) {
  const lines = ['Silent catch audit']
  lines.push(`- scoped sections: ${report.scopes.length}`)
  lines.push(`- checked files: ${report.summary.filesChecked}`)
  lines.push(`- intentional opt-outs: ${report.summary.optOuts}`)
  lines.push('')

  if (report.violations.length) {
    lines.push(`ERROR silent catches: ${report.violations.length}`)
    for (const item of report.violations) {
      lines.push(`  ${item.file}:${item.line} [${item.kind}] ${item.message}`)
    }
  } else {
    lines.push('ERROR silent catches: 0')
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

runAuditCli({
  importMetaUrl: import.meta.url,
  root: DEFAULT_ROOT,
  buildReport: buildSilentCatchReport,
  formatReport: formatSilentCatchReport,
})
