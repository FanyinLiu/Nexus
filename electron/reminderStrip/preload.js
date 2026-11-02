// Reminder strip preload. The strip gets exactly these three calls and
// nothing from the shared pet bridge. The channels are registered on this
// window's own webContents.ipc, so no other window can reach them.
//
// @ts-check
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('reminderStrip', {
  ready: () => ipcRenderer.invoke('reminder-strip:ready'),
  /**
   * @param {string} id
   * @param {string} action
   */
  act: (id, action) => ipcRenderer.invoke('reminder-strip:action', { id, action }),
  /**
   * @param {(payload: unknown) => void} callback
   */
  onItems: (callback) => {
    /** @param {unknown} _event @param {unknown} payload */
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('reminder-strip:items', listener)
    return () => ipcRenderer.removeListener('reminder-strip:items', listener)
  },
})
