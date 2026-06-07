import { screen } from 'electron'
import { clampWindowPosition, getPanelWindowPosition } from './windowManagerHelpers.js'
import { getSavedBounds } from './services/windowBoundsStore.js'
import { sanitizePanelWindowStatePatch } from './windowStateSanitizers.js'

export const PANEL_WINDOW_DEFAULT_WIDTH = 460
export const PANEL_WINDOW_DEFAULT_HEIGHT = 660
export const PANEL_WINDOW_MIN_WIDTH = 400
export const PANEL_WINDOW_MIN_HEIGHT = 540
export const PANEL_WINDOW_COLLAPSED_WIDTH = 380
export const PANEL_WINDOW_COLLAPSED_HEIGHT = 92

export let panelWindowState = {
  collapsed: false,
}

let panelWindowExpandedBounds = null
let getMainWindow = () => null
let getPanelWindow = () => null

export function configurePanelWindowController({
  getMainWindow: nextGetMainWindow,
  getPanelWindow: nextGetPanelWindow,
} = {}) {
  if (typeof nextGetMainWindow === 'function') getMainWindow = nextGetMainWindow
  if (typeof nextGetPanelWindow === 'function') getPanelWindow = nextGetPanelWindow
}

export function isPanelWindowTrackable() {
  return !panelWindowState.collapsed
}

export function getPanelWindowCreationState() {
  const ownerBounds = getMainWindow()?.getBounds()
  const savedPanel = panelWindowState.collapsed ? null : getSavedBounds('panel')
  const width = panelWindowState.collapsed
    ? PANEL_WINDOW_COLLAPSED_WIDTH
    : (savedPanel?.width ?? PANEL_WINDOW_DEFAULT_WIDTH)
  const height = panelWindowState.collapsed
    ? PANEL_WINDOW_COLLAPSED_HEIGHT
    : (savedPanel?.height ?? PANEL_WINDOW_DEFAULT_HEIGHT)
  const { workArea } = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay()
  const { x, y } = panelWindowState.collapsed
    ? clampWindowPosition(
        width,
        height,
        (panelWindowExpandedBounds?.x ?? ownerBounds?.x ?? workArea.x + workArea.width - width - 72),
        (panelWindowExpandedBounds?.y ?? ownerBounds?.y ?? workArea.y + 72)
          + Math.max((panelWindowExpandedBounds?.height ?? height) - height, 0),
        workArea,
      )
    : savedPanel
      ? clampWindowPosition(width, height, savedPanel.x, savedPanel.y, workArea)
      : getPanelWindowPosition(width, height, ownerBounds, workArea)

  return {
    width,
    height,
    x,
    y,
    resizable: !panelWindowState.collapsed,
    minWidth: panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_WIDTH : PANEL_WINDOW_MIN_WIDTH,
    minHeight: panelWindowState.collapsed ? PANEL_WINDOW_COLLAPSED_HEIGHT : PANEL_WINDOW_MIN_HEIGHT,
  }
}

export function rememberPanelWindowBounds() {
  const panelWindow = getPanelWindow()
  if (!panelWindow || panelWindow.isDestroyed() || panelWindowState.collapsed) return
  panelWindowExpandedBounds = panelWindow.getBounds()
}

export function emitPanelWindowState() {
  const panelWindow = getPanelWindow()
  if (!panelWindow || panelWindow.isDestroyed()) return
  panelWindow.webContents.send('panel-window:state-changed', panelWindowState)
}

function getExpandedPanelBounds() {
  if (panelWindowExpandedBounds) {
    return {
      width: Math.max(panelWindowExpandedBounds.width, PANEL_WINDOW_MIN_WIDTH),
      height: Math.max(panelWindowExpandedBounds.height, PANEL_WINDOW_MIN_HEIGHT),
      x: panelWindowExpandedBounds.x,
      y: panelWindowExpandedBounds.y,
    }
  }

  const ownerBounds = getMainWindow()?.getBounds()
  const { workArea } = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay()
  const position = getPanelWindowPosition(
    PANEL_WINDOW_DEFAULT_WIDTH,
    PANEL_WINDOW_DEFAULT_HEIGHT,
    ownerBounds,
    workArea,
  )

  return {
    width: PANEL_WINDOW_DEFAULT_WIDTH,
    height: PANEL_WINDOW_DEFAULT_HEIGHT,
    x: position.x,
    y: position.y,
  }
}

export function updatePanelWindowState(partialState = {}) {
  const safe = sanitizePanelWindowStatePatch(partialState)
  panelWindowState = {
    ...panelWindowState,
    ...safe,
  }

  const panelWindow = getPanelWindow()
  if (!panelWindow || panelWindow.isDestroyed()) {
    return panelWindowState
  }

  if (panelWindowState.collapsed) {
    panelWindowExpandedBounds = panelWindow.getBounds()
    const currentBounds = panelWindow.getBounds()
    const { workArea } = screen.getDisplayMatching(currentBounds)
    const nextPosition = clampWindowPosition(
      PANEL_WINDOW_COLLAPSED_WIDTH,
      PANEL_WINDOW_COLLAPSED_HEIGHT,
      currentBounds.x,
      currentBounds.y + Math.max(currentBounds.height - PANEL_WINDOW_COLLAPSED_HEIGHT, 0),
      workArea,
    )

    panelWindow.setResizable(false)
    panelWindow.setMinimumSize(PANEL_WINDOW_COLLAPSED_WIDTH, PANEL_WINDOW_COLLAPSED_HEIGHT)
    panelWindow.setBounds({
      x: nextPosition.x,
      y: nextPosition.y,
      width: PANEL_WINDOW_COLLAPSED_WIDTH,
      height: PANEL_WINDOW_COLLAPSED_HEIGHT,
    }, true)
  } else {
    const expandedBounds = getExpandedPanelBounds()
    const { workArea } = screen.getDisplayMatching(expandedBounds)
    const nextPosition = clampWindowPosition(
      expandedBounds.width,
      expandedBounds.height,
      expandedBounds.x,
      expandedBounds.y,
      workArea,
    )

    panelWindow.setResizable(true)
    panelWindow.setMinimumSize(PANEL_WINDOW_MIN_WIDTH, PANEL_WINDOW_MIN_HEIGHT)
    panelWindow.setBounds({
      x: nextPosition.x,
      y: nextPosition.y,
      width: expandedBounds.width,
      height: expandedBounds.height,
    }, true)
  }

  emitPanelWindowState()
  return panelWindowState
}
