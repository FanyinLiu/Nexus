// @ts-check
/**
 * IPC surface for proactive delivery and the inbox.
 *
 * `proactive:deliver` routes a message and always writes the inbox. Outlets
 * decide what else happens: `badge` refreshes the red dot, `bubble` pushes a
 * presentation to the pet, `strip` queues the reminder on the strip window in
 * this process, and `os_notification` raises a native notification.
 *
 * `inbox:changed` is a metadata push only: the unread count, the ids/statuses
 * that changed, and the ids that were removed. It goes only to the windows
 * that consume the badge (today the pet window, by creation-time capability),
 * and never carries a title, body or speech. A window that needs the content
 * reads it through `inbox:list`. Content stays out of logs for the same
 * reason: log lines carry only ids, actions, outlet ids and stable error codes.
 *
 * The wiring lives in `createProactiveIpc` so it can be tested with fake IPC,
 * windows, strip and notification dependencies; `register()` only adapts
 * Electron into that bag.
 */

import path from 'node:path'

import { createLogger } from '../logger.js'
import { createProactiveInboxStore, PROACTIVE_INBOX_FILE_NAME } from '../services/proactiveInboxStore.js'
import { createProactiveOutletRegistry, createProactiveRouter } from '../services/proactiveRouter.js'
import { buildReminderStripLabels } from '../reminderStripLabels.js'
import { getBoundWindowCapability } from './windowCapabilities.js'
import {
  validateInboxUpdatePayload,
  validateProactiveDeliveryPayload,
} from './proactivePayloadSchemas.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxChange} ProactiveInboxChange */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactivePresentation} ProactivePresentation */
/** @typedef {import('../services/proactiveInboxStore.js').InboxMutation} InboxMutation */
/** @typedef {import('../services/reminderStripQueue.js').ReminderStripLabels} ReminderStripLabels */
/** @typedef {import('../logger.js').Logger} Logger */

/** Low-frequency retention sweep; the badge must refresh without user action. */
const PROACTIVE_INBOX_PRUNE_INTERVAL_MS = 60 * 60 * 1000

/**
 * Windows that render the unread badge today. One explicit list keeps the
 * targeting reviewable: a later milestone adds its window here on purpose
 * instead of every renderer silently receiving inbox metadata.
 * @type {ReadonlyArray<'pet' | 'panel'>}
 */
const INBOX_CHANGE_CONSUMERS = Object.freeze(['pet'])

/** @typedef {object} ProactiveIpcWebContents
 * @property {() => boolean} isDestroyed
 * @property {(channel: string, payload: unknown) => void} send
 */

/** @typedef {object} ProactiveIpcWindow
 * @property {() => boolean} isDestroyed
 * @property {ProactiveIpcWebContents} webContents
 */

/** @typedef {(callback: () => void, ms: number) => { unref?: () => void }} IntervalScheduler */
/** @typedef {(handle: { unref?: () => void }) => void} IntervalClearer */

/**
 * The reminder strip is wired in-process: the router's strip outlet calls this
 * bag directly instead of pushing a presentation to a renderer.
 *
 * @typedef {object} ProactiveStripDependencies
 * @property {(payload: { id: string, title: string, body: string, labels: ReminderStripLabels }) => unknown} show
 * @property {(id: string) => unknown} withdraw
 * @property {() => unknown} withdrawAll
 * @property {(dependencies: {
 *   onAction: (action: string, id: string) => void,
 *   isPending: (id: string) => boolean,
 * }) => void} [configure]
 */

/**
 * Everything the wiring needs from Electron and the host. An explicit bag
 * keeps the module importable under node:test without a live Electron app.
 *
 * @typedef {object} ProactiveIpcDependencies
 * @property {{ handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => void }} ipcMain
 * @property {() => ProactiveIpcWindow[]} getAllWindows
 * @property {(webContents: object | null | undefined) => 'panel' | 'pet' | 'unknown'} getWindowCapability
 * @property {(event: unknown) => void} requireTrustedSender
 * @property {ReturnType<typeof createProactiveInboxStore>} inbox
 * @property {Logger} logger
 * @property {IntervalScheduler} setInterval
 * @property {IntervalClearer} clearInterval
 * @property {ProactiveStripDependencies} strip
 * @property {() => ReminderStripLabels} getStripLabels
 * @property {(payload: { title: string, body: string }) => unknown} showOsNotification
 * @property {() => boolean} isPanelFocused
 */

