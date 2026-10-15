// Smoke-only bridge. The real preload expects the full main process; this
// window only needs the presence channels so the v2 pet can receive a
// simulated cursor and a simulated typing signal. localStorage is seeded
// before the page script so gaze follow and typing awareness are already on.

const { contextBridge, ipcRenderer } = require('electron')

try {
  window.localStorage.setItem('nexus:onboarding', JSON.stringify({
    completedAt: '2026-06-20T00:00:00.000Z',
  }))
  window.sessionStorage.setItem('nexus:startup-greeting-shown', '1')
  window.localStorage.setItem('nexus:settings', JSON.stringify({
    settingsSchemaVersion: 11,
    gazeFollowEnabled: true,
    typingAwarenessEnabled: true,
    typingAwarenessNoticeAccepted: true,
    vtsEnabled: false,
  }))
} catch (error) {
  console.error('[pet-presence-smoke-preload] failed to seed local state', error)
}

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('desktopPet', {
  setDesktopPresencePreferences: async () => ({
    running: false,
    permission: 'not-applicable',
    platform: process.platform,
    messageKey: 'settings.window.typing_status_off',
    recommendationKey: 'settings.window.typing_awareness_hint',
  }),
  getDesktopTypingStatus: async () => ({
    running: false,
    permission: 'not-applicable',
    platform: process.platform,
    messageKey: 'settings.window.typing_status_off',
    recommendationKey: 'settings.window.typing_awareness_hint',
  }),
  openDesktopTypingPermission: async () => ({
    opened: false,
    messageKey: 'settings.window.typing_unavailable',
    recommendationKey: 'settings.window.typing_unavailable_hint',
  }),
  subscribeDesktopGaze: (listener) => subscribe('desktop-presence:gaze', listener),
  subscribeDesktopTyping: (listener) => subscribe('desktop-presence:typing', listener),
  subscribeDesktopTypingStatus: (listener) => subscribe('desktop-presence:typing-status', listener),
})
