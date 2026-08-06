import type { PlatformProfile, RuntimeStateSnapshot } from '../../types/index.ts'

// Renderer-side defaults for the desktop bridge runtime contract. The main
// process owns the live shapes (electron/windowRuntimeState.js is the source
// of truth); these copies let the pet/panel windows render before the first
// snapshot/profile push arrives. The field lists are intentionally declared
// on both sides — the shared RuntimeStateSnapshot / PlatformProfile types in
// src/types/app.ts are the compile-time contract keeping them in sync.

export const DEFAULT_RUNTIME_SNAPSHOT: RuntimeStateSnapshot = {
  mood: 'idle',
  continuousVoiceActive: false,
  panelSettingsOpen: false,
  voiceState: 'idle',
  wakewordPhase: 'disabled',
  wakewordActive: false,
  wakewordAvailable: false,
  wakewordWakeWord: '',
  wakewordReason: '',
  wakewordLastTriggeredAt: '',
  wakewordError: '',
  wakewordUpdatedAt: '',
  assistantActivity: 'idle',
  searchInProgress: false,
  ttsInProgress: false,
  schedulerArmed: false,
  schedulerNextRunAt: '',
  activeTaskLabel: '',
  petOnline: false,
  panelOnline: false,
  petLastSeenAt: '',
  panelLastSeenAt: '',
  updatedAt: '',
}

export const DEFAULT_PLATFORM_PROFILE: PlatformProfile = {
  platform: 'unknown',
  packaged: false,
  startup: {
    supported: false,
    enabled: false,
    requiresPackagedBuild: true,
    mechanism: 'unsupported',
  },
  tray: {
    active: false,
    hideToBackgroundOnClose: false,
  },
  window: {
    supportsVisibleOnAllWorkspaces: false,
    usesTaskbarIcon: false,
    supportsTransparentOverlay: true,
  },
  mediaSession: {
    supported: false,
    available: false,
    backend: 'unsupported',
    dependencyHint: null,
  },
  desktopContext: {
    activeWindowSupported: false,
    activeWindowAvailable: false,
    activeWindowDependencyHint: null,
    screenshotSupported: true,
    screenshotAvailable: true,
    screenshotDependencyHint: null,
    clipboardSupported: true,
    clipboardAvailable: true,
  },
  voice: {
    speechInputSupported: false,
    speechInputAvailable: false,
    speechOutputSupported: false,
    speechOutputAvailable: false,
    continuousVoiceSupported: false,
    vadSupported: false,
    wakewordSupported: false,
    dependencyHint: null,
  },
}

export function normalizePlatformProfile(input: Partial<PlatformProfile> | null | undefined): PlatformProfile {
  if (!input || typeof input !== 'object') {
    return DEFAULT_PLATFORM_PROFILE
  }

  const platform = input.platform ?? DEFAULT_PLATFORM_PROFILE.platform
  const desktopPlatform = platform === 'darwin' || platform === 'win32' || platform === 'linux'
  const mediaSession: Partial<PlatformProfile['mediaSession']> = input.mediaSession ?? {}
  const desktopContext: Partial<PlatformProfile['desktopContext']> = input.desktopContext ?? {}
  const voice: Partial<PlatformProfile['voice']> = input.voice ?? {}
  const mediaSessionSupported = mediaSession.supported ?? DEFAULT_PLATFORM_PROFILE.mediaSession.supported
  const activeWindowSupported = desktopContext.activeWindowSupported
    ?? DEFAULT_PLATFORM_PROFILE.desktopContext.activeWindowSupported
  const screenshotSupported = desktopContext.screenshotSupported
    ?? DEFAULT_PLATFORM_PROFILE.desktopContext.screenshotSupported
  const clipboardSupported = desktopContext.clipboardSupported
    ?? DEFAULT_PLATFORM_PROFILE.desktopContext.clipboardSupported
  const speechInputSupported = voice.speechInputSupported ?? desktopPlatform
  const speechOutputSupported = voice.speechOutputSupported ?? desktopPlatform
  const continuousVoiceSupported = voice.continuousVoiceSupported ?? speechInputSupported
  const vadSupported = voice.vadSupported ?? speechInputSupported
  const wakewordSupported = voice.wakewordSupported ?? speechInputSupported

  return {
    ...DEFAULT_PLATFORM_PROFILE,
    ...input,
    platform,
    startup: {
      ...DEFAULT_PLATFORM_PROFILE.startup,
      ...(input.startup ?? {}),
    },
    tray: {
      ...DEFAULT_PLATFORM_PROFILE.tray,
      ...(input.tray ?? {}),
    },
    window: {
      ...DEFAULT_PLATFORM_PROFILE.window,
      ...(input.window ?? {}),
    },
    mediaSession: {
      ...DEFAULT_PLATFORM_PROFILE.mediaSession,
      ...mediaSession,
      supported: mediaSessionSupported,
      available: mediaSession.available ?? mediaSessionSupported,
    },
    desktopContext: {
      ...DEFAULT_PLATFORM_PROFILE.desktopContext,
      ...desktopContext,
      activeWindowSupported,
      activeWindowAvailable: desktopContext.activeWindowAvailable ?? activeWindowSupported,
      screenshotSupported,
      screenshotAvailable: desktopContext.screenshotAvailable ?? screenshotSupported,
      clipboardSupported,
      clipboardAvailable: desktopContext.clipboardAvailable ?? clipboardSupported,
    },
    voice: {
      ...DEFAULT_PLATFORM_PROFILE.voice,
      ...voice,
      speechInputSupported,
      speechInputAvailable: voice.speechInputAvailable ?? speechInputSupported,
      speechOutputSupported,
      speechOutputAvailable: voice.speechOutputAvailable ?? speechOutputSupported,
      continuousVoiceSupported,
      vadSupported,
      wakewordSupported,
    },
  }
}
