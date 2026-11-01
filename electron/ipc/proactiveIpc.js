// @ts-check
/**
 * IPC surface for proactive delivery and the inbox.
 *
 * `proactive:deliver` routes a message and always writes the inbox; outlets
 * decide what else happens (`badge` pushes the unread count, `bubble`/`strip`
 * push one presentation event to the pet). `inbox:list` and `inbox:update`
 * are what the renderer uses for the red dot and status changes.
 *
 * `inbox:changed` is broadcast to trusted app windows and carries the mutated
 * entries (title and body included, because those windows render the inbox),
 * the removed ids and the fresh unread count. A periodic prune publishes the
 * same event when retention removes entries, so the dot never depends on the
 * user triggering an IPC call. Log lines never carry title, body or speech —
 * only message ids, sources, outlet ids and stable error codes.
 *
 * The wiring lives in `createProactiveIpc` so it can be tested with fake IPC
 * and window dependencies; `register()` only adapts Electron into that bag.
 */

import path from 'node:path'

import { createLogger } from '../logger.js'
import { createProactiveInboxStore, PROACTIVE_INBOX_FILE_NAME } from '../services/proactiveInboxStore.js'
import { createProactiveOutletRegistry, createProactiveRouter } from '../services/proactiveRouter.js'
import { getBoundWindowCapability } from './windowCapabilities.js'
import {
  validateInboxUpdatePayload,
  validateProactiveDeliveryPayload,
} from './proactivePayloadSchemas.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxChange} ProactiveInboxChange */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactivePresentation} ProactivePresentation */
/** @typedef {import('../services/proactiveInboxStore.js').InboxMutation} InboxMutation */
/** @typedef {import('../logger.js').Logger} Logger */

/** Low-frequency retention sweep; the badge must refresh without user action. */
const PROACTIVE_INBOX_PRUNE_INTERVAL_MS = 60 * 60 * 1000

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
}) {
  /** @type {{ unref?: () => void } | null} */
  let pruneTimer = null

  /**
   * @param {string} channel
   * @param {unknown} payload
   */
  function broadcastToRenderers(channel, payload) {
    for (const win of getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
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
    for (const win of getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      if (getWindowCapability(win.webContents) !== 'pet') continue
      win.webContents.send('proactive:present', presentation)
    }
  }

  /** @param {InboxMutation} mutation */
  function publishInboxChange(mutation) {
    /** @type {ProactiveInboxChange} */
    const change = {
      unreadCount: mutation.unreadCount,
      entries: mutation.entries,
      removedIds: mutation.removedIds,
    }
    broadcastToRenderers('inbox:changed', change)
  }

  const outlets = createProactiveOutletRegistry({ logger })

  outlets.register('inbox', (message, state) => {
    const mutation = inbox.upsert(message)
    state.unreadCount = mutation.unreadCount
    state.entries = mutation.entries
    state.removedIds = mutation.removedIds
    state.changed = mutation.changed
    if (mutation.changed) {
      publishInboxChange(mutation)
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

  // No strip window exists in this milestone. The message stays in the inbox
  // and the presentation event is still emitted for the strip renderer that
  // arrives later; the pet must not fall back to a bubble for it.
  outlets.register('strip', (message) => {
    presentToPet({ outlet: 'strip', message })
  })

  const router = createProactiveRouter({ outlets })

  ipcMain.handle('proactive:deliver', async (event, payload) => {
    requireTrustedSender(event)
    const { message, context } = validateProactiveDeliveryPayload(payload)
    return router.deliver(message, context)
  })

  ipcMain.handle('inbox:list', (event) => {
    requireTrustedSender(event)
    const snapshot = inbox.list()
    if (snapshot.removedIds.length > 0) {
      publishInboxChange({
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
    if (mutation.changed) {
      publishInboxChange(mutation)
    }
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
      if (mutation.changed) publishInboxChange(mutation)
    }, PROACTIVE_INBOX_PRUNE_INTERVAL_MS)
    // A sweep timer must never be the reason the process stays alive.
    pruneTimer.unref?.()
  }

  /** Land any debounced inbox write before the process quits. */
  function flush() {
    return inbox.flush()
  }

  /**
   * Empty the inbox for clear-all and push the zero count so the pet badge
   * disappears even when no `inbox:list` follows.
   * @returns {Promise<boolean>}
   */
  async function clearInbox() {
    const cleared = await inbox.clear()
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
 * }} dependencies
 */
export function register({ app, ipcMain, getAllWindows, requireTrustedSender }) {
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
