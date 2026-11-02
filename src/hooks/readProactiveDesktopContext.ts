import type { AppSettings } from '../types/index.ts'

/**
 * Read the active-window snapshot only when the user's settings allow desktop
 * awareness. Anything unreadable counts as "not fullscreen": a proactive
 * message must still be delivered when context collection is unavailable.
 *
 * Shared by the reminder scheduler and the inbox overlay's snooze re-delivery
 * so both route with the same privacy gate instead of keeping two copies.
 */
export async function readProactiveDesktopContext(
  settings: Pick<
    AppSettings,
    'contextAwarenessEnabled' | 'activeWindowContextEnabled' | 'companionAwarenessPaused'
  >,
) {
  if (
    !settings.contextAwarenessEnabled
    || !settings.activeWindowContextEnabled
    || settings.companionAwarenessPaused
  ) {
    return null
  }
  try {
    return await window.desktopPet?.getDesktopContext?.({ includeActiveWindow: true }) ?? null
  } catch {
    return null
  }
}
