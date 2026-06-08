import { BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import {
  mainWindow,
  panelWindow,
  getPetWindowStateForEvent,
  panelWindowState,
  buildRuntimeStateSnapshot,
  updateHeartbeat,
  updateRuntimeState,
  updatePetWindowStateForEvent,
  setPetFreeModeForEvent,
  updatePanelWindowState,
  showPanelWindow,
  showPetContextMenu,
  getLaunchOnStartupState,
  setLaunchOnStartupState,
  dragWindowBy,
  getViewKind,
  probeLocalServiceTarget,
  getPlatformProfile,
} from '../windowManager.js'
import {
  listAvailablePetModels,
  importPetModelFromDialog,
  importSpritePetModelFromCodexGallery,
  listCodexPetGalleryCatalog,
  createSpritePetCreatorKitFromPayload,
  inspectSpritePetCreatorKitFromDialog,
  assembleSpritePetCreatorKitFromDialog,
  installSpritePetCreatorKitPackageToCodex,
  openSpritePetCreatorKitPathFromPayload,
  createSpritePetModelFromImageDialog,
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
import { requireTrustedSender } from './validate.js'
import {
  validateDesktopContextRequestPayload,
  validateExternalLinkToolPayload,
  validateMediaSessionControlPayload,
  validateOpenPanelPayload,
  validatePanelWindowStatePayload,
  validatePetWindowStatePayload,
  validateRuntimeHeartbeatPayload,
  validateRuntimeStateUpdatePayload,
  validateWeatherToolPayload,
  validateWebSearchToolPayload,
  validateWindowDragPayload,
} from './payloadSchemas.js'

const POWER_EVENT_CHANNEL = 'app:power-event'
const POWER_EVENT_KINDS = ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'shutdown']
let powerEventForwardingRegistered = false

function broadcastPowerEvent(kind) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed?.()) continue
    win.webContents.send(POWER_EVENT_CHANNEL, { kind })
  }
}

function registerPowerEventForwarding() {
  if (powerEventForwardingRegistered) return
  powerEventForwardingRegistered = true
  for (const kind of POWER_EVENT_KINDS) {
    powerMonitor.on(kind, () => {
      broadcastPowerEvent(kind)
    })
  }
}

