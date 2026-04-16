import { ipcMain } from 'electron'
import * as workspaceFs from '../services/workspaceFs.js'
import { requireTrustedSender, requireString } from './validate.js'
import { audit } from '../services/auditLog.js'

export function register() {
  ipcMain.handle('workspace:set-root', async (event, payload) => {
    requireTrustedSender(event)
    const root = String(payload?.root ?? '')
    audit('workspace', 'set-root', { root })
    workspaceFs.setWorkspaceRoot(root)
    return { ok: true, root: workspaceFs.getWorkspaceRoot() }
  })

  ipcMain.handle('workspace:get-root', async (event) => {
    requireTrustedSender(event)
    return { root: workspaceFs.getWorkspaceRoot() }
  })

  ipcMain.handle('workspace:read', async (event, payload) => {
    requireTrustedSender(event)
    const filePath = requireString(payload?.path, 'payload.path')
    return workspaceFs.readWorkspaceFile(filePath)
  })

  ipcMain.handle('workspace:write', async (event, payload) => {
    requireTrustedSender(event)
    const filePath = requireString(payload?.path, 'payload.path')
    audit('workspace', 'write', { path: filePath })
    return workspaceFs.writeWorkspaceFile(
      filePath,
      String(payload?.content ?? ''),
    )
  })

  ipcMain.handle('workspace:edit', async (event, payload) => {
    requireTrustedSender(event)
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
    return workspaceFs.globWorkspace(String(payload?.pattern ?? ''))
  })

  ipcMain.handle('workspace:grep', async (event, payload) => {
    requireTrustedSender(event)
    return workspaceFs.grepWorkspace(String(payload?.query ?? ''), {
      caseSensitive: Boolean(payload?.caseSensitive),
      maxResults: payload?.maxResults,
    })
  })
}
