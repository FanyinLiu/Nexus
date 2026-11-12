// @ts-check
/**
 * Host wiring for the proactive delivery-context provider.
 *
 * ipcRegistry owns the host reads and the lazy active-window capture loader;
 * this factory assembles them once so the saved-switch gates can be exercised
 * without booting the whole IPC registry.
 *
 * Semantic trap: the renderer's desktopAwarenessAllowed preference is only a
 * copy. The main process also owns the saved desktop-context switch, so both
 * must allow the read. `getActiveWindow` repeats the saved-switch check
 * because the provider is not the only future caller of these dependencies —
 * an unwired caller must not read a window title after the user turned the
 * switch off.
 */

import { createProactiveDeliveryContextProvider } from './proactiveDeliveryContext.js'

/** @typedef {import('../../shared/proactiveDelivery.js').FocusState} FocusState */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveDeliveryPreferences} ProactiveDeliveryPreferences */

/**
 * @typedef {object} SavedActiveWindowFlags
 * @property {boolean} activeWindow
 */

/**
 * @typedef {object} ActiveWindowSnapshot
 * @property {string} [activeWindowTitle]
 * @property {string} [activeWindowAppName]
 */

/**
 * @typedef {() => Promise<ActiveWindowSnapshot | null>} CaptureActiveWindowContext
 */

/**
 * @typedef {object} ProactiveDeliveryContextWiringDependencies
 * @property {() => boolean} isPanelFocused
 * @property {() => FocusState} getFocusState
 * @property {() => SavedActiveWindowFlags} getSavedDesktopContextFlags Saved main-process switch.
 * @property {() => Promise<CaptureActiveWindowContext>} loadCaptureActiveWindowContext
 *   Lazy loader: the desktop-context service pulls native Electron modules, so
 *   it is imported only when the saved switch allows a read.
 * @property {() => ProactiveDeliveryPreferences | null} getPreferences
 * @property {() => number} now
 */

/**
 * Build the provider plus the two saved-switch gates the registry passes to it.
 *
 * @param {ProactiveDeliveryContextWiringDependencies} dependencies
 */
export function createProactiveDeliveryContextWiring({
  isPanelFocused,
  getFocusState,
  getSavedDesktopContextFlags,
  loadCaptureActiveWindowContext,
  getPreferences,
  now,
}) {
  /**
   * Saved main-process switch for active-window awareness.
   * @returns {boolean}
   */
  const isActiveWindowAllowed = () => getSavedDesktopContextFlags().activeWindow === true

  /**
   * Active-window snapshot for the delivery context. Returns null without
   * touching the capture path when the saved switch is off.
   * @returns {Promise<{ title: string, appName: string } | null>}
   */
  const getActiveWindow = async () => {
    if (getSavedDesktopContextFlags().activeWindow !== true) return null
    const captureActiveWindowContext = await loadCaptureActiveWindowContext()
    const snapshot = await captureActiveWindowContext()
    if (!snapshot) return null
    return {
      title: typeof snapshot.activeWindowTitle === 'string' ? snapshot.activeWindowTitle : '',
      appName: typeof snapshot.activeWindowAppName === 'string' ? snapshot.activeWindowAppName : '',
    }
  }

  const { getDeliveryContext } = createProactiveDeliveryContextProvider({
    isPanelFocused,
    getFocusState,
    isActiveWindowAllowed,
    getActiveWindow,
    getPreferences,
    now,
  })

  return { getDeliveryContext, isActiveWindowAllowed, getActiveWindow }
}
