// @ts-check
/**
 * Main-process delivery-context provider for proactive re-routing.
 *
 * The renderer owns the first delivery because it has the panel/focus and
 * active-window signals. A snoozed reminder comes back ten minutes later, so
 * main rebuilds the same DeliveryContext from the latest renderer-supplied
 * preferences instead of reusing a stale snapshot.
 *
 * Fullscreen is read only when desktop awareness is allowed: otherwise the
 * active-window snapshot must not be consulted at all. DND stays null until
 * M1.1 adds platform detection, which the router treats as "not muted".
 */

/** @typedef {import('../../shared/proactiveDelivery.js').DeliveryContext} DeliveryContext */
/** @typedef {import('../../shared/proactiveDelivery.js').FocusState} FocusState */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveDeliveryPreferences} ProactiveDeliveryPreferences */

import { isLikelyFullscreenSurface, isQuietHour } from '../../shared/proactiveSignals.js'

/**
 * @typedef {object} ProactiveDeliveryContextDependencies
 * @property {() => boolean} isPanelFocused
 * @property {() => FocusState} getFocusState
 * @property {() => Promise<{ title?: string | null, appName?: string | null } | null>} getActiveWindow
 * @property {() => ProactiveDeliveryPreferences | null} getPreferences
 * @property {() => number} now
 */

/**
 * Build the context provider. All host reads are injected so the module stays
 * importable under node:test without Electron or a live window.
 *
 * @param {ProactiveDeliveryContextDependencies} dependencies
 */
export function createProactiveDeliveryContextProvider({
  isPanelFocused,
  getFocusState,
  getActiveWindow,
  getPreferences,
  now,
}) {
  /**
   * Current delivery context. `getActiveWindow` is awaited only when the
   * preferences allow desktop awareness.
   * @returns {Promise<DeliveryContext>}
   */
  async function getDeliveryContext() {
    const preferences = getPreferences()
    const desktopAwarenessAllowed = preferences?.desktopAwarenessAllowed === true
    let fullscreen = false
    if (desktopAwarenessAllowed) {
      const snapshot = await getActiveWindow()
      fullscreen = isLikelyFullscreenSurface(snapshot?.title, snapshot?.appName)
    }

    return {
      panelFocused: isPanelFocused(),
      fullscreen,
      focusState: getFocusState(),
      inQuietHours: preferences
        ? isQuietHour(new Date(now()).getHours(), preferences.quietStart, preferences.quietEnd)
        : false,
      systemDnd: null,
      awayNotificationsEnabled: preferences?.awayNotificationsEnabled === true,
      stripEnabled: true,
    }
  }

  return { getDeliveryContext }
}
