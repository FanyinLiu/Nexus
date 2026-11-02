import { Notification } from 'electron'
import { panelWindow, mainWindow, createPanelWindow, getPetIconPath } from '../windowManager.js'

/**
 * Bring the companion panel forward (creating it if needed) and keep the pet
 * above it. Shared by the OS notification click and the reminder strip.
 */
export function focusCompanionPanel() {
  const win = panelWindow && !panelWindow.isDestroyed() ? panelWindow : createPanelWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.moveTop()
}

/**
 * Fire an OS-level notification with title + body. Clicking it focuses the
 * panel window (creating it if needed) and then runs the optional `onClick`
 * hand-off from the proactive router. Returns false when the platform has no
 * Notification support (rare on Linux without notify-send).
 *
 * @param {{ title?: unknown, body?: unknown, onClick?: unknown }} notification
 * @returns {boolean}
 */
export function showProactiveNotification({ title, body, onClick }) {
  if (!Notification.isSupported()) return false
  if (typeof title !== 'string' || !title.trim()) return false
  if (typeof body !== 'string' || !body.trim()) return false

  const notification = new Notification({
    title: title.trim(),
    body: body.trim(),
    silent: false,
    icon: getPetIconPath(),
  })

  notification.on('click', () => {
    focusCompanionPanel()
    if (typeof onClick === 'function') onClick()
  })

  notification.show()
  return true
}
