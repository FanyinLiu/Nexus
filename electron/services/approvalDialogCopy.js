/**
 * Native approval-dialog copy builders for the main process.
 *
 * Each builder returns the exact options object handed to
 * `dialog.showMessageBox`, so tests can assert copy, button order and default
 * choice without launching Electron. Locale resolution stays with the caller
 * (`readMainUiLocale`), matching the other main-process dialogs.
 *
 * Security-sensitive payloads (commands, args, plugin metadata) are inserted
 * verbatim; only the surrounding labels and product copy are translated.
 */

import { translateMainMessage } from '../mainMessages.js'

/**
 * @param {{ command?: unknown, args?: unknown[] }} plugin
 * @returns {string}
 */
function pluginCommandLine(plugin) {
  const command = String(plugin?.command ?? '')
  const args = Array.isArray(plugin?.args) ? plugin.args.map(String) : []
  return args.length > 0 ? `${command} ${args.join(' ')}` : command
}

/**
 * Build the "start this MCP server" confirmation.
 * Buttons stay deny-first (defaultId 0) so Enter rejects.
 * @param {{ serverId: unknown, command: unknown, args?: unknown[], locale?: unknown }} input
 * @returns {Record<string, unknown>}
 */
export function buildMcpStartApprovalDialog(input) {
  const { serverId, command, args = [], locale } = input ?? {}
  const argsArr = Array.isArray(args) ? args : []
  const argsLine = argsArr.length > 0
    ? argsArr.join(' ')
    : translateMainMessage('approval.mcp.start.noArgs', undefined, locale)

  return {
    type: 'warning',
    title: translateMainMessage('approval.mcp.start.title', undefined, locale),
    message: translateMainMessage('approval.mcp.start.message', { server: serverId }, locale),
    detail:
      `${translateMainMessage('approval.commandLabel', undefined, locale)}\n  ${command}\n\n`
      + `${translateMainMessage('approval.mcp.start.argsLabel', undefined, locale)}\n  ${argsLine}\n\n`
      + translateMainMessage('approval.mcp.start.detail', undefined, locale),
    buttons: [
      translateMainMessage('approval.deny', undefined, locale),
      translateMainMessage('approval.allow', undefined, locale),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
}

/**
 * Build the "this MCP server added a tool" confirmation.
 * Buttons stay deny-first (defaultId 0) so Enter rejects.
 * @param {{ serverId: unknown, toolName: unknown, toolDescription?: string, locale?: unknown }} input
 * @returns {Record<string, unknown>}
 */
export function buildMcpToolApprovalDialog(input) {
  const { serverId, toolName, toolDescription = '', locale } = input ?? {}
  const descriptionPrefix = toolDescription
    ? `${translateMainMessage('approval.mcp.tool.descriptionLabel', undefined, locale)}\n  ${toolDescription}\n\n`
    : ''

  return {
    type: 'warning',
    title: translateMainMessage('approval.mcp.tool.title', undefined, locale),
    message: translateMainMessage('approval.mcp.tool.message', { server: serverId, tool: toolName }, locale),
    detail: descriptionPrefix + translateMainMessage('approval.mcp.tool.detail', undefined, locale),
    buttons: [
      translateMainMessage('approval.deny', undefined, locale),
      translateMainMessage('approval.allow', undefined, locale),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
}

/**
 * Build the single-plugin approval / re-approval confirmation.
 * Buttons stay allow-first with Deny still the default (defaultId 1).
 * @param {{ plugin: { id: unknown, name: unknown, version?: unknown, description?: unknown, command: unknown, args?: unknown[] }, isReapproval?: boolean, locale?: unknown }} input
 * @returns {Record<string, unknown>}
 */
export function buildPluginApprovalDialog(input) {
  const { plugin, isReapproval = false, locale } = input ?? {}
  const metadata = [
    `${translateMainMessage('approval.plugin.idLabel', undefined, locale)}${plugin?.id ?? ''}`,
    `${translateMainMessage('approval.plugin.versionLabel', undefined, locale)}${plugin?.version ?? ''}`,
    plugin?.description
      ? `${translateMainMessage('approval.plugin.descriptionLabel', undefined, locale)}${plugin.description}`
      : '',
    `${translateMainMessage('approval.commandLabel', undefined, locale)}${pluginCommandLine(plugin)}`,
  ].filter(Boolean)

  return {
    type: 'question',
    buttons: [
      translateMainMessage('approval.allow', undefined, locale),
      translateMainMessage('approval.deny', undefined, locale),
    ],
    defaultId: 1,
    cancelId: 1,
    title: isReapproval
      ? translateMainMessage('approval.plugin.single.title.reauth', undefined, locale)
      : translateMainMessage('approval.plugin.single.title.new', undefined, locale),
    message: isReapproval
      ? translateMainMessage('approval.plugin.single.message.reauth', { name: plugin?.name }, locale)
      : translateMainMessage('approval.plugin.single.message.new', { name: plugin?.name }, locale),
    detail: [
      metadata.join('\n'),
      isReapproval
        ? translateMainMessage('approval.plugin.single.detail.reauth', undefined, locale)
        : translateMainMessage('approval.plugin.single.detail.new', undefined, locale),
    ].join('\n\n'),
  }
}

/**
 * Build the batch-plugin approval confirmation.
 * Buttons stay allow-first with Deny-all still the default (defaultId 1).
 * `_one` keys avoid the English "1 plugins" wording.
 * @param {{ plugins: Array<{ id: unknown, name: unknown, version?: unknown }>, locale?: unknown }} input
 * @returns {Record<string, unknown>}
 */
export function buildBatchPluginApprovalDialog(input) {
  const { plugins = [], locale } = input ?? {}
  const list = Array.isArray(plugins) ? plugins : []
  const count = list.length
  const listing = list.map((plugin) => (
    `  • ${plugin?.name ?? ''} (${plugin?.id ?? ''} v${plugin?.version ?? ''})`
  )).join('\n')

  return {
    type: 'question',
    buttons: [
      translateMainMessage('approval.plugin.batch.allowAll', undefined, locale),
      translateMainMessage('approval.plugin.batch.denyAll', undefined, locale),
    ],
    defaultId: 1,
    cancelId: 1,
    title: count === 1
      ? translateMainMessage('approval.plugin.batch.title.one', undefined, locale)
      : translateMainMessage('approval.plugin.batch.title.other', { count }, locale),
    message: count === 1
      ? translateMainMessage('approval.plugin.batch.message.one', undefined, locale)
      : translateMainMessage('approval.plugin.batch.message.other', { count }, locale),
    detail: `${listing}\n\n${translateMainMessage('approval.plugin.batch.detail', undefined, locale)}`,
  }
}
