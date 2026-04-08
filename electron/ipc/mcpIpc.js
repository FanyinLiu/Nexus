import { ipcMain } from 'electron'
import * as mcpHost from '../services/mcpHost.js'
import { mcpClientService } from '../services/mcpClient.js'
import { splitCommandLine } from '../integrationRuntime.js'
import { requireString, requireObject } from './validate.js'

export function register() {
  // ── MCP stdio client ──

  ipcMain.handle('mcp-client:connect', async (_event, config) => {
    requireObject(config, 'config')
    return mcpClientService.connect(config)
  })

  ipcMain.handle('mcp-client:disconnect', (_event, serverId) => {
    mcpClientService.disconnect(serverId)
    return { ok: true }
  })

  ipcMain.handle('mcp-client:call-tool', async (_event, serverId, toolName, args) => {
    return mcpClientService.callTool(serverId, toolName, args)
  })

  ipcMain.handle('mcp-client:list-tools', (_event, serverId) => {
    return serverId
      ? mcpClientService.listTools(serverId)
      : mcpClientService.listAllTools()
  })

  ipcMain.handle('mcp-client:status', (_event, serverId) => {
    return serverId
      ? mcpClientService.getStatus(serverId)
      : mcpClientService.getAllStatuses()
  })

  // ── MCP Host (multi-server) ──

  ipcMain.handle('mcp:start', async (_event, payload) => {
    requireObject(payload, 'payload')
    const id = requireString(payload.id, 'id')
    const command = requireString(payload.command, 'command')
    const args = splitCommandLine(payload.args ?? '')
    await mcpHost.start(id, command, args)
    return mcpHost.getStatus(id)
  })

  ipcMain.handle('mcp:stop', async (_event, payload) => {
    const id = String(payload?.id ?? '').trim()
    await mcpHost.stop(id)
    return { ok: true }
  })

  ipcMain.handle('mcp:restart', async (_event, payload) => {
    requireObject(payload, 'payload')
    const id = requireString(payload.id, 'id')
    const command = requireString(payload.command, 'command')
    const args = splitCommandLine(payload.args ?? '')
    await mcpHost.restart(id, command, args)
    return mcpHost.getStatus(id)
  })

  ipcMain.handle('mcp:status', (_event, payload) => {
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.getStatus(id) : mcpHost.getAllStatuses()
  })

  ipcMain.handle('mcp:list-tools', (_event, payload) => {
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.listTools(id) : mcpHost.listAllTools()
  })

  ipcMain.handle('mcp:call-tool', async (_event, payload) => {
    requireObject(payload, 'payload')
    const name = requireString(payload.name, 'name')
    const toolArgs = payload.arguments ?? {}
    const id = payload.serverId ? String(payload.serverId).trim() : null
    return id
      ? mcpHost.callTool(id, name, toolArgs)
      : mcpHost.callToolByName(name, toolArgs)
  })
}
