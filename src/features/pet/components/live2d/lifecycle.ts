// Pure Live2D runtime lifecycle contracts + async ownership coordinator.
// Keep side-effect free (no DOM / Pixi / React) so disposal, visibility,
// wait/abort settlement, and teardown policy can be unit-tested.

export type Live2DVisibilityPlayback = 'start' | 'stop'

export type Live2DModelTickerCallback = (delta: number) => void

export type Live2DModelTickerHost = {
  deltaMS: number
  add: (callback: Live2DModelTickerCallback) => unknown
  remove: (callback: Live2DModelTickerCallback) => unknown
}

export type Live2DDestroyOptions = {
  children?: boolean
  texture?: boolean
  baseTexture?: boolean
}

// Parameter types are intentionally object-shaped (no boolean overload) so
// pixi-live2d Live2DModel.destroy remains assignable under strict function types.
export type Live2DDestroyable = {
  destroy: (options?: Live2DDestroyOptions) => void
}

export type Live2DApplicationLike = {
  destroy: (removeView?: boolean, stageOptions?: Live2DDestroyOptions) => void
}

/**
 * Explicit Pixi / pixi-live2d-display teardown policy.
 *
 * Ownership facts (from installed packages + app wiring):
 * - PetView and PanelView each live in a separate Electron BrowserWindow, so they
 *   never share a PIXI TextureCache / WebGL context.
 * - Within one document only one Live2DCanvas is mounted; boots are sequential
 *   across remounts, but a timed-out/aborted load can still resolve late while a
 *   retry or the next boot is already using Texture.from(url) cache entries.
 * - Live2DModel.destroy only frees model textures when options.texture is true
 *   (see pixi-live2d-display Live2DModel.destroy). Application.destroy(removeView,
 *   stageOptions) tears down the renderer/view; stageOptions.texture/baseTexture
 *   only affect child sprites and are unsafe to set true while another in-flight
 *   load may share TextureCache URLs.
 *
 * Chosen flags:
 * - Owned model: free textures (exclusive published owner for this canvas).
 * - Late/orphan model: destroy structure only — do not invalidate shared cache.
 * - Application: always removeView + destroy children; never stage texture free.
 *
 * Remaining measurement gap: packaged GPU/memory proof that owned texture free
 * fully reclaims VRAM must be collected on a real runtime (not unit-testable here).
 */
export const LIVE2D_TEARDOWN = {
  ownedModel: { children: true, texture: true, baseTexture: true } as const satisfies Live2DDestroyOptions,
  lateModel: { children: true, texture: false, baseTexture: false } as const satisfies Live2DDestroyOptions,
  appStage: { children: true, texture: false, baseTexture: false } as const satisfies Live2DDestroyOptions,
  removeView: true as const,
} as const

/** True when the owning React effect has disposed or lost its host container. */
export function shouldAbortLive2DBoot(disposed: boolean, hasContainer: boolean): boolean {
  return disposed || !hasContainer
}

/** Late model loads that finish after timeout/unmount must be destroyed, not kept. */
export function shouldDestroyLateLive2DModel(options: {
  disposed: boolean
  timedOut: boolean
}): boolean {
  return options.disposed || options.timedOut
}

/**
 * Decide whether another model-load attempt may start.
 * Dispose always wins; attempts beyond max are rejected.
 */
export function shouldContinueLive2DModelAttempt(options: {
  disposed: boolean
  attempt: number
  maxAttempts: number
}): boolean {
  return !options.disposed
    && options.attempt >= 1
    && options.attempt <= options.maxAttempts
}

/** Pause this component's ticker while hidden, explicitly paused, or disposed. */
export function resolveLive2DVisibilityPlayback(options: {
  disposed: boolean
  visibilityState: DocumentVisibilityState | string
  paused: boolean
}): Live2DVisibilityPlayback {
  if (options.disposed || options.paused || options.visibilityState === 'hidden') {
    return 'stop'
  }
  return 'start'
}

/** Apply the visibility decision without owning or destroying the Pixi app. */
export function syncLive2DPlayback(
  app: { start: () => void; stop: () => void } | null | undefined,
  options: {
    disposed: boolean
    visibilityState: DocumentVisibilityState | string
    paused: boolean
  },
): Live2DVisibilityPlayback {
  const playback = resolveLive2DVisibilityPlayback(options)
  if (!app) return playback
  if (playback === 'stop') app.stop()
  else app.start()
  return playback
}

/** Drive one model from its owning app ticker, never PIXI.Ticker.shared. */
export function attachLive2DModelTicker(options: {
  ticker: Live2DModelTickerHost
  model: { update: (deltaMS: number) => void }
  shouldUpdate?: () => boolean
}): () => void {
  let attached = true
  const updateModel = () => {
    if (!attached || options.shouldUpdate?.() === false) return
    options.model.update(options.ticker.deltaMS)
  }
  options.ticker.add(updateModel)

  return () => {
    if (!attached) return
    attached = false
    options.ticker.remove(updateModel)
  }
}

/**
 * Destroy a resource that was created after the owner disposed.
 * Returns true when destroy() was invoked.
 */
export function destroyLateLive2DResource(
  resource: Live2DDestroyable | null | undefined,
  disposed: boolean,
): boolean {
  if (!disposed || !resource) {
    return false
  }
  resource.destroy(LIVE2D_TEARDOWN.lateModel)
  return true
}

/** Track a timeout/rAF id for bulk cancellation on dispose. */
export function trackLive2DAsyncHandle(
  handles: Set<number>,
  handleId: number,
): number {
  handles.add(handleId)
  return handleId
}

