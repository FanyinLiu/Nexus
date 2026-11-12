#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// TypeScript 7 removed the classic compiler API from the main export.
// Audit tooling keeps using the TS 6 API via the typescript6 alias.
import ts from 'typescript6'
import { isWindowCapabilityClassified, getRequiredWindowCapability } from '../electron/ipc/windowCapabilities.js'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIR = 'electron'
const PRELOAD_PATH = join(ELECTRON_DIR, 'preload.js')

// Handlers deliberately kept in the main process while their renderer bridge
// methods are removed. With contextIsolation the renderer can only reach main
// through preload, so these channels stay unreachable until a renderer surface
// exists. Listing them explicitly keeps the main-only warning meaningful for
// accidental omissions instead of swallowing the whole narrowed bridge.
export const INTENTIONALLY_MAIN_ONLY_CHANNELS = Object.freeze(new Set([
  'chat:list-models',
  'doctor:probe-local-services',
  'external-action-policy:get',
  'factorio:execute',
  'factorio:status',
  'local-data:chat-comparison-preview',
  'local-data:chat-migration-apply',
  'local-data:chat-migration-rollback',
  'local-data:chat-migration-status',
  'local-data:status',
  'mcp:status',
  'memory:keyword-search',
  'memory:vector-index',
  'memory:vector-stats',
  'minecraft:send-command',
  'minecraft:status',
  'persona:init',
  'persona:open-dir',
  'persona:paths',
  'persona:profile-dir',
  'plugin-bus:publish',
  'plugin-bus:recent',
  'plugin-bus:stats',
  'plugin-bus:subscribe',
  'plugin-bus:subscriptions',
  'plugin-bus:unsubscribe',
  'plugin:approve',
  'plugin:dir',
  'plugin:disable',
  'plugin:enable',
  'plugin:restart',
  'plugin:revoke',
  'plugin:scan',
  'plugin:start',
  'plugin:status',
  'plugin:stop',
  'skill:get',
  'skill:list',
  'skill:remove',
  'skill:stats',
  'tencent-asr:disconnect',
  'tencent-asr:status',
  'vad:status',
  'vault:delete',
  'vault:is-available',
  'vault:list-slots',
  'vault:retrieve',
]))

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function walkJsFiles(root, path) {
  const directory = join(root, path)
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const fullPath = join(directory, entry.name)
    const relativePath = relative(root, fullPath)
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(root, relativePath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

function parseSource(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
}

function lineFor(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function literalText(node) {
  return isStringLiteralLike(node) ? node.text : null
}

function isCallOn(node, objectName, methodName, sourceFile) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  if (node.expression.name.text !== methodName) return false
  return node.expression.expression.getText(sourceFile) === objectName
}

function objectPropertyName(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function buildParentMap(sourceFile) {
  const parents = new Map()

  function visit(node) {
    ts.forEachChild(node, (child) => {
      parents.set(child, node)
      visit(child)
    })
  }

  visit(sourceFile)
  return parents
}

function findNearestPropertyName(node, parents) {
  let current = node
  while (current) {
    const parent = parents.get(current)
    if (parent && ts.isPropertyAssignment(parent)) {
      return objectPropertyName(parent.name)
    }
    current = parent
  }
  return null
}

function extractPreloadSurface(root) {
  const source = readText(root, PRELOAD_PATH)
  const sourceFile = parseSource(PRELOAD_PATH, source)
  const parents = buildParentMap(sourceFile)
  const invokes = []
  const subscriptions = []

  function visit(node) {
    if (isCallOn(node, 'ipcRenderer', 'invoke', sourceFile)) {
      const channel = literalText(node.arguments[0])
      if (channel) {
        invokes.push({
          channel,
          bridgeMethod: findNearestPropertyName(node, parents),
          argumentCount: node.arguments.length,
          hasRendererPayload: node.arguments.length > 1,
          location: { file: PRELOAD_PATH, line: lineFor(sourceFile, node.getStart(sourceFile)) },
        })
      }
    } else if (isCallOn(node, 'ipcRenderer', 'on', sourceFile)) {
      const channel = literalText(node.arguments[0])
      if (channel) {
        subscriptions.push({
          channel,
          bridgeMethod: findNearestPropertyName(node, parents),
          location: { file: PRELOAD_PATH, line: lineFor(sourceFile, node.getStart(sourceFile)) },
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { invokes, subscriptions }
}

function detectHandlerValidation(handlerSource) {
  if (/validate[A-Za-z0-9]+Payload\s*\(/.test(handlerSource)) return 'schema'
  if (/(?:requireString|expectString|requireObject|requireSlotName|requireSlotNames|requireVaultEntries|assertNumber|assertArray|assertOptionalString)\s*\(/.test(handlerSource)) {
    return 'manual'
  }
  if (/(?:Array\.isArray|String|Boolean|Number)\s*\(|instanceof\s+Float32Array/.test(handlerSource)) {
    return 'manual'
  }
  return 'none'
}

function classifyRisk(channel) {
  if (/^vault:|^vts-bridge:migrate-legacy-token$/.test(channel)) {
    return { level: 'high', domain: 'secret-vault' }
  }
  if (/^vts-bridge:/.test(channel)) {
    return { level: 'medium', domain: 'desktop-action' }
  }
  if (/^desktop-context:/.test(channel)) {
    return { level: 'high', domain: 'desktop-context' }
  }
  if (/^file:/.test(channel)) {
    return { level: 'high', domain: 'file-system' }
  }
  if (/^tool:open-external$/.test(channel)) {
    return { level: 'high', domain: 'external-navigation' }
  }
  if (/^mcp:call-tool$|^mcp:sync-servers$|^plugin:(start|stop|restart|enable|disable|approve|revoke)$|^plugin-bus:(publish|subscribe|unsubscribe)$/.test(channel)) {
    return { level: 'high', domain: 'extension-execution' }
  }
  if (/^external-action-policy:sync$/.test(channel)) {
    return { level: 'high', domain: 'permission-control' }
  }
  if (/^local-data:(?:chat-migration-(?:apply|rollback)|chat-session-mirror|chat-comparison-preview|memory-migration-(?:apply|rollback)|companion-(?:comparison-preview|dataset-mirror|migration-(?:apply|rollback)))$/.test(channel)) {
    return { level: 'high', domain: 'local-user-data' }
  }
  if (/^local-data:(?:chat-migration-status|memory-migration-status|memory-read|companion-(?:migration-status|read))$/.test(channel)) {
    return { level: 'medium', domain: 'local-user-data' }
  }
  if (/^(telegram|discord):send-|^minecraft:send-command$|^factorio:execute$/.test(channel)) {
    return { level: 'high', domain: 'external-action' }
  }
  if (/^pet-model:(import|create|assemble|install|open)/.test(channel)) {
    return { level: 'high', domain: 'local-artifact' }
  }
  if (/^chat:|^audio:|^service:test-connection$|^tencent-asr:connect$/.test(channel)) {
    return { level: 'medium', domain: 'provider-network' }
  }
  if (/^tool:|^media-session:control$|^notification:|^proactive:/.test(channel)) {
    return { level: 'medium', domain: 'desktop-action' }
  }
  if (/^memory:|^persona:|^skill:/.test(channel)) {
    return { level: 'medium', domain: 'local-user-data' }
  }
  return { level: 'low', domain: 'app-state' }
}

/**
 * Lists the JavaScript files whose `ipcMain.handle` calls feed the handler inventory.
 * Scanning all of `electron/` keeps handlers registered in `main.js` or a non-IPC
 * module visible to the every-channel pin test.
 * @param {string} [root] Repository root override for fixture scans.
 * @returns {string[]} Repository-relative JavaScript file paths, sorted.
 */
export function listMainHandlerFiles(root = DEFAULT_ROOT) {
  return walkJsFiles(resolve(root), ELECTRON_DIR)
}

/**
 * Returns the handler's body when it is a block, or the concise expression
 * body itself. `null` means the second argument is not a function literal.
 * @param {import('typescript6').Node | undefined} handlerNode
 */
function handlerBody(handlerNode) {
  if (!handlerNode) return null
  if (ts.isArrowFunction(handlerNode) || ts.isFunctionExpression(handlerNode)) {
    return handlerNode.body
  }
  return null
}

/**
 * A handler complies only when its first statement is a `requireTrustedSender`
 * call. Comments and blank lines do not appear in the AST, so a documented
 * leading check still passes, while a check after a data read or nested inside
 * a conditional does not.
 * @param {import('typescript6').Node | undefined} handlerNode
 */
function startsWithTrustedSenderCheck(handlerNode) {
  const body = handlerBody(handlerNode)
  if (!body) return false
  const first = ts.isBlock(body) ? body.statements[0] : body
  if (!first) return false
  const expression = ts.isExpressionStatement(first) ? first.expression : first
  if (!ts.isCallExpression(expression)) return false
  const callee = expression.expression
  if (!ts.isIdentifier(callee) || callee.text !== 'requireTrustedSender') return false
  const firstArgument = expression.arguments[0]
  if (!firstArgument || !ts.isIdentifier(firstArgument) || firstArgument.text !== 'event') return false
  return true
}

function extractMainHandlers(root) {
  const handlers = []

  for (const file of listMainHandlerFiles(root)) {
    const source = readText(root, file)
    const sourceFile = parseSource(file, source)

    function visit(node) {
      if (isCallOn(node, 'ipcMain', 'handle', sourceFile)) {
        const channel = literalText(node.arguments[0])
        if (channel) {
          const handlerNode = node.arguments[1] ?? node
          const handlerSource = handlerNode.getText(sourceFile)
          const risk = classifyRisk(channel)
          handlers.push({
            channel,
            location: { file, line: lineFor(sourceFile, node.getStart(sourceFile)) },
            trustedSender: startsWithTrustedSenderCheck(handlerNode),
            payloadValidation: detectHandlerValidation(handlerSource),
            auditLogged: /\baudit\s*\(|runAuditedExternalAction\s*\(|runAuditedPetModelAction\s*\(|runAuditedPluginAction\s*\(|runAuditedVaultAction\s*\(|runAuditedVtsAction\s*\(|applyChatLocalDataMigration\s*\(|rollbackChatLocalDataMigration\s*\(|mirrorChatLocalDataSession\s*\(|compareChatLocalDataSessions\s*\(|applyMemoryLocalDataMigration\s*\(|rollbackMemoryLocalDataMigration\s*\(|applyCompanionLocalDataMigration\s*\(|compareCompanionLocalData\s*\(|rollbackCompanionLocalDataMigration\s*\(|mirrorCompanionLocalDataDataset\s*\(/.test(handlerSource),
            permissionHint: /(dialog\.showMessageBox|dialog\.show(?:Save|Open)Dialog|saveTextFileFromDialog|openTextFileFromDialog|invokeRegisteredTool|normalizeDesktopContextPolicy|runAuditedExternalAction|runAuditedPetModelAction|runAuditedPluginAction|runAuditedVaultAction|runAuditedVtsAction|requireExternalActionPermission|syncExternalActionPolicy|requiresConfirmation|approve|policy|confirm)/.test(handlerSource),
            riskLevel: risk.level,
            riskDomain: risk.domain,
          })
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return handlers.sort((a, b) => a.channel.localeCompare(b.channel))
}

function collectElectronStringLiterals(root) {
  const literals = new Set()
  for (const file of walkJsFiles(root, 'electron')) {
    if (file === PRELOAD_PATH) continue
    const source = readText(root, file)
    const sourceFile = parseSource(file, source)
    function visit(node) {
      if (isStringLiteralLike(node)) literals.add(node.text)
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return literals
}

function indexByChannel(items) {
  const indexed = new Map()
  for (const item of items) {
    const list = indexed.get(item.channel) ?? []
    list.push(item)
    indexed.set(item.channel, list)
  }
  return indexed
}

function uniqueChannels(items) {
  return [...new Set(items.map((item) => item.channel))].sort()
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] ?? 'unknown'
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

export function summarizeIpcContractReport(report) {
  return report.summary
}

export function buildIpcContractReport(root = DEFAULT_ROOT) {
  const repoRoot = resolve(root)
  const preloadSurface = extractPreloadSurface(repoRoot)
  const handlers = extractMainHandlers(repoRoot)
  const mainStrings = collectElectronStringLiterals(repoRoot)
  const invokes = preloadSurface.invokes
  const subscriptions = preloadSurface.subscriptions
  const invokeChannels = uniqueChannels(invokes)
  const subscriptionChannels = uniqueChannels(subscriptions)
  const handlerChannels = uniqueChannels(handlers)
  const handlerIndex = indexByChannel(handlers)
  const invokeIndex = indexByChannel(invokes)

  const missingHandlers = invokeChannels
    .filter((channel) => !handlerIndex.has(channel))
    .map((channel) => ({ channel, location: invokeIndex.get(channel)?.[0]?.location ?? null }))

  const duplicateHandlers = [...handlerIndex.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([channel, list]) => ({ channel, locations: list.map((item) => item.location) }))

  const mainOnlyHandlers = handlerChannels
    .filter((channel) => !invokeIndex.has(channel) && !INTENTIONALLY_MAIN_ONLY_CHANNELS.has(channel))
    .map((channel) => ({ channel, location: handlerIndex.get(channel)?.[0]?.location ?? null }))

  const intentionallyMainOnlyHandlers = handlerChannels
    .filter((channel) => !invokeIndex.has(channel) && INTENTIONALLY_MAIN_ONLY_CHANNELS.has(channel))
    .map((channel) => ({ channel, location: handlerIndex.get(channel)?.[0]?.location ?? null }))

  const missingTrustedSender = handlers
    .filter((handler) => !handler.trustedSender)
    .map(({ channel, location }) => ({ channel, location }))

  const payloadChannelSet = new Set(invokes.filter((item) => item.hasRendererPayload).map((item) => item.channel))
  const payloadWithoutValidation = handlers
    .filter((handler) => payloadChannelSet.has(handler.channel) && handler.payloadValidation === 'none')
    .map(({ channel, location, riskLevel, riskDomain }) => ({ channel, location, riskLevel, riskDomain }))

  const highRiskHandlers = handlers.filter((handler) => handler.riskLevel === 'high')
  const unclassifiedHighRiskCapabilities = highRiskHandlers
    .filter((handler) => !isWindowCapabilityClassified(handler.channel))
    .map(({ channel, location, riskDomain }) => ({ channel, location, riskDomain, capability: getRequiredWindowCapability(channel) }))
  const highRiskWithoutAudit = highRiskHandlers
    .filter((handler) => !handler.auditLogged)
    .map(({ channel, location, riskDomain }) => ({ channel, location, riskDomain }))
  const highRiskWithoutPermissionHint = highRiskHandlers
    .filter((handler) => !handler.permissionHint)
    .map(({ channel, location, riskDomain }) => ({ channel, location, riskDomain }))

  const missingSubscriptionSources = subscriptionChannels
    .filter((channel) => !mainStrings.has(channel))
    .map((channel) => ({ channel, location: subscriptions.find((item) => item.channel === channel)?.location ?? null }))

  const errors = {
    missingHandlers,
    duplicateHandlers,
    missingTrustedSender,
    missingSubscriptionSources,
    unclassifiedHighRiskCapabilities,
  }

  const warnings = {
    mainOnlyHandlers,
    payloadWithoutValidation,
    highRiskWithoutAudit,
    highRiskWithoutPermissionHint,
  }

  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)
  const warningCount = Object.values(warnings).reduce((sum, list) => sum + list.length, 0)

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoRoot,
    sources: {
      preload: PRELOAD_PATH,
      handlerScanRoot: ELECTRON_DIR,
    },
    counts: {
      preloadInvokeChannels: invokeChannels.length,
      preloadSubscriptionChannels: subscriptionChannels.length,
      mainHandlerChannels: handlerChannels.length,
      highRiskHandlerChannels: highRiskHandlers.length,
    },
    coverage: {
      riskLevel: countBy(handlers, 'riskLevel'),
      riskDomain: countBy(handlers, 'riskDomain'),
      payloadValidation: countBy(handlers, 'payloadValidation'),
      windowCapability: countBy(
        handlers.map((handler) => ({
          ...handler,
          channelCapability: getRequiredWindowCapability(handler.channel),
        })),
        'channelCapability',
      ),
    },
    channels: handlers.map((handler) => ({
      ...handler,
      channelCapability: getRequiredWindowCapability(handler.channel),
      exposedByPreload: invokeIndex.has(handler.channel),
      rendererPayload: payloadChannelSet.has(handler.channel),
    })),
    subscriptions,
    intentionallyMainOnlyHandlers,
    errors,
    warnings,
    summary: {
      ok: errorCount === 0 && warningCount === 0,
      errors: errorCount,
      warnings: warningCount,
    },
    privacy: {
      readsEnvironment: false,
      readsKeychain: false,
      readsUserData: false,
      readsSecretValues: false,
      staticSourceOnly: true,
    },
  }
}

function formatSample(items, limit = 8) {
  if (!items.length) return 'none'
  const shown = items.slice(0, limit).map((item) => item.channel).join(', ')
  return items.length > limit ? `${shown}, ... +${items.length - limit} more` : shown
}

function formatHumanReport(report) {
  const lines = ['IPC contract audit']
  lines.push(`- preload invoke channels: ${report.counts.preloadInvokeChannels}`)
  lines.push(`- preload subscription channels: ${report.counts.preloadSubscriptionChannels}`)
  lines.push(`- main handler channels: ${report.counts.mainHandlerChannels}`)
  lines.push(`- high-risk handler channels: ${report.counts.highRiskHandlerChannels}`)
  lines.push(`- risk coverage: ${JSON.stringify(report.coverage.riskLevel)}`)
  lines.push(`- payload validation coverage: ${JSON.stringify(report.coverage.payloadValidation)}`)
  lines.push('')

  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) lines.push(`  ${formatSample(items)}`)
  }

  for (const [name, items] of Object.entries(report.warnings)) {
    lines.push(`WARN ${name}: ${items.length}`)
    if (items.length) lines.push(`  ${formatSample(items)}`)
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} warnings=${report.summary.warnings} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function parseArgs(argv) {
  return {
    json: argv.includes('--json') || argv.includes('--format=json'),
  }
}

function main(argv) {
  if (!existsSync(join(DEFAULT_ROOT, PRELOAD_PATH))) {
    throw new Error(`preload file not found: ${PRELOAD_PATH}`)
  }
  const options = parseArgs(argv)
  const report = buildIpcContractReport(DEFAULT_ROOT)
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) {
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
