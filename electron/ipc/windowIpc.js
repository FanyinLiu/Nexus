import { BrowserWindow, ipcMain } from 'electron'
import {
  mainWindow,
  panelWindow,
  petWindowState,
  panelWindowState,
  buildRuntimeStateSnapshot,
  updateHeartbeat,
  updateRuntimeState,
  updatePetWindowState,
  updatePanelWindowState,
  showPanelWindow,
  showPetContextMenu,
  getLaunchOnStartupState,
  setLaunchOnStartupState,
  dragWindowBy,
  getViewKind,
  probeLocalServiceTarget,
} from '../windowManager.js'
import {
  listAvailablePetModels,
  importPetModelFromDialog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
} from '../services/petModelService.js'
import { invokeRegisteredTool } from '../tools/toolRegistry.js'
import {
  captureActiveWindowContext,
  captureScreenshotContext,
  normalizeDesktopContextPolicy,
  clipboard,
} from '../services/desktopContextService.js'
import {
  controlSystemMediaSession,
  getSystemMediaSessionSnapshot,
} from '../mediaSessionRuntime.js'
import { inspectIntegrationRuntime } from '../integrationRuntime.js'

export function register() {
  ipcMain.handle('pet-window:get-state', () => petWindowState)

  ipcMain.handle('pet-window:update-state', (_event, state) => {
    return updatePetWindowState(state)
  })

  ipcMain.handle('window:open-panel', (_event, section) => {
    showPanelWindow(section)
  })

  ipcMain.handle('window:open-pet-menu', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    showPetContextMenu(sourceWindow)
  })

  ipcMain.handle('window:close-panel', () => {
    panelWindow?.hide()
  })

  ipcMain.handle('panel-window:get-state', () => panelWindowState)

  ipcMain.handle('panel-window:set-state', (_event, state) => {
    return updatePanelWindowState(state)
  })

  ipcMain.handle('window:drag-by', (event, delta) => {
    dragWindowBy(event, delta)
  })

  ipcMain.on('window:get-view-kind', (event) => {
    event.returnValue = getViewKind(event)
  })

  ipcMain.handle('runtime-state:get', () => {
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:heartbeat', (_event, payload) => {
    const view = payload?.view === 'panel' ? 'panel' : 'pet'
    updateHeartbeat(view)
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:update', (_event, partialState) => {
    updateRuntimeState(partialState)
  })

  ipcMain.handle('app:get-launch-on-startup', () => {
    return getLaunchOnStartupState()
  })

  ipcMain.handle('app:set-launch-on-startup', (_event, value) => {
    return setLaunchOnStartupState(Boolean(value))
  })

  ipcMain.handle('pet-model:list', async () => {
    return listAvailablePetModels()
  })

  ipcMain.handle('pet-model:import', async () => {
    return importPetModelFromDialog()
  })

  ipcMain.handle('file:save-text', async (event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return saveTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('file:open-text', async (event, payload) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return openTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('tool:web-search', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'web_search', payload)
  })

  ipcMain.handle('tool:get-weather', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'weather_lookup', payload)
  })

  ipcMain.handle('tool:open-external', async (event, payload = {}) => {
    return invokeRegisteredTool(event, 'open_external_link', payload)
  })

  ipcMain.handle('desktop-context:get', async (_event, request = {}) => {
    const contextPolicy = normalizeDesktopContextPolicy(request?.policy)
    const snapshot = {
      capturedAt: new Date().toISOString(),
    }
    const tasks = []

    if (request.includeActiveWindow && contextPolicy.activeWindow) {
      tasks.push(
        captureActiveWindowContext().then((activeWindowSnapshot) => {
          if (activeWindowSnapshot) {
            Object.assign(snapshot, activeWindowSnapshot)
          }
        }),
      )
    }

    if (request.includeClipboard && contextPolicy.clipboard) {
      const clipboardText = clipboard.readText().trim()
      if (clipboardText) {
        snapshot.clipboardText = clipboardText.slice(0, 2_400)
      }
    }

    if (request.includeScreenshot && contextPolicy.screenshot) {
      tasks.push(
        captureScreenshotContext().then((screenSnapshot) => {
          if (screenSnapshot) {
            Object.assign(snapshot, screenSnapshot)
          }
        }),
      )
    }

    if (tasks.length) {
      await Promise.all(tasks)
    }

    return snapshot
  })

  ipcMain.handle('media-session:get', async () => {
    return getSystemMediaSessionSnapshot()
  })

  ipcMain.handle('media-session:control', async (_event, payload = {}) => {
    return controlSystemMediaSession(payload?.action)
  })

  ipcMain.handle('doctor:probe-local-services', async (_event, payload) => {
    if (!Array.isArray(payload) || !payload.length) {
      return []
    }

    return Promise.all(payload.map((target) => probeLocalServiceTarget(target)))
  })

  ipcMain.handle('integrations:inspect', async (_event, payload) => {
    return inspectIntegrationRuntime(payload)
  })
}
