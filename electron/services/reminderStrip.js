// @ts-check
/**
 * Reminder strip: one small, frameless, non-focus-stealing window that shows
 * a due reminder next to the desktop pet with Done / Later / Open actions.
 *
 * Least privilege by construction:
 * - the strip loads a static page from electron/reminderStrip/ with its own
 *   two-method preload; it never gets the desktopPet bridge;
 * - its two IPC channels live on the strip webContents only
 *   (`webContents.ipc`), so no other window can call them;
 * - it opens no links and allows no navigation.
 *
 * The main process owns the queue and the snooze timers; the page only
 * renders the head of the queue and reports clicks.
 */

import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainWindow } from '../windowManager.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { focusCompanionPanel } from './proactiveNotification.js'
import {
  REMINDER_STRIP_HEIGHT,
  REMINDER_STRIP_SNOOZE_MS,
  REMINDER_STRIP_WIDTH,
  computeReminderStripPosition,
  enqueueReminderStripItem,
  normalizeReminderStripAction,
  normalizeReminderStripPayload,
  removeReminderStripItem,
} from './reminderStripQueue.js'

/** @typedef {import('./reminderStripQueue.js').ReminderStripItem} ReminderStripItem */

const STRIP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reminderStrip')
const STRIP_PAGE = path.join(STRIP_DIR, 'index.html')
const STRIP_PRELOAD = path.join(STRIP_DIR, 'preload.js')

/** @type {BrowserWindow | null} */
let stripWindow = null
/** @type {ReminderStripItem[]} */
let queue = []
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const snoozeTimers = new Map()

/** @returns {BrowserWindow | null} */
function liveStripWindow() {
  return stripWindow && !stripWindow.isDestroyed() ? stripWindow : null
}

/**
 * True when the IPC sender is the strip itself, so the strip can never
 * enqueue reminders through the shared bridge channel.
 * @param {unknown} contents
 */
export function isReminderStripContents(contents) {
  const win = liveStripWindow()
  return !!win && contents === win.webContents
}

function snapshot() {
  return { items: queue.map(({ id, title, body, labels }) => ({ id, title, body, labels })) }
}

function petAnchorBounds() {
  const pet = mainWindow
  if (!pet || pet.isDestroyed() || !pet.isVisible()) return null
  return pet.getBounds()
}

function placeStripWindow() {
  const win = liveStripWindow()
  if (!win) return
  const anchor = petAnchorBounds()
  const display = anchor
    ? screen.getDisplayMatching(anchor)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y } = computeReminderStripPosition({ workArea: display.workArea, anchor })
  win.setBounds({ x, y, width: REMINDER_STRIP_WIDTH, height: REMINDER_STRIP_HEIGHT })
}

function pushQueue() {
  const win = liveStripWindow()
  if (!win) return
  if (!queue.length) {
    win.hide()
    return
  }
  win.webContents.send('reminder-strip:items', snapshot())
  if (!win.isVisible()) {
    placeStripWindow()
    win.showInactive()
  }
}

/**
 * @param {unknown} payload
 */
function handleStripAction(payload) {
  const request = normalizeReminderStripAction(payload)
  if (!request) return { ok: false }
  const { items, removed } = removeReminderStripItem(queue, request.id)
  queue = items
  if (removed && request.action === 'snooze') {
    const existing = snoozeTimers.get(removed.id)
    if (existing) clearTimeout(existing)
    snoozeTimers.set(removed.id, setTimeout(() => {
      snoozeTimers.delete(removed.id)
      enqueueAndShow(removed)
    }, REMINDER_STRIP_SNOOZE_MS))
  }
  if (removed && request.action === 'open') {
    focusCompanionPanel()
  }
  pushQueue()
  return { ok: !!removed }
}

function createStripWindow() {
  const win = new BrowserWindow({
    width: REMINDER_STRIP_WIDTH,
    height: REMINDER_STRIP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: STRIP_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.ipc.handle('reminder-strip:ready', () => snapshot())
  win.webContents.ipc.handle('reminder-strip:action', (_event, payload) => handleStripAction(payload))

  win.once('ready-to-show', () => pushQueue())
  win.on('closed', () => {
    if (stripWindow === win) stripWindow = null
  })

  win.loadFile(STRIP_PAGE).catch((error) => {
    console.warn('[reminder-strip] page failed to load:', getRedactedErrorMessage(error))
  })
  return win
}

/**
 * @param {ReminderStripItem} item
 */
function enqueueAndShow(item) {
  queue = enqueueReminderStripItem(queue, item)
  const existing = liveStripWindow()
  if (!existing) {
    // ready-to-show pushes the queue once the page is up.
    stripWindow = createStripWindow()
    placeStripWindow()
    return
  }
  pushQueue()
}

/**
 * Queue a due reminder on the strip. Returns false when the payload carries
 * nothing to show.
 * @param {unknown} payload
 * @returns {boolean}
 */
export function showReminderStrip(payload) {
  const item = normalizeReminderStripPayload(payload)
  if (!item) return false
  const pendingSnooze = snoozeTimers.get(item.id)
  if (pendingSnooze) {
    clearTimeout(pendingSnooze)
    snoozeTimers.delete(item.id)
  }
  enqueueAndShow(item)
  return true
}

export function destroyReminderStrip() {
  for (const timer of snoozeTimers.values()) clearTimeout(timer)
  snoozeTimers.clear()
  queue = []
  const win = liveStripWindow()
  stripWindow = null
  if (win) win.destroy()
}
