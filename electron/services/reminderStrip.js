// @ts-check
/**
 * Reminder strip: one small, frameless, non-focus-stealing window that shows
 * a due reminder next to the desktop pet with Done / Later / Open actions.
 *
 * Least privilege by construction:
 * - the strip loads a static page from electron/reminderStrip/ with its own
 *   three-method preload; it never gets the desktopPet bridge;
 * - its two IPC channels live on the strip webContents only
 *   (`webContents.ipc`), so no other window can call them;
 * - it opens no links and allows no navigation.
 *
 * The queue and the snooze timers live in reminderStripSession.js; this module
 * only owns the BrowserWindow, its placement and the IPC wiring. The router's
 * strip outlet calls showReminderStrip in-process, so no renderer round trip
 * is involved.
 */

import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mainWindow } from '../windowManager.js'
import { createLogger } from '../logger.js'
import { focusCompanionPanel } from './proactiveNotification.js'
import {
  REMINDER_STRIP_HEIGHT,
  REMINDER_STRIP_SNOOZE_MS,
  REMINDER_STRIP_WIDTH,
  computeReminderStripPosition,
} from './reminderStripQueue.js'
import { createReminderStripSession } from './reminderStripSession.js'

/** @typedef {import('./reminderStripQueue.js').ReminderStripLabels} ReminderStripLabels */
/** @typedef {import('./reminderStripQueue.js').ReminderStripItem} ReminderStripItem */

const log = createLogger('reminders.strip')

const STRIP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reminderStrip')
const STRIP_PAGE = path.join(STRIP_DIR, 'index.html')
const STRIP_PRELOAD = path.join(STRIP_DIR, 'preload.js')

/** @type {BrowserWindow | null} */
let stripWindow = null
/** @type {ReturnType<typeof createReminderStripSession> | null} */
let session = null

/**
 * Inbox side effects supplied by the proactive IPC wiring. The defaults keep
 * the strip usable in unit tests that never configure an inbox.
 * @type {{ onAction: (action: string, id: string) => void, isPending: (id: string) => boolean }}
 */
let actionDeps = {
  onAction: () => {},
  isPending: () => true,
}

/** @returns {BrowserWindow | null} */
function liveStripWindow() {
  return stripWindow && !stripWindow.isDestroyed() ? stripWindow : null
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
  if (!win || !session) return
  const current = session.snapshot()
  if (!current.items.length) {
    win.hide()
    return
  }
  win.webContents.send('reminder-strip:items', current)
  if (!win.isVisible()) {
    placeStripWindow()
    win.showInactive()
  }
}

/**
 * Queue changes either create the window (first item) or refresh it.
 * @param {{ items: ReminderStripItem[] }} snapshot
 */
function handleQueueChange(snapshot) {
  if (!snapshot.items.length) {
    liveStripWindow()?.hide()
    return
  }
  if (!liveStripWindow()) {
    // ready-to-show pushes the current queue once the page is up.
    createStripWindow()
    return
  }
  pushQueue()
}

function ensureSession() {
  if (session) return session
  session = createReminderStripSession({
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
    snoozeMs: REMINDER_STRIP_SNOOZE_MS,
    onQueueChange: handleQueueChange,
    onAction: (action, item) => {
      // Opening the panel is a strip-only concern; everything else (inbox
      // status changes) is owned by the proactive IPC wiring.
      if (action === 'open') {
        focusCompanionPanel()
        return
      }
      actionDeps.onAction(action, item.id)
    },
    isPending: (id) => actionDeps.isPending(id),
  })
  return session
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
  win.webContents.ipc.handle('reminder-strip:ready', () => {
    try {
      return ensureSession().snapshot()
    } catch {
      // The page must still render empty rather than break its startup.
      log.warn('reminder strip ready failed', { status: 'ready-failed' })
      return { items: [] }
    }
  })
  win.webContents.ipc.handle('reminder-strip:action', (_event, payload) => {
    try {
      return ensureSession().handleAction(payload)
    } catch {
      log.warn('reminder strip action failed', { status: 'action-failed' })
      return { ok: false }
    }
  })

  win.once('ready-to-show', () => pushQueue())
  win.on('closed', () => {
    if (stripWindow === win) stripWindow = null
  })

  win.loadFile(STRIP_PAGE).catch(() => {
    log.warn('reminder strip page failed to load', { status: 'load-failed' })
  })
  stripWindow = win
  return win
}

/**
 * Wire the inbox side effects the session needs. Called once by the proactive
 * IPC factory; keeping it injected keeps this module and the session testable.
 * @param {{
 *   onAction?: (action: string, id: string) => void,
 *   isPending?: (id: string) => boolean,
 * }} dependencies
 */
export function configureReminderStrip(dependencies) {
  actionDeps = {
    onAction: typeof dependencies.onAction === 'function' ? dependencies.onAction : () => {},
    isPending: typeof dependencies.isPending === 'function' ? dependencies.isPending : () => true,
  }
}

/**
 * Queue a due reminder on the strip. Returns false when the payload carries
 * nothing to show.
 * @param {{ id: string, title: string, body: string, labels: ReminderStripLabels }} payload
 * @returns {boolean}
 */
export function showReminderStrip(payload) {
  return ensureSession().show(payload)
}

/**
 * Remove one id from the queue and cancel its snooze timer.
 * @param {string} id
 * @returns {boolean}
 */
export function withdrawReminderStripItem(id) {
  return session?.withdraw(id) ?? false
}

/** Clear-all: drop every queued reminder and every pending snooze timer. */
export function withdrawAllReminderStripItems() {
  session?.withdrawAll()
}

export function destroyReminderStrip() {
  session?.destroy()
  session = null
  const win = liveStripWindow()
  stripWindow = null
  if (win) win.destroy()
}