export function register() {
  registerPowerEventForwarding()

  ipcMain.handle('pet-window:get-state', (event) => {
    requireTrustedSender(event)
    return getPetWindowStateForEvent(event)
  })

  ipcMain.handle('pet-window:update-state', (event, state) => {
    requireTrustedSender(event)
    state = validatePetWindowStatePayload(state)
    return updatePetWindowStateForEvent(event, state)
  })

  ipcMain.handle('pet-window:set-free-mode', (event, payload) => {
    requireTrustedSender(event)
    return setPetFreeModeForEvent(event, Boolean(payload?.freeMode))
  })

  ipcMain.handle('window:open-panel', (event, section) => {
    requireTrustedSender(event)
    section = validateOpenPanelPayload(section)
    showPanelWindow(section)
  })

  ipcMain.handle('window:open-pet-menu', (event) => {
    requireTrustedSender(event)
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    showPetContextMenu(sourceWindow)
  })

  ipcMain.handle('window:close-panel', (event) => {
    requireTrustedSender(event)
    panelWindow?.hide()
  })

  ipcMain.handle('panel-window:get-state', (event) => {
    requireTrustedSender(event)
    return panelWindowState
  })

  ipcMain.handle('panel-window:set-state', (event, state) => {
    requireTrustedSender(event)
    state = validatePanelWindowStatePayload(state)
    return updatePanelWindowState(state)
  })

  ipcMain.handle('window:drag-by', (event, delta) => {
    requireTrustedSender(event)
    delta = validateWindowDragPayload(delta)
    dragWindowBy(event, delta)
  })

  ipcMain.handle('window:get-view-kind', (event) => {
    requireTrustedSender(event)
    return getViewKind(event)
  })

  ipcMain.handle('runtime-state:get', (event) => {
    requireTrustedSender(event)
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:heartbeat', (event, payload) => {
    requireTrustedSender(event)
    payload = validateRuntimeHeartbeatPayload(payload)
    const view = payload.view
    // Pass the sender's webContents id so syncRuntimeState skips rebroadcasting
    // to this exact window — origin already has the new state and bouncing it
    // back to React causes the self-feeding render loop (see windowManager
    // syncRuntimeState comment).
    updateHeartbeat(view, event.sender.id)
    return buildRuntimeStateSnapshot()
  })

  ipcMain.handle('runtime-state:update', (event, partialState) => {
    requireTrustedSender(event)
    partialState = validateRuntimeStateUpdatePayload(partialState)
    updateRuntimeState(partialState, event.sender.id)
  })

  ipcMain.handle('app:get-launch-on-startup', (event) => {
    requireTrustedSender(event)
    return getLaunchOnStartupState()
  })

  ipcMain.handle('app:set-launch-on-startup', (event, value) => {
    requireTrustedSender(event)
    return setLaunchOnStartupState(Boolean(value))
  })

  ipcMain.handle('app:get-platform-profile', (event) => {
    requireTrustedSender(event)
    return getPlatformProfile()
  })

  ipcMain.handle('app:get-system-idle-time', (event) => {
    requireTrustedSender(event)
    return Math.max(0, powerMonitor.getSystemIdleTime())
  })

  ipcMain.handle('pet-model:list', async (event) => {
    requireTrustedSender(event)
    return listAvailablePetModels()
  })

  ipcMain.handle('pet-model:import', async (event) => {
    requireTrustedSender(event)
    return importPetModelFromDialog()
  })

  ipcMain.handle('pet-model:import-codex-gallery', async (event, input) => {
    requireTrustedSender(event)
    return importSpritePetModelFromCodexGallery(input)
  })

  ipcMain.handle('pet-model:list-codex-gallery', async (event, payload = {}) => {
    requireTrustedSender(event)
    return listCodexPetGalleryCatalog(payload)
  })

  ipcMain.handle('pet-model:create-creator-kit', async (event, payload = {}) => {
    requireTrustedSender(event)
    return createSpritePetCreatorKitFromPayload(payload)
  })

  ipcMain.handle('pet-model:inspect-creator-kit', async (event, payload = {}) => {
    requireTrustedSender(event)
    return inspectSpritePetCreatorKitFromDialog(payload)
  })

  ipcMain.handle('pet-model:assemble-creator-kit', async (event, payload = {}) => {
    requireTrustedSender(event)
    return assembleSpritePetCreatorKitFromDialog(payload)
  })

  ipcMain.handle('pet-model:install-creator-kit-codex', async (event, payload = {}) => {
    requireTrustedSender(event)
    return installSpritePetCreatorKitPackageToCodex(payload)
  })

  ipcMain.handle('pet-model:open-creator-kit-path', async (event, payload = {}) => {
    requireTrustedSender(event)
    return openSpritePetCreatorKitPathFromPayload(payload)
  })

  ipcMain.handle('pet-model:create-from-image', async (event) => {
    requireTrustedSender(event)
    return createSpritePetModelFromImageDialog()
  })

  ipcMain.handle('dialog:confirm', async (event, message) => {
    requireTrustedSender(event)
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    const { response } = await dialog.showMessageBox(parentWindow, {
      type: 'question',
      buttons: ['确定', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: String(message ?? ''),
    })
    return response === 0
  })

  ipcMain.handle('file:save-text', async (event, payload) => {
    requireTrustedSender(event)
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return saveTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('file:open-text', async (event, payload) => {
    requireTrustedSender(event)
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? panelWindow ?? mainWindow ?? undefined
    return openTextFileFromDialog(sourceWindow, payload)
  })

  ipcMain.handle('tool:web-search', async (event, payload = {}) => {
    requireTrustedSender(event)
    payload = validateWebSearchToolPayload(payload)
    return invokeRegisteredTool(event, 'web_search', payload)
  })

  ipcMain.handle('tool:get-weather', async (event, payload = {}) => {
    requireTrustedSender(event)
    payload = validateWeatherToolPayload(payload)
    if (payload.quiet) {
      try {
        return await invokeRegisteredTool(event, 'weather_lookup', payload)
      } catch {
        return null
      }
    }
    return invokeRegisteredTool(event, 'weather_lookup', payload)
  })

  ipcMain.handle('tool:open-external', async (event, payload = {}) => {
    requireTrustedSender(event)
    payload = validateExternalLinkToolPayload(payload)
    return invokeRegisteredTool(event, 'open_external_link', payload)
  })

  ipcMain.handle('desktop-context:get', async (event, request = {}) => {
    requireTrustedSender(event)
    request = validateDesktopContextRequestPayload(request)
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

  ipcMain.handle('media-session:get', async (event) => {
    requireTrustedSender(event)
    return getSystemMediaSessionSnapshot()
  })

  ipcMain.handle('media-session:control', async (event, payload = {}) => {
    requireTrustedSender(event)
    payload = validateMediaSessionControlPayload(payload)
    return controlSystemMediaSession(payload.action)
  })

  ipcMain.handle('doctor:probe-local-services', async (event, payload) => {
    requireTrustedSender(event)
    if (!Array.isArray(payload) || !payload.length) {
      return []
    }

    // Cap input size — legit doctor panel probes ≤8 ports; anything larger
    // looks like a port-scan loop. Combined with the host allowlist in
    // normalizeLocalServiceProbeTarget, this closes the H8 SSRF vector.
    const targets = payload.slice(0, 16)
    return Promise.all(targets.map((target) => probeLocalServiceTarget(target)))
  })

  ipcMain.handle('integrations:inspect', async (event, payload) => {
    requireTrustedSender(event)
    return inspectIntegrationRuntime(payload)
  })
}
