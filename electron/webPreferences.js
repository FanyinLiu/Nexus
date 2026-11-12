// @ts-check
/**
 * Shared webPreferences baseline for every renderer BrowserWindow.
 *
 * The flags are a privilege contract: isolated context, sandboxed renderer,
 * no Node in the page, web security on, and the preload bridge. `webviewTag`
 * stays explicitly off even though no surface embeds a <webview> today — the
 * app-level will-attach-webview guard is defense in depth, and this flag stops
 * Chromium from creating a guest renderer in the first place.
 */

/**
 * @param {string} preload
 * @returns {Electron.WebPreferences}
 */
export function trustedRendererWebPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  }
}

/**
 * The reminder strip renders fixed action copy and must never spell-check it,
 * but its privilege baseline is identical to the pet/panel windows.
 * @param {string} preload
 * @returns {Electron.WebPreferences}
 */
export function reminderStripWebPreferences(preload) {
  return {
    ...trustedRendererWebPreferences(preload),
    spellcheck: false,
  }
}
