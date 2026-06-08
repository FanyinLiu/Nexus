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
    // Default to fixed mode (keeps the scene backdrop) — free mode / no-backdrop
    // roaming is opt-in via the settings toggle or the right-click menu, not the
    // out-of-box default. Users who explicitly chose free mode keep it (saved in
    // pet-prefs.json); only the unset default changed.
    freeMode: getSavedPetPref('freeMode') ?? false,
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

// Toggle free mode through the locomotion controller (not a raw state patch),
// so it persists to pet-prefs.json and resets locomotion exactly the way the
// right-click context-menu toggle does. Used by the settings-page toggle.
export function setPetFreeModeForEvent(event, freeMode) {
  const inst = petInstanceForEvent(event) ?? mainPetInstance()
  if (!inst) return null
  inst.loco.setFreeMode(Boolean(freeMode))
  return inst.state
}
