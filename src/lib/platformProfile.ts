import type { PlatformProfile } from '../types'

function hasResolvedProfile(profile?: PlatformProfile | null) {
  return Boolean(profile && profile.platform && profile.platform !== 'unknown')
}

function isCapabilityAvailable(
  profile: PlatformProfile | null | undefined,
  supported: boolean | undefined,
  available: boolean | undefined,
) {
  if (!hasResolvedProfile(profile)) return true
  return supported !== false && available !== false
}

export function isMediaSessionAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.mediaSession.supported,
    profile?.mediaSession.available,
  )
}

export function isDesktopContextActiveWindowAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.desktopContext.activeWindowSupported,
    profile?.desktopContext.activeWindowAvailable,
  )
}

export function isDesktopContextScreenshotAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.desktopContext.screenshotSupported,
    profile?.desktopContext.screenshotAvailable,
  )
}

export function isDesktopContextClipboardAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.desktopContext.clipboardSupported,
    profile?.desktopContext.clipboardAvailable,
  )
}

export function isVoiceSpeechInputAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.voice.speechInputSupported,
    profile?.voice.speechInputAvailable,
  )
}

export function isVoiceSpeechOutputAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.voice.speechOutputSupported,
    profile?.voice.speechOutputAvailable,
  )
}

export function isVoiceContinuousAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.voice.continuousVoiceSupported,
    profile?.voice.speechInputAvailable,
  )
}

export function isVoiceVadAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.voice.vadSupported,
    profile?.voice.speechInputAvailable,
  )
}

export function isVoiceWakewordAvailable(profile?: PlatformProfile | null) {
  return isCapabilityAvailable(
    profile,
    profile?.voice.wakewordSupported,
    profile?.voice.speechInputAvailable,
  )
}

export function getPlatformDependencyHint(
  profile: PlatformProfile | null | undefined,
  supported: boolean | undefined,
  available: boolean | undefined,
  dependencyHint: string | null | undefined,
) {
  if (!hasResolvedProfile(profile)) return null
  if (supported === false) return 'unsupported'
  if (available === false) return dependencyHint?.trim() || 'unavailable'
  return null
}