/**
 * @param {ProactiveIpcDependencies} dependencies
 */
export function createProactiveIpc({
  ipcMain,
  getAllWindows,
  getWindowCapability,
  requireTrustedSender,
  inbox,
  logger,
  setInterval,
  clearInterval,
  strip,
  getStripLabels,
  showOsNotification,
  isPanelFocused,
}) {
  /** @type {{ unref?: () => void } | null} */
  let pruneTimer = null

  /**
   * @param {string} channel
   * @param {unknown} payload
   * @param {ReadonlyArray<'panel' | 'pet' | 'unknown'>} capabilities
   */
  function sendToWindows(channel, payload, capabilities) {
    for (const win of getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      if (!capabilities.includes(getWindowCapability(win.webContents))) continue
      win.webContents.send(channel, payload)
    }
  }

  /**
   * Presentation events only belong to the pet window. The capability is
   * bound when the window is created, so a rewritten `?view=` cannot receive
   * them.
   * @param {ProactivePresentation} presentation
   */
  function presentToPet(presentation) {
    sendToWindows('proactive:present', presentation, ['pet'])
  }

  /** @param {InboxMutation} mutation */
  function publishInboxChange(mutation) {
    /** @type {ProactiveInboxChange} */
    const change = {
      unreadCount: mutation.unreadCount,
      changes: mutation.entries.map((entry) => ({ id: entry.id, status: entry.status })),
      removedIds: mutation.removedIds,
    }
    sendToWindows('inbox:changed', change, INBOX_CHANGE_CONSUMERS)
  }

  /**
   * Publish the metadata push and keep the strip in step with removals.
   * @param {InboxMutation} mutation
   */
  function announceMutation(mutation) {
    if (mutation.changed) publishInboxChange(mutation)
    for (const id of mutation.removedIds) strip.withdraw(id)
  }

  /** @param {string} id */
  function isInboxEntryPending(id) {
    return inbox.list().entries.some((entry) => entry.id === id && entry.status === 'unread')
  }

  /**
   * Strip-side action hand-off. `open` is handled by the strip module itself;
   * `done` is the only action that changes the inbox.
   * @param {string} action
   * @param {string} id
   */
  function handleStripAction(action, id) {
    if (action !== 'done') return
    const mutation = inbox.setStatus(id, 'done')
    announceMutation(mutation)
  }

  strip.configure?.({
    onAction: handleStripAction,
    isPending: isInboxEntryPending,
  })

  const outlets = createProactiveOutletRegistry({ logger })

  outlets.register('inbox', (message, state) => {
    const mutation = inbox.upsert(message)
    state.unreadCount = mutation.unreadCount
    state.entries = mutation.entries
    state.removedIds = mutation.removedIds
    state.changed = mutation.changed
    if (mutation.changed) {
      announceMutation(mutation)
      state.published = true
    }
  })

  // The dot reflects the inbox, so a delivery that did not change anything
  // still refreshes the count. Skipped when the inbox write already published.
  outlets.register('badge', (_message, state) => {
    if (state.published) return
    publishInboxChange({
      changed: false,
      entries: [],
      removedIds: [],
      unreadCount: state.unreadCount,
    })
    state.published = true
  })

  outlets.register('bubble', (message) => {
    presentToPet({ outlet: 'bubble', message })
  })

  // The strip window lives in this process, so the outlet queues the reminder
  // directly. The pet never receives a strip presentation and therefore never
  // falls back to a bubble for one.
  outlets.register('strip', (message) => {
    strip.show({
      id: message.id,
      title: message.title,
      body: message.body,
      labels: getStripLabels(),
    })
  })

  outlets.register('os_notification', async (message) => {
    await showOsNotification({ title: message.title, body: message.body })
  })

  const router = createProactiveRouter({ outlets })

  ipcMain.handle('proactive:deliver', async (event, payload) => {
    requireTrustedSender(event)
    const { message, context } = validateProactiveDeliveryPayload(payload)
    // The pet window cannot see whether the panel is focused, so main, which
    // owns every window, adds that one signal before the pure router runs.
    return router.deliver(message, {
      ...context,
      panelFocused: context.panelFocused || isPanelFocused(),
    })
  })

  ipcMain.handle('inbox:list', (event) => {
    requireTrustedSender(event)
    const snapshot = inbox.list()
    if (snapshot.removedIds.length > 0) {
      announceMutation({
        changed: true,
        entries: [],
        removedIds: snapshot.removedIds,
        unreadCount: snapshot.unreadCount,
      })
    }
    return snapshot
  })

  ipcMain.handle('inbox:update', (event, payload) => {
    requireTrustedSender(event)
    const { id, status } = validateInboxUpdatePayload(payload)
    const mutation = inbox.setStatus(id, status)
    if (status === 'done' || status === 'dismissed') strip.withdraw(id)
    announceMutation(mutation)
    return { updated: mutation.changed, unreadCount: mutation.unreadCount }
  })

  function stopPrune() {
    if (!pruneTimer) return
    clearInterval(pruneTimer)
    pruneTimer = null
  }

  function startPrune() {
    stopPrune()
    pruneTimer = setInterval(() => {
      const mutation = inbox.prune()
      announceMutation(mutation)
    }, PROACTIVE_INBOX_PRUNE_INTERVAL_MS)
    // A sweep timer must never be the reason the process stays alive.
    pruneTimer.unref?.()
  }

  /** Land any debounced inbox write before the process quits. */
  function flush() {
    return inbox.flush()
  }

  /**
   * Empty the inbox for clear-all, drop every strip item and snooze timer, and
   * push the zero count so the pet badge disappears even when no `inbox:list`
   * follows.
   * @returns {Promise<boolean>}
   */
  async function clearInbox() {
    const cleared = await inbox.clear()
    strip.withdrawAll()
    publishInboxChange({
      changed: true,
      entries: [],
      removedIds: [],
      unreadCount: 0,
    })
    return cleared
  }

  startPrune()

  return { stopPrune, flush, clearInbox }
}

