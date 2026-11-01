/**
 * Per-call confirmation for MCP tools that can change something.
 *
 * The main process opens a native dialog before every side-effecting call and
 * shows the server, tool, and pretty-printed arguments. The gate fails closed:
 * no window, a headless/smoke/test run, a dialog error, or anything except the
 * explicit "allow once" button leaves the call refused. There is deliberately
 * no "always allow" and no auto-allow on timeout.
 *
 * The pure decision surface takes injected dialog dependencies so node tests
 * can exercise every fail-closed branch without loading Electron.
 */

import { createRequire } from 'node:module'

import { MCP_TOOL_NOT_ALLOWED_CODE } from '../../shared/mcpToolErrors.js'
import { readMainUiLocale, translateMainMessage } from '../mainMessages.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { isSideEffectingMcpTool } from './mcpToolSafety.js'

const MAX_ARGUMENTS_CHARS = 2_000
const require = createRequire(import.meta.url)

let defaultDialogDeps = null

function getDefaultDialogDeps() {
  if (defaultDialogDeps) return defaultDialogDeps
  const { BrowserWindow, dialog } = require('electron')
  defaultDialogDeps = {
    getParentWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    showMessageBox: (parent, options) => dialog.showMessageBox(parent, options),
  }
  return defaultDialogDeps
}

function isHeadlessEnvironment() {
  return (
    process.env.NODE_ENV === 'test'
    || process.env.SMOKE_TEST === '1'
    || process.env.NEXUS_HEADLESS === '1'
  )
}

/**
 * Pretty-print call arguments for the dialog, capped so a hostile or huge
 * payload cannot cover the whole screen (or the buttons).
 *
 * @param {unknown} toolArgs
 * @param {number} [maxLength]
 * @returns {string}
 */
export function formatMcpToolArgumentsForApproval(toolArgs, maxLength = MAX_ARGUMENTS_CHARS) {
  let text
  try {
    text = JSON.stringify(toolArgs ?? {}, null, 2)
  } catch (error) {
    console.warn('[mcpToolConfirmation] argument serialization failed:', getRedactedErrorMessage(error))
    text = String(toolArgs ?? '')
  }
  if (typeof text !== 'string') text = String(text)
  if (text.length <= maxLength) return text

  const suffix = '\n...[truncated]'
  const keep = Math.max(0, maxLength - suffix.length)
  return `${text.slice(0, keep)}${suffix}`
}

/**
 * Build the native dialog options. All copy comes from the main-process
 * five-locale table; the first button is deny and is also the default/cancel
 * action.
 *
 * @param {{
 *   serverId: string,
 *   toolName: string,
 *   toolArgs: unknown,
 *   locale?: string,
 * }} input
 */
export function buildMcpToolCallApprovalDialogOptions(input) {
  const locale = input.locale ?? readMainUiLocale()
  return {
    type: 'warning',
    title: translateMainMessage('mcp.toolCall.title', undefined, locale),
    message: translateMainMessage('mcp.toolCall.message', {
      server: input.serverId,
      tool: input.toolName,
    }, locale),
    detail: translateMainMessage('mcp.toolCall.detail', {
      args: formatMcpToolArgumentsForApproval(input.toolArgs),
    }, locale),
    buttons: [
      translateMainMessage('mcp.toolCall.deny', undefined, locale),
      translateMainMessage('mcp.toolCall.allowOnce', undefined, locale),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
}

/**
 * Ask the user to allow one specific call. Returns true only for the explicit
 * allow-once response; every other path returns false.
 *
 * @param {{
 *   serverId: string,
 *   toolName: string,
 *   toolArgs: unknown,
 *   locale?: string,
 *   isHeadless?: boolean,
 *   getParentWindow?: () => unknown,
 *   showMessageBox?: (parent: unknown, options: unknown) => Promise<{ response?: number }>,
 * }} options
 * @returns {Promise<boolean>}
 */
export async function confirmMcpToolCall(options) {
  if (options.isHeadless ?? isHeadlessEnvironment()) return false

  let dialogDeps
  try {
    dialogDeps = (
      typeof options.getParentWindow === 'function'
      && typeof options.showMessageBox === 'function'
    )
      ? { getParentWindow: options.getParentWindow, showMessageBox: options.showMessageBox }
      : getDefaultDialogDeps()
  } catch (error) {
    console.warn('[mcpToolConfirmation] dialog dependencies unavailable:', getRedactedErrorMessage(error))
    return false
  }

  let parentWindow
  try {
    parentWindow = dialogDeps.getParentWindow()
  } catch (error) {
    console.warn('[mcpToolConfirmation] no parent window for confirmation:', getRedactedErrorMessage(error))
    return false
  }
  if (!parentWindow) return false

  let result
  try {
    result = await dialogDeps.showMessageBox(
      parentWindow,
      buildMcpToolCallApprovalDialogOptions({
        serverId: options.serverId,
        toolName: options.toolName,
        toolArgs: options.toolArgs,
        locale: options.locale,
      }),
    )
  } catch (error) {
    console.warn('[mcpToolConfirmation] confirmation dialog failed:', getRedactedErrorMessage(error))
    return false
  }

  // Index 1 is the only allow button. A closed dialog, Escape, a negative
  // index, or any future extra button all fall through to refusal.
  return result?.response === 1
}

/**
 * Run `call` behind the per-call confirmation gate. Read-only tools run
 * immediately; everything else must be explicitly allowed each time.
 *
 * @template T
 * @param {{
 *   serverId: string,
 *   toolName: string,
 *   toolArgs: unknown,
 *   toolMeta?: unknown,
 *   call: () => Promise<T>,
 *   locale?: string,
 *   isHeadless?: boolean,
 *   getParentWindow?: () => unknown,
 *   showMessageBox?: (parent: unknown, options: unknown) => Promise<{ response?: number }>,
 * }} options
 * @returns {Promise<T>}
 */
export async function runConfirmedMcpToolCall(options) {
  const sideEffecting = isSideEffectingMcpTool(options.toolMeta ?? { name: options.toolName })

  if (sideEffecting) {
    const allowed = await confirmMcpToolCall({
      serverId: options.serverId,
      toolName: options.toolName,
      toolArgs: options.toolArgs,
      locale: options.locale,
      isHeadless: options.isHeadless,
      getParentWindow: options.getParentWindow,
      showMessageBox: options.showMessageBox,
    })
    if (!allowed) {
      const error = new Error(
        `${MCP_TOOL_NOT_ALLOWED_CODE}: MCP tool [${options.serverId}/${options.toolName}] call was not allowed by the user`,
      )
      error.code = MCP_TOOL_NOT_ALLOWED_CODE
      throw error
    }
  }

  return options.call()
}
