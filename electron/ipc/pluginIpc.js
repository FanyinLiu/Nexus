import { ipcMain } from 'electron'
import * as pluginHost from '../services/pluginHost.js'
import * as mcpHost from '../services/mcpHost.js'
import * as messageBus from '../services/pluginMessageBus.js'
import { requireTrustedSender } from './validate.js'
import { audit } from '../services/auditLog.js'

export function register() {
  ipcMain.handle('plugin:scan', async (event) => {
    requireTrustedSender(event)
    return pluginHost.scanPlugins()
  })

  ipcMain.handle('plugin:list', (event) => {
    requireTrustedSender(event)
    return pluginHost.listPlugins()
  })

  ipcMain.handle('plugin:start', async (event, payload) => {
    requireTrustedSender(event)
    const id = String(payload?.id ?? '')
    audit('plugin', 'start', { id })
    return pluginHost.startPlugin(id)
  })

  ipcMain.handle('plugin:stop', async (event, payload) => {
    requireTrustedSender(event)
    const id = String(payload?.id ?? '')
    audit('plugin', 'stop', { id })
    await pluginHost.stopPlugin(id)
    return { ok: true }
  })

  ipcMain.handle('plugin:restart', async (event, payload) => {
    requireTrustedSender(event)
    const id = String(payload?.id ?? '')
    audit('plugin', 'restart', { id })
    return pluginHost.restartPlugin(id)
  })

  ipcMain.handle('plugin:enable', (event, payload) => {
    requireTrustedSender(event)
    const id = String(payload?.id ?? '')
    audit('plugin', 'enable', { id })
    return pluginHost.enablePlugin(id)
  })

  ipcMain.handle('plugin:disable', (event, payload) => {
    requireTrustedSender(event)
    const id = String(payload?.id ?? '')
    audit('plugin', 'disable', { id })
    return pluginHost.disablePlugin(id)
  })

  ipcMain.handle('plugin:status', (event, payload) => {
    requireTrustedSender(event)
    return pluginHost.getPluginStatus(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:dir', (event) => {
    requireTrustedSender(event)
    return pluginHost.getPluginsDir_()
  })

  ipcMain.handle('plugin:approve', async (event, payload) => {
    requireTrustedSender(event)
    const pluginId = String(payload?.id ?? '')
    audit('plugin', 'approve', { id: pluginId })
    await pluginHost.approvePlugin(pluginId)
    return pluginHost.getPluginStatus(pluginId)
  })

  ipcMain.handle('plugin:revoke', async (event, payload) => {
    requireTrustedSender(event)
    const pluginId = String(payload?.id ?? '')
    audit('plugin', 'revoke', { id: pluginId })
    await pluginHost.revokePluginApproval(pluginId)
    return pluginHost.getPluginStatus(pluginId)
  })

  // ── Plugin Message Bus ───────────────────────────────────────────────────

  // Validate serverId against running MCP instances to prevent spoofing
  function validateServerId(serverId) {
    if (!serverId) return false
    const status = mcpHost.getStatus(String(serverId))
    return status && status.state === 'running'
  }

  ipcMain.handle('plugin-bus:publish', (event, payload) => {
    requireTrustedSender(event)
    const { serverId, topic, data } = payload ?? {}
    if (!validateServerId(serverId) || !topic) return { delivered: 0 }
    return { delivered: messageBus.publish(String(serverId), String(topic), data) }
  })

  ipcMain.handle('plugin-bus:subscribe', (event, payload) => {
    requireTrustedSender(event)
    const { serverId, topic } = payload ?? {}
    if (!validateServerId(serverId) || !topic) return { accepted: false }
    return { accepted: messageBus.subscribe(String(serverId), String(topic)) }
  })

  ipcMain.handle('plugin-bus:unsubscribe', (event, payload) => {
    requireTrustedSender(event)
    const { serverId, topic } = payload ?? {}
    if (!validateServerId(serverId) || !topic) return
    messageBus.unsubscribe(String(serverId), String(topic))
  })

  ipcMain.handle('plugin-bus:subscriptions', (event) => {
    requireTrustedSender(event)
    return messageBus.listSubscriptions()
  })

  ipcMain.handle('plugin-bus:recent', (event, payload) => {
    requireTrustedSender(event)
    return messageBus.getRecentMessages(payload?.limit ?? 20)
  })

  ipcMain.handle('plugin-bus:stats', (event) => {
    requireTrustedSender(event)
    return messageBus.getStats()
  })
}
