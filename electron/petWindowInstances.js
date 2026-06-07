import { BrowserWindow } from 'electron'
import { createPetLocomotion } from './petLocomotion.js'
import { getSavedPetPref, savePetPref } from './services/petPrefsStore.js'
import { sanitizePetWindowStatePatch } from './windowStateSanitizers.js'

const petInstances = new Map()

let getMainWindow = () => null
let getPanelWindow = () => null
let alwaysOnTopLevel = 'floating'

export function configurePetWindowInstances({
  getMainWindow: nextGetMainWindow,
  getPanelWindow: nextGetPanelWindow,
  alwaysOnTopLevel: nextAlwaysOnTopLevel,
} = {}) {
  if (typeof nextGetMainWindow === 'function') getMainWindow = nextGetMainWindow
  if (typeof nextGetPanelWindow === 'function') getPanelWindow = nextGetPanelWindow
  if (typeof nextAlwaysOnTopLevel === 'string') alwaysOnTopLevel = nextAlwaysOnTopLevel
}

export function makePetWindowState() {
  return {
    isPinned: true,
    clickThrough: false,
    petHotspotActive: false,
    locomotionActivity: 'idle',
    freeMode: getSavedPetPref('freeMode') ?? true,
    roamCapable: true,
  }
}

export function registerPetInstance(win) {
  const id = win.webContents.id
  const inst = { id, win, state: makePetWindowState(), loco: null }
  inst.loco = createPetLocomotion({
    getWin: () => inst.win,
    getState: () => inst.state,
    patchState: (patch) => {
      inst.state = { ...inst.state, ...patch }
      if ('freeMode' in patch) savePetPref('freeMode', patch.freeMode)
      syncPetInstance(inst)
    },
  })
  petInstances.set(id, inst)
  return inst
}

export function destroyPetInstance(inst) {
  if (!inst) return
  inst.loco.stop()
  petInstances.delete(inst.id)
}

export function getPetInstanceCount() {
  return petInstances.size
}

export function getPetInstanceForWindow(win) {
  if (!win || win.isDestroyed()) return null
  return petInstances.get(win.webContents.id) ?? null
}

export function petInstanceForEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  return getPetInstanceForWindow(win)
}

export function syncPetInstance(inst) {
  if (inst.win && !inst.win.isDestroyed()) {
    inst.win.webContents.send('pet-window:state-changed', inst.state)
  }
  const mainWindow = getMainWindow()
  const panelWindow = getPanelWindow()
  if (inst.win === mainWindow && panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('pet-window:state-changed', inst.state)
  }
}

export function syncPetWindowInstances() {
  for (const inst of petInstances.values()) syncPetInstance(inst)
}

export function applyPetInstance(inst) {
  const { win, state } = inst
  if (!win || win.isDestroyed()) return
  win.setAlwaysOnTop(Boolean(state.isPinned), alwaysOnTopLevel)
  win.setIgnoreMouseEvents(
    Boolean(state.clickThrough) && !Boolean(state.petHotspotActive),
    { forward: true },
  )
}

export function applyPetWindowInstances() {
  for (const inst of petInstances.values()) applyPetInstance(inst)
}

export function getPetWindowStateForEvent(event) {
  const inst = petInstanceForEvent(event)
  return inst ? inst.state : makePetWindowState()
}

export function updatePetWindowStateForEvent(event, partialState = {}) {
  const inst = petInstanceForEvent(event)
  if (!inst) return null
  const safe = sanitizePetWindowStatePatch(partialState)
  inst.state = { ...inst.state, ...safe }
  applyPetInstance(inst)
  syncPetInstance(inst)
  return inst.state
}
