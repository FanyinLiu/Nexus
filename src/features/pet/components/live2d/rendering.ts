type Live2DApplicationOptions = {
  autoStart: true
  resizeTo: HTMLElement
  backgroundAlpha: 0
  antialias: true
  premultipliedAlpha: false
  preference: 'webgl'
}

export const LIVE2D_CONTEXT_RECOVERY_LIMIT = 2

export type Live2DContextRecoveryDecision = {
  action: 'restart' | 'fallback'
  attempts: number
}

/**
 * Builds the Pixi application options required by the transparent pet window.
 * The straight-alpha canvas is intentional: Pixi's premultiplied default
 * produces white fringe pixels when Electron composites Live2D on macOS.
 */
export function createLive2DApplicationOptions(
  resizeTo: HTMLElement,
): Live2DApplicationOptions {
  return {
    autoStart: true,
    resizeTo,
    backgroundAlpha: 0,
    antialias: true,
    premultipliedAlpha: false,
    preference: 'webgl',
  }
}

/**
 * Applies a bounded retry budget when Chromium reports a lost WebGL context.
 * A successful first frame resets the caller-owned attempt count.
 */
export function planLive2DContextRecovery(
  completedAttempts: number,
  limit = LIVE2D_CONTEXT_RECOVERY_LIMIT,
): Live2DContextRecoveryDecision {
  const normalizedAttempts = Number.isFinite(completedAttempts)
    ? Math.max(0, Math.floor(completedAttempts))
    : 0
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : LIVE2D_CONTEXT_RECOVERY_LIMIT

  if (normalizedAttempts >= normalizedLimit) {
    return {
      action: 'fallback',
      attempts: normalizedAttempts,
    }
  }

  return {
    action: 'restart',
    attempts: normalizedAttempts + 1,
  }
}
