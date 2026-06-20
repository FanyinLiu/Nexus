import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as pluginHost from '../services/pluginHost.js'
import * as mcpHost from '../services/mcpHost.js'
import * as messageBus from '../services/pluginMessageBus.js'
import { requireTrustedSender } from './validate.js'
import { audit } from '../services/auditLog.js'
import {
  validatePluginBusRecentPayload,
  validatePluginBusTopicPayload,
  validatePluginIdPayload,
} from './payloadSchemas.js'
import {
  pluginActionNeedsConfirmation,
  summarizePluginRequest,
  summarizePluginResult,
} from './pluginAudit.js'

function pluginAuditCategory(channel) {
  return channel.startsWith('plugin-bus:') ? 'plugin-bus' : 'plugin'
}

async function confirmPluginAction(event, channel, payload) {
  if (!pluginActionNeedsConfirmation(channel)) return true

  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const category = pluginAuditCategory(channel)
  const requestSummary = summarizePluginRequest(channel, payload)
  audit(category, 'confirmation-request', requestSummary)

  const isBusAction = channel.startsWith('plugin-bus:')
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'warning',
    buttons: ['继续', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: isBusAction ? '确认插件消息总线操作' : '确认插件操作',
    message: isBusAction
      ? '允许 Nexus 执行这个插件消息总线操作吗？'
      : '允许 Nexus 执行这个插件操作吗？',
    detail: isBusAction
      ? '该操作会改变插件通信状态或发布插件消息。审计日志只会记录元数据，不记录 serverId、topic 或消息内容。'
      : '该操作可能启动本地插件进程、改变插件启用状态，或修改插件授权。审计日志只会记录元数据，不记录插件 ID、名称、描述或命令。',
  })

  const approved = response === 0
  audit(category, approved ? 'confirmation-approved' : 'confirmation-rejected', requestSummary)
  return approved
}

async function runAuditedPluginAction(event, channel, payload, action) {
  const category = pluginAuditCategory(channel)
  audit(category, 'request', summarizePluginRequest(channel, payload))
  try {
    const approved = await confirmPluginAction(event, channel, payload)
    if (!approved) {
      throw new Error('插件操作已取消。')
    }
    const result = await action()
    audit(category, 'result', summarizePluginResult(channel, result))
    return result
  } catch (error) {
    audit(category, 'result', summarizePluginResult(channel, {}, error))
    throw error
  }
}

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
    payload = validatePluginIdPayload('plugin:start', payload)
    const id = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:start', payload, () => pluginHost.startPlugin(id))
  })

  ipcMain.handle('plugin:stop', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:stop', payload)
    const id = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:stop', payload, async () => {
      await pluginHost.stopPlugin(id)
      return { ok: true }
    })
  })

  ipcMain.handle('plugin:restart', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:restart', payload)
    const id = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:restart', payload, () => pluginHost.restartPlugin(id))
  })

  ipcMain.handle('plugin:enable', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:enable', payload)
    const id = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:enable', payload, () => pluginHost.enablePlugin(id))
  })

  ipcMain.handle('plugin:disable', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:disable', payload)
    const id = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:disable', payload, () => pluginHost.disablePlugin(id))
  })

  ipcMain.handle('plugin:status', (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:status', payload)
    return pluginHost.getPluginStatus(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:dir', (event) => {
    requireTrustedSender(event)
    return pluginHost.getPluginsDir_()
  })

  ipcMain.handle('plugin:approve', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:approve', payload)
    const pluginId = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:approve', payload, async () => {
      await pluginHost.approvePlugin(pluginId)
      return pluginHost.getPluginStatus(pluginId)
    })
  })

  ipcMain.handle('plugin:revoke', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginIdPayload('plugin:revoke', payload)
    const pluginId = String(payload?.id ?? '')
    return runAuditedPluginAction(event, 'plugin:revoke', payload, async () => {
      await pluginHost.revokePluginApproval(pluginId)
      return pluginHost.getPluginStatus(pluginId)
    })
  })

  // ── Plugin Message Bus ───────────────────────────────────────────────────

  // Validate serverId against running MCP instances to prevent spoofing
  function validateServerId(serverId) {
    if (!serverId) return false
    const status = mcpHost.getStatus(String(serverId))
    return status && status.state === 'running'
  }

  ipcMain.handle('plugin-bus:publish', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginBusTopicPayload('plugin-bus:publish', payload)
    const { serverId, topic, data } = payload ?? {}
    return runAuditedPluginAction(event, 'plugin-bus:publish', payload, () => {
      if (!validateServerId(serverId) || !topic) return { delivered: 0 }
      return { delivered: messageBus.publish(String(serverId), String(topic), data) }
    })
  })

  ipcMain.handle('plugin-bus:subscribe', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginBusTopicPayload('plugin-bus:subscribe', payload)
    const { serverId, topic } = payload ?? {}
    return runAuditedPluginAction(event, 'plugin-bus:subscribe', payload, () => {
      if (!validateServerId(serverId) || !topic) return { accepted: false }
      return { accepted: messageBus.subscribe(String(serverId), String(topic)) }
    })
  })

  ipcMain.handle('plugin-bus:unsubscribe', async (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginBusTopicPayload('plugin-bus:unsubscribe', payload)
    const { serverId, topic } = payload ?? {}
    return runAuditedPluginAction(event, 'plugin-bus:unsubscribe', payload, () => {
      if (!validateServerId(serverId) || !topic) return
      messageBus.unsubscribe(String(serverId), String(topic))
    })
  })

  ipcMain.handle('plugin-bus:subscriptions', (event) => {
    requireTrustedSender(event)
    return messageBus.listSubscriptions()
  })

  ipcMain.handle('plugin-bus:recent', (event, payload) => {
    requireTrustedSender(event)
    payload = validatePluginBusRecentPayload(payload)
    return messageBus.getRecentMessages(payload?.limit ?? 20)
  })

  ipcMain.handle('plugin-bus:stats', (event) => {
    requireTrustedSender(event)
    return messageBus.getStats()
  })
}
