import {
  getPlatformDependencyHint,
  isDesktopContextActiveWindowAvailable,
  isDesktopContextClipboardAvailable,
  isDesktopContextScreenshotAvailable,
} from '../../lib/platformProfile.ts'
import type { PlatformProfile, TranslationKey, TranslationParams } from '../../types'

type DesktopContextDiagnosticInput = {
  activeWindowContextEnabled: boolean
  clipboardContextEnabled: boolean
  companionAwarenessPaused: boolean
  contextAwarenessEnabled: boolean
  platformProfile: PlatformProfile
  screenContextEnabled: boolean
}

export type DesktopContextDiagnosticText = {
  key: TranslationKey
  params?: TranslationParams
}

export type DesktopContextDiagnosticItemId =
  | 'companion-continuity'
  | 'active-window'
  | 'clipboard'
  | 'screen-ocr'

export type DesktopContextDiagnosticItem = {
  id: DesktopContextDiagnosticItemId
  source: 'capability_flag' | 'ui_label_only'
  label: DesktopContextDiagnosticText
  status: DesktopContextDiagnosticText
  hint: DesktopContextDiagnosticText
  platformHint: DesktopContextDiagnosticText | null
  active: boolean
  available: boolean
}

export type DesktopContextDiagnosticsView = {
  contextAwarenessAvailable: boolean
  activeWindowAvailable: boolean
  clipboardAvailable: boolean
  screenContextAvailable: boolean
  items: DesktopContextDiagnosticItem[]
}

function text(key: TranslationKey, params?: TranslationParams): DesktopContextDiagnosticText {
  return params ? { key, params } : { key }
}

function platformDependencyText(reason: string | null): DesktopContextDiagnosticText | null {
  if (!reason) return null
  if (reason === 'unsupported') return text('settings.platform.unsupported')
  if (reason === 'unavailable') return text('settings.platform.unavailable')
  // Keep diagnostics coarse so Settings does not expose local environment details.
  return text('settings.platform.unavailable')
}

function resolveContextStatus(
  available: boolean,
  enabled: boolean,
  contextAwarenessEnabled: boolean,
): DesktopContextDiagnosticText {
  if (!available) return text('settings.memory.context.status_unavailable')
  if (enabled) return text('settings.memory.context.status_enabled')
  if (contextAwarenessEnabled) return text('settings.memory.context.status_ready')
  return text('settings.memory.context.status_off')
}

function resolvePlatformHint(
  platformProfile: PlatformProfile,
  supported: boolean | undefined,
  available: boolean | undefined,
  dependencyHint: string | null | undefined,
) {
  return platformDependencyText(getPlatformDependencyHint(
    platformProfile,
    supported,
    available,
    dependencyHint,
  ))
}

export function resolveDesktopContextDiagnostics({
  activeWindowContextEnabled,
  clipboardContextEnabled,
  companionAwarenessPaused,
  contextAwarenessEnabled,
  platformProfile,
  screenContextEnabled,
}: DesktopContextDiagnosticInput): DesktopContextDiagnosticsView {
  const activeWindowAvailable = isDesktopContextActiveWindowAvailable(platformProfile)
  const clipboardAvailable = isDesktopContextClipboardAvailable(platformProfile)
  const screenContextAvailable = isDesktopContextScreenshotAvailable(platformProfile)
  const contextAwarenessAvailable = activeWindowAvailable || clipboardAvailable || screenContextAvailable

  const activeWindowPlatformHint = resolvePlatformHint(
    platformProfile,
    platformProfile.desktopContext.activeWindowSupported,
    platformProfile.desktopContext.activeWindowAvailable,
    platformProfile.desktopContext.activeWindowDependencyHint,
  )
  const clipboardPlatformHint = resolvePlatformHint(
    platformProfile,
    platformProfile.desktopContext.clipboardSupported,
    platformProfile.desktopContext.clipboardAvailable,
    null,
  )
  const screenPlatformHint = resolvePlatformHint(
    platformProfile,
    platformProfile.desktopContext.screenshotSupported,
    platformProfile.desktopContext.screenshotAvailable,
    platformProfile.desktopContext.screenshotDependencyHint,
  )

  const companionActive = contextAwarenessEnabled && !companionAwarenessPaused
  const activeWindowActive = contextAwarenessEnabled && activeWindowContextEnabled && activeWindowAvailable
  const clipboardActive = contextAwarenessEnabled && clipboardContextEnabled && clipboardAvailable
  const screenContextActive = contextAwarenessEnabled && screenContextEnabled && screenContextAvailable

  return {
    contextAwarenessAvailable,
    activeWindowAvailable,
    clipboardAvailable,
    screenContextAvailable,
    items: [
      {
        id: 'companion-continuity',
        source: 'ui_label_only',
        label: text('settings.memory.context.companion_awareness'),
        status: companionActive
          ? text('settings.memory.context.status_enabled')
          : contextAwarenessEnabled
            ? text('settings.memory.context.status_paused')
            : text('settings.memory.context.status_off'),
        hint: text('settings.memory.context.companion_awareness_hint'),
        platformHint: null,
        active: companionActive,
        available: contextAwarenessAvailable,
      },
      {
        id: 'active-window',
        source: 'capability_flag',
        label: text('settings.memory.context.active_window'),
        status: resolveContextStatus(activeWindowAvailable, activeWindowActive, contextAwarenessEnabled),
        hint: activeWindowPlatformHint ?? text('settings.memory.context.active_window_hint'),
        platformHint: activeWindowPlatformHint,
        active: activeWindowActive,
        available: activeWindowAvailable,
      },
      {
        id: 'clipboard',
        source: 'capability_flag',
        label: text('settings.memory.context.clipboard'),
        status: resolveContextStatus(clipboardAvailable, clipboardActive, contextAwarenessEnabled),
        hint: clipboardPlatformHint ?? text('settings.memory.context.clipboard_hint'),
        platformHint: clipboardPlatformHint,
        active: clipboardActive,
        available: clipboardAvailable,
      },
      {
        id: 'screen-ocr',
        source: 'capability_flag',
        label: text('settings.memory.context.screen_ocr'),
        status: resolveContextStatus(screenContextAvailable, screenContextActive, contextAwarenessEnabled),
        hint: screenPlatformHint ?? text('settings.memory.context.screen_ocr_hint'),
        platformHint: screenPlatformHint,
        active: screenContextActive,
        available: screenContextAvailable,
      },
    ],
  }
}
