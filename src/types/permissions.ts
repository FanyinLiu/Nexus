/** OS media-permission states reported by Electron's systemPreferences API. */
export type MediaPermissionState =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'

export type MediaPermissionStatusSnapshot = {
  platform: string
  microphone: MediaPermissionState
  screenRecording: MediaPermissionState
}

/** True when the OS will not let the feature capture until the user changes it. */
export function isMediaPermissionDenied(status: MediaPermissionState | null | undefined): boolean {
  return status === 'denied' || status === 'restricted'
}