export function clearLive2DAsyncHandles(
  handles: Set<number>,
  clearHandle: (id: number) => void,
): void {
  for (const handleId of handles) {
    clearHandle(handleId)
  }
  handles.clear()
}

/** WeakSet-backed once-only destroy for model/app object identity. */
export function createIdempotentResourceDestroyer() {
  const destroyed = new WeakSet<object>()

  return {
    destroyOnce<T extends object>(
      resource: T | null | undefined,
      destroy: (resource: T) => void,
    ): boolean {
      if (!resource || destroyed.has(resource)) {
        return false
      }
      destroyed.add(resource)
      destroy(resource)
      return true
    },
    wasDestroyed(resource: object): boolean {
      return destroyed.has(resource)
    },
  }
}

export type Live2DAsyncOwnershipCoordinator = {
  readonly isDisposed: boolean
  dispose: (abortError?: Error) => void
  createTrackedWait: () => {
    promise: Promise<void>
    settle: () => void
  }
  raceModelLoad: <T extends Live2DDestroyable>(options: {
    loadPromise: Promise<T>
    shouldDiscard: () => boolean
    registerAbort?: (abort: (error: Error) => void) => void
    discardedErrorMessage?: string
  }) => Promise<T>
  destroyLateModel: (model: Live2DDestroyable | null | undefined) => boolean
  destroyApplication: (app: Live2DApplicationLike | null | undefined) => boolean
  destroyOwnedRuntime: (runtime: {
    model?: Live2DDestroyable | null
    app?: Live2DApplicationLike | null
  }) => void
}

/**
 * Pure async-work / ownership coordinator for Live2D boot.
 * Canvas supplies schedule/cancel and Pixi objects; this module only tracks
 * settlement, abort, and idempotent destroy policy.
 */
export function createLive2DAsyncOwnershipCoordinator(): Live2DAsyncOwnershipCoordinator {
  let disposed = false
  let ownedRuntimeDestroyed = false
  const pendingWaitSettles = new Set<() => void>()
  const pendingLoadAbortRejecters = new Set<(error: Error) => void>()
  const destroyer = createIdempotentResourceDestroyer()

  function dispose(abortError = new Error('Live2D boot aborted.')): void {
    disposed = true

    // Snapshot before invoking settles: settle() deletes itself from the Set.
    const waitSettles = [...pendingWaitSettles]
    pendingWaitSettles.clear()
    for (const settle of waitSettles) {
      settle()
    }

    // Snapshot before invoking rejecters: each abort path deletes itself too.
    const loadRejecters = [...pendingLoadAbortRejecters]
    pendingLoadAbortRejecters.clear()
    for (const rejectLoad of loadRejecters) {
      rejectLoad(abortError)
    }
  }

  function createTrackedWait() {
    let settled = false
    let resolvePromise: (() => void) | null = null
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })

    const settle = () => {
      if (settled) return
      settled = true
      pendingWaitSettles.delete(settle)
      resolvePromise?.()
      resolvePromise = null
    }

    pendingWaitSettles.add(settle)
    return { promise, settle }
  }

  async function raceModelLoad<T extends Live2DDestroyable>(options: {
    loadPromise: Promise<T>
    shouldDiscard: () => boolean
    registerAbort?: (abort: (error: Error) => void) => void
    discardedErrorMessage?: string
  }): Promise<T> {
    const discardedErrorMessage = options.discardedErrorMessage
      ?? 'Discarded a late Live2D model load.'
    let raceSettled = false
    let rejectLoad: ((error: Error) => void) | null = null

    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectLoad = (error: Error) => {
        if (raceSettled) return
        raceSettled = true
        if (rejectLoad) {
          pendingLoadAbortRejecters.delete(rejectLoad)
        }
        reject(error)
      }
      pendingLoadAbortRejecters.add(rejectLoad)
      options.registerAbort?.(rejectLoad)
    })

    const guardedLoad = options.loadPromise.then((model) => {
      if (options.shouldDiscard()) {
        destroyLateModel(model)
        throw new Error(discardedErrorMessage)
      }
      return model
    })

    // Promise.race already installs handlers on both sides, so a later rejection
    // of the losing promise is not an unhandled rejection by itself. Keep an
    // extra sink so discard/timeout cleanup errors cannot escape after settle.
    void guardedLoad.catch(() => {})

    try {
      return await Promise.race([guardedLoad, abortPromise])
    } finally {
      raceSettled = true
      if (rejectLoad) {
        pendingLoadAbortRejecters.delete(rejectLoad)
      }
    }
  }

  function destroyLateModel(model: Live2DDestroyable | null | undefined): boolean {
    return destroyer.destroyOnce(model ?? null, (resource) => {
      resource.destroy(LIVE2D_TEARDOWN.lateModel)
    })
  }

  function destroyApplication(app: Live2DApplicationLike | null | undefined): boolean {
    return destroyer.destroyOnce(app ?? null, (resource) => {
      resource.destroy(LIVE2D_TEARDOWN.removeView, LIVE2D_TEARDOWN.appStage)
    })
  }

  function destroyOwnedRuntime(runtime: {
    model?: Live2DDestroyable | null
    app?: Live2DApplicationLike | null
  }): void {
    if (ownedRuntimeDestroyed) return
    ownedRuntimeDestroyed = true
    if (runtime.model) {
      destroyer.destroyOnce(runtime.model, (resource) => {
        resource.destroy(LIVE2D_TEARDOWN.ownedModel)
      })
    }
    if (runtime.app) {
      destroyApplication(runtime.app)
    }
  }

  return {
    get isDisposed() {
      return disposed
    },
    dispose,
    createTrackedWait,
    raceModelLoad,
    destroyLateModel,
    destroyApplication,
    destroyOwnedRuntime,
  }
}
