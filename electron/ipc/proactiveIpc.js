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
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'

import { createLogger } from '../logger.js'
import { createProactiveInboxStore, PROACTIVE_INBOX_FILE_NAME } from '../services/proactiveInboxStore.js'
import { createProactiveOutletRegistry, createProactiveRouter } from '../services/proactiveRouter.js'
import { getBoundWindowCapability } from './windowCapabilities.js'
import { requireTrustedSender } from './validate.js'
import {
  validateInboxUpdatePayload,
  validateProactiveDeliveryPayload,
} from './proactivePayloadSchemas.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxChange} ProactiveInboxChange */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactivePresentation} ProactivePresentation */
/** @typedef {import('../services/proactiveInboxStore.js').InboxMutation} InboxMutation */

/** Low-frequency retention sweep; the badge must refresh without user action. */
const PROACTIVE_INBOX_PRUNE_INTERVAL_MS = 60 * 60 * 1000

/** The store is created in `register()`; this only holds the handle for quit flush. */
/** @type {ReturnType<typeof createProactiveInboxStore> | null} */
let inboxStore = null

/** @type {ReturnType<typeof setInterval> | null} */
let pruneTimer = null

/**
 * @param {string} channel
 * @param {unknown} payload
 */
function broadcastToRenderers(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

/**
 * Presentation events only belong to the pet window. The capability is bound
 * when the window is created, so a rewritten `?view=` cannot receive them.
 * @param {ProactivePresentation} presentation
 */
function presentToPet(presentation) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    if (getBoundWindowCapability(win.webContents) !== 'pet') continue
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

/** Land any debounced inbox write before the process quits. */
export function flushProactiveInbox() {
  return inboxStore?.flush() ?? Promise.resolve(true)
}

/** Stop the periodic retention sweep; called on quit next to the inbox flush. */
export function stopProactiveInboxPrune() {
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
}

/**
 * @param {ReturnType<typeof createProactiveInboxStore>} inbox
 */
function startProactiveInboxPrune(inbox) {
  stopProactiveInboxPrune()
  pruneTimer = setInterval(() => {
    const mutation = inbox.prune()
    if (mutation.changed) publishInboxChange(mutation)
  }, PROACTIVE_INBOX_PRUNE_INTERVAL_MS)
  // A sweep timer must never be the reason the process stays alive.
  pruneTimer.unref?.()
}

/** Register the delivery, inbox and presentation channels. */
export function register() {
  const logger = createLogger('proactive.router')
  const inbox = createProactiveInboxStore({
    getStorePath: () => path.join(app.getPath('userData'), PROACTIVE_INBOX_FILE_NAME),
    onPersistError: () => {
      // The store never throws on persist failures; one warning is the whole
      // contract, and it deliberately carries no inbox content.
      logger.warn('proactive inbox persist failed', { source: 'inbox' })
    },
  })
  inboxStore = inbox

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

  startProactiveInboxPrune(inbox)
}