/** @type {ReturnType<typeof createProactiveIpc> | null} */
let activeIpc = null

/**
 * Electron adapter: build the real store/logger and hand Electron to the
 * factory. The main registry owns the Electron imports so the factory module
 * stays free of a top-level `electron` dependency.
 *
 * @param {{
 *   app: { getPath: (name: string) => string },
 *   ipcMain: ProactiveIpcDependencies['ipcMain'],
 *   getAllWindows: ProactiveIpcDependencies['getAllWindows'],
 *   requireTrustedSender: ProactiveIpcDependencies['requireTrustedSender'],
 *   isPanelFocused: ProactiveIpcDependencies['isPanelFocused'],
 *   strip: ProactiveIpcDependencies['strip'],
 *   showOsNotification: ProactiveIpcDependencies['showOsNotification'],
 * }} dependencies
 */
export function register({
  app,
  ipcMain,
  getAllWindows,
  requireTrustedSender,
  isPanelFocused,
  strip,
  showOsNotification,
}) {
  const logger = createLogger('proactive.router')
  const inbox = createProactiveInboxStore({
    getStorePath: () => path.join(app.getPath('userData'), PROACTIVE_INBOX_FILE_NAME),
    onPersistError: () => {
      // The store never throws on persist failures; one warning is the whole
      // contract, and it deliberately carries no inbox content.
      logger.warn('proactive inbox persist failed', { source: 'inbox' })
    },
  })

  activeIpc = createProactiveIpc({
    ipcMain,
    getAllWindows,
    getWindowCapability: getBoundWindowCapability,
    requireTrustedSender,
    inbox,
    logger,
    setInterval,
    // The bag uses a portable timer handle so tests can inject a fake clock.
    clearInterval: (handle) => clearInterval(/** @type {NodeJS.Timeout} */ (handle)),
    strip,
    getStripLabels: () => buildReminderStripLabels(),
    showOsNotification,
    isPanelFocused,
  })
}

/** Land the active inbox's debounced write before quit. */
export function flushProactiveInbox() {
  return activeIpc?.flush() ?? Promise.resolve(true)
}

/** Stop the periodic retention sweep; called on quit next to the inbox flush. */
export function stopProactiveInboxPrune() {
  activeIpc?.stopPrune()
}

/** Clear the inbox as part of clear-all; returns false when not registered. */
export function clearProactiveInbox() {
  return activeIpc?.clearInbox() ?? Promise.resolve(false)
}
