type Live2DApplicationOptions = {
  autoStart: true
  resizeTo: HTMLElement
  backgroundAlpha: 0
  antialias: true
  premultipliedAlpha: false
  preference: 'webgl'
  // The pet canvas draws one Live2D model through raw WebGL. Pixi's GC only
  // tracks resources touched by its own render pipes, so the model's texture
  // sources look idle and are unloaded after gcMaxUnusedTime. The plugin then
  // keeps binding the deleted WebGLTexture handles. This canvas owns its
  // textures for the lifetime of the runtime, so no background collection.
  gcActive: false
}

export const LIVE2D_CONTEXT_RECOVERY_LIMIT = 2

/** Hidden or occluded renderers may never deliver rAF; boot must not stall. */
export const LIVE2D_BOOT_FRAME_TIMEOUT_MS = 250

export type Live2DBootFrameWait = {
  awaitFrame: boolean
  timeoutMs: number
}

export type Live2DVisibilityRecovery = 'start' | 'stop' | 'restart'

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
    gcActive: false,
  }
}

/**
 * Choose how boot waits for layout/frame work. A hidden window does not run
 * requestAnimationFrame, so onboarding (hosted in the panel while the pet is
 * hidden) would otherwise never finish booting Live2D. Visible windows still
 * wait one frame, with a timeout fallback for macOS occlusion.
 */
export function resolveLive2DBootFrameWait(options: {
  visibilityState: DocumentVisibilityState | string
  timeoutMs?: number
}): Live2DBootFrameWait {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(0, Math.floor(options.timeoutMs as number))
    : LIVE2D_BOOT_FRAME_TIMEOUT_MS

  if (options.visibilityState === 'hidden') {
    return { awaitFrame: false, timeoutMs: 0 }
  }

  return { awaitFrame: true, timeoutMs }
}

/**
 * Visibility changes normally just start/stop the ticker. A restored window
 * can also come back with a lost context; restart the runtime instead of
 * letting the ticker draw with invalid GPU handles.
 */
export function planLive2DVisibilityRecovery(options: {
  disposed: boolean
  visibilityState: DocumentVisibilityState | string
  paused: boolean
  contextLost: boolean
}): Live2DVisibilityRecovery {
  if (options.disposed) return 'stop'
  if (options.visibilityState === 'hidden' || options.paused) return 'stop'
  if (options.contextLost) return 'restart'
  return 'start'
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
