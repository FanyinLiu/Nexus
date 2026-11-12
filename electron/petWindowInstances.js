// @ts-nocheck
import { BrowserWindow } from 'electron'
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

function makePetWindowState() {
  return {
    isPinned: true,
    clickThrough: false,
    petHotspotActive: false,
  }
}

export function registerPetInstance(win) {
  const id = win.webContents.id
  const inst = { id, win, state: makePetWindowState() }
  petInstances.set(id, inst)
  return inst
}

export function destroyPetInstance(inst) {
  if (!inst) return
  petInstances.delete(inst.id)
}

export function getPetInstanceForWindow(win) {
  if (!win || win.isDestroyed()) return null
  return petInstances.get(win.webContents.id) ?? null
}

function petInstanceForEvent(event) {
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

function applyPetInstance(inst) {
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

// Panel / non-pet windows have no instance of their own, so their state
// reads/writes (e.g. the settings always-on-top / click-through toggles, sent
// from the panel) must target the main pet — otherwise they silently no-op.
function mainPetInstance() {
  const mainWindow = getMainWindow()
  return mainWindow ? getPetInstanceForWindow(mainWindow) : null
}

export function getPetWindowStateForEvent(event) {
  const inst = petInstanceForEvent(event) ?? mainPetInstance()
  return inst ? inst.state : makePetWindowState()
}

export function updatePetWindowStateForEvent(event, partialState = {}) {
  const inst = petInstanceForEvent(event) ?? mainPetInstance()
  if (!inst) return null
  const safe = sanitizePetWindowStatePatch(partialState)
  inst.state = { ...inst.state, ...safe }
  applyPetInstance(inst)
  syncPetInstance(inst)
  return inst.state
}
