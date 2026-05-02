import { ipcMain } from 'electron'
import * as workspaceFs from '../services/workspaceFs.js'
import {
  isWorkspaceApproved,
  promptWorkspaceApproval,
} from '../services/workspaceApprovals.js'
import { requireTrustedSender, requireString } from './validate.js'
import { audit } from '../services/auditLog.js'
import {
  validateWorkspaceEditPayload,
  validateWorkspaceGlobPayload,
  validateWorkspaceGrepPayload,
  validateWorkspacePathPayload,
  validateWorkspaceRootPayload,
  validateWorkspaceWritePayload,
} from './payloadSchemas.js'

export function register() {
  ipcMain.handle('workspace:set-root', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspaceRootPayload(payload)
    const root = String(payload?.root ?? '')

    // Empty / cleared root: always allowed (renderer is unsetting). All
    // workspace ops will then throw "Workspace root not configured" until
    // a new approved path comes in.
    if (!root.trim()) {
      audit('workspace', 'set-root', { root: '' })
      workspaceFs.setWorkspaceRoot('')
      return { ok: true, root: workspaceFs.getWorkspaceRoot() }
    }

    // Approved-path fast path: same path the user previously confirmed
    // (e.g. renderer restoring last-set-root on app launch). No dialog.
    if (await isWorkspaceApproved(root)) {
      audit('workspace', 'set-root', { root, approved: 'cached' })
      workspaceFs.setWorkspaceRoot(root)
      return { ok: true, root: workspaceFs.getWorkspaceRoot() }
    }

    // Fresh path: native modal dialog. User must click Approve. The
    // approval is persisted so subsequent calls take the fast path.
    const approved = await promptWorkspaceApproval(root)
    if (!approved) {
      audit('workspace', 'set-root', { root, approved: 'rejected' })
      return {
        ok: false,
        root: workspaceFs.getWorkspaceRoot(),
        error: 'workspace_root_not_approved',
      }
    }

    audit('workspace', 'set-root', { root, approved: 'fresh' })
    workspaceFs.setWorkspaceRoot(root)
    return { ok: true, root: workspaceFs.getWorkspaceRoot() }
  })

  ipcMain.handle('workspace:get-root', async (event) => {
    requireTrustedSender(event)
    return { root: workspaceFs.getWorkspaceRoot() }
  })

  ipcMain.handle('workspace:read', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspacePathPayload('workspace:read', payload)
    const filePath = requireString(payload?.path, 'payload.path')
    return workspaceFs.readWorkspaceFile(filePath)
  })

  ipcMain.handle('workspace:write', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspaceWritePayload(payload)
    const filePath = requireString(payload?.path, 'payload.path')
    audit('workspace', 'write', { path: filePath })
    return workspaceFs.writeWorkspaceFile(
      filePath,
      String(payload?.content ?? ''),
    )
  })

  ipcMain.handle('workspace:edit', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspaceEditPayload(payload)
    const filePath = String(payload?.path ?? '')
    audit('workspace', 'edit', { path: filePath })
    return workspaceFs.editWorkspaceFile(
      filePath,
      String(payload?.oldString ?? ''),
      String(payload?.newString ?? ''),
    )
  })

  ipcMain.handle('workspace:glob', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspaceGlobPayload(payload)
    return workspaceFs.globWorkspace(String(payload?.pattern ?? ''))
  })

  ipcMain.handle('workspace:grep', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateWorkspaceGrepPayload(payload)
    return workspaceFs.grepWorkspace(String(payload?.query ?? ''), {
      caseSensitive: Boolean(payload?.caseSensitive),
      maxResults: payload?.maxResults,
    })
  })
}
