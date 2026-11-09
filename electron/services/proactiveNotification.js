import { Notification } from 'electron'
import { runWhenPanelContentReady } from '../panelContentReady.js'
import { panelWindow, mainWindow, createPanelWindow, getPetIconPath } from '../windowManager.js'

/**
 * Bring the companion panel forward (creating it if needed) and keep the pet
 * above it. Shared by the OS notification click and the reminder strip.
 *
 * `onReady` runs only after the panel's renderer has loaded, which matters
 * when a retired panel is rebuilt for this click.
 */
/** @param {{ onReady?: () => void }} [options] */
export function focusCompanionPanel({ onReady } = {}) {
  const win = panelWindow && !panelWindow.isDestroyed() ? panelWindow : createPanelWindow()
  if (!win || win.isDestroyed()) return undefined
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.moveTop()
  if (typeof onReady === 'function') runWhenPanelContentReady(win, onReady)
  return win
}

/**
 * Fire an OS-level notification with a required title and an optional body.
 * A title-only notice is valid (the routed inbox toast uses it). Clicking it
 * focuses the panel window (creating it if needed) and then runs the optional
 * `onClick` hand-off from the proactive router. Returns false when the platform
 * has no Notification support (rare on Linux without notify-send).
 *
 * @param {{ title?: unknown, body?: unknown, onClick?: unknown }} notification
 * @returns {boolean}
 */
export function showProactiveNotification({ title, body, onClick }) {
  if (!Notification.isSupported()) return false
  if (typeof title !== 'string' || !title.trim()) return false

  const trimmedBody = typeof body === 'string' ? body.trim() : ''
  const notification = new Notification({
    title: title.trim(),
    ...(trimmedBody ? { body: trimmedBody } : {}),
    silent: false,
    icon: getPetIconPath(),
  })

  notification.on('click', () => {
    focusCompanionPanel({
      onReady: () => {
        if (typeof onClick === 'function') onClick()
      },
    })
  })

  notification.show()
  return true
}
