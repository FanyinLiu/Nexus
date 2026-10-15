/**
 * Renderer/main handshake for the pre-install flush.
 * The page listens for the event, flushes debounced localStorage
 * (including memory v2), and publishes the snapshot on `window`.
 * Main reads it with executeJavaScript. The literals stay here so the
 * two processes cannot drift.
 */

/** Dispatched in the page so every renderer flushes pending storage. */
export const DURABLE_STORAGE_FLUSH_EVENT = 'nexus:flush-durable-storage'

/** `window` property that holds the flushed settings and memory v2 blob. */
export const DURABLE_UPDATE_SNAPSHOT_GLOBAL = '__nexusDurableUpdateSnapshot'
