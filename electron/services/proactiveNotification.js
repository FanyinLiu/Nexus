import { app, Notification } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { panelWindow, mainWindow, createPanelWindow } from '../windowManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolveIconPath() {
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const name = ext === 'png' ? 'nexus-256' : 'nexus'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'public', `${name}.${ext}`)
  }
  return path.join(__dirname, '..', '..', 'public', `${name}.${ext}`)
}

/**
 * Fire an OS-level notification with title + body. Clicking it focuses the
 * panel window (creating it if needed). Returns false when the platform has
 * no Notification support (rare on Linux without notify-send).
 */
export function showProactiveNotification({ title, body }) {
  if (!Notification.isSupported()) return false
  if (typeof title !== 'string' || !title.trim()) return false
  if (typeof body !== 'string' || !body.trim()) return false

  const notification = new Notification({
    title: title.trim(),
    body: body.trim(),
    silent: false,
    icon: resolveIconPath(),
  })

  notification.on('click', () => {
    const win = panelWindow && !panelWindow.isDestroyed() ? panelWindow : createPanelWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.moveTop()
  })

  notification.show()
  return true
}
