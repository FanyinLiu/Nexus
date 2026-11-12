// @ts-check
/**
 * Deny-all guard for Electron <webview> attachments.
 *
 * A webview guest is a separate renderer with its own preload and privileges.
 * No Nexus surface embeds one, so every attachment attempt is treated as a
 * policy violation. Installing on `web-contents-created` covers the pet, the
 * panel, and any window added later without relying on each creator to wire
 * its own listener.
 */

/**
 * Register the app-level guard before any BrowserWindow is created.
 * @param {Electron.App} app
 */
export function installWebviewAttachGuard(app) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
