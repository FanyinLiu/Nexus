import { ipcMain } from 'electron'
import * as pluginHost from '../services/pluginHost.js'

export function register() {
  ipcMain.handle('plugin:scan', async () => {
    return pluginHost.scanPlugins()
  })

  ipcMain.handle('plugin:list', () => {
    return pluginHost.listPlugins()
  })

  ipcMain.handle('plugin:start', async (_event, payload) => {
    return pluginHost.startPlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:stop', async (_event, payload) => {
    await pluginHost.stopPlugin(String(payload?.id ?? ''))
    return { ok: true }
  })

  ipcMain.handle('plugin:restart', async (_event, payload) => {
    return pluginHost.restartPlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:enable', (_event, payload) => {
    return pluginHost.enablePlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:disable', (_event, payload) => {
    return pluginHost.disablePlugin(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:status', (_event, payload) => {
    return pluginHost.getPluginStatus(String(payload?.id ?? ''))
  })

  ipcMain.handle('plugin:dir', () => {
    return pluginHost.getPluginsDir_()
  })
}
