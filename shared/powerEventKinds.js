/**
 * Canonical power event kinds — single source of truth for the OS power
 * events the main process forwards over the `app:power-event` IPC channel
 * (electron/ipc/windowIpc.js) and the renderer types in
 * src/types/autonomy.ts. Values come from Electron's powerMonitor events and
 * must not be renamed.
 */

/** The 5 forwardable power event kinds, in bridge registration order. */
export const POWER_EVENT_KINDS = Object.freeze([
  'suspend',
  'resume',
  'lock-screen',
  'unlock-screen',
  'shutdown',
])
