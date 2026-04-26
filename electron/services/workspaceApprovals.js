/**
 * Workspace root approval ledger.
 *
 * `workspace:set-root` accepts an arbitrary path string from the renderer
 * and uses it as the base for `workspace:read` / `write` / `glob` / `grep`.
 * Without a gate, a malicious renderer (XSS in a chat message, hostile
 * plugin, compromised provider) can silently move the workspace root to
 * `~/.ssh`, `/etc`, or `/` and exfiltrate / overwrite arbitrary files.
 *
 * This module is the gate. The user must click Approve in a native
 * modal dialog the first time a new workspace root is requested. The
 * approval is persisted (mode 0o600) so the renderer's normal
 * "restore last-set-root on app launch" flow doesn't re-prompt.
 *
 * One approved path is stored at a time — workspace root is a singleton.
 * Switching to a different folder is a fresh approval.
 */

import { BrowserWindow, app, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createAsyncLock } from './asyncLock.js'

const APPROVALS_FILE_NAME = 'workspace-approval.json'

let _approvedPathCache = null
const withWriteLock = createAsyncLock()

function getApprovalsPath() {
  return path.join(app.getPath('userData'), APPROVALS_FILE_NAME)
}

function normalisePath(input) {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  return path.resolve(trimmed)
}

async function loadApproval() {
  if (_approvedPathCache !== null) return _approvedPathCache
  try {
    const raw = await fs.readFile(getApprovalsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.approvedPath === 'string') {
      _approvedPathCache = parsed.approvedPath
      return _approvedPathCache
    }
  } catch {
    // Missing / corrupt — start with no approval.
  }
  _approvedPathCache = ''
  return _approvedPathCache
}

async function saveApproval(approvedPath) {
  await fs.writeFile(
    getApprovalsPath(),
    JSON.stringify({ approvedPath }, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
  _approvedPathCache = approvedPath
}

export async function isWorkspaceApproved(requestedPath) {
  const normalised = normalisePath(requestedPath)
  if (!normalised) return false
  const approved = await loadApproval()
  return approved === normalised
}

/**
 * Show a native modal dialog asking the user to approve a workspace
 * root change. Returns true on Approve, false on Reject or any error.
 *
 * The dialog shows the full resolved path verbatim so the user can spot
 * obvious red flags (`/etc`, `/System`, `~/.ssh`, etc.). The default
 * button is Reject — never silently accept.
 */
export async function promptWorkspaceApproval(requestedPath) {
  const normalised = normalisePath(requestedPath)
  if (!normalised) return false

  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

  let result
  try {
    result = await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      title: 'Approve workspace folder',
      message: 'Allow Nexus to use this folder as its workspace?',
      detail:
        `Folder:\n  ${normalised}\n\n`
        + 'Once approved, Nexus can read, write, glob, and grep files anywhere '
        + 'inside this folder. Make sure this is a project folder you control. '
        + 'Approving a system folder (e.g. /, /etc, /System, ~/.ssh) is a bad '
        + 'idea — Nexus would then be able to read / overwrite anything in it.',
      buttons: ['Reject', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
  } catch (error) {
    console.warn('[workspaceApprovals] Failed to show approval dialog:', error?.message ?? error)
    return false
  }

  if (result.response !== 1) return false

  await withWriteLock(async () => {
    await saveApproval(normalised)
  })
  return true
}

/**
 * Test helper. Resets the in-memory cache so subsequent calls re-read
 * the approval file from disk. Production code never needs this.
 */
export function __resetWorkspaceApprovalCache() {
  _approvedPathCache = null
}
