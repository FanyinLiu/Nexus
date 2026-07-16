import { useCallback, useEffect, useRef, useState } from 'react'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import type { PetMood, PetTouchZone, SpeechLevelSource } from '../../../types/index.ts'
import {
  buildRuntimePetModelDefinition,
  type CubismModelFile,
  type PetModelDefinition,
  type PetExpressionSlot,
} from '../models.ts'
import type { PetPerformanceCue } from '../performance.ts'
import { createBlinkState } from './live2d/blink.ts'
import { resolveExpressionSlot, resolveGestureGroup, resolveMotionGroup } from './live2d/expressions.ts'
import { applyLive2DFrame, type FrameRenderState } from './live2d/frameRender.ts'
import { layoutLive2DModel, MIN_CANVAS_HEIGHT, MIN_CANVAS_WIDTH } from './live2d/layout.ts'
import { clamp } from '../../../lib/common.ts'
import {
  attachLive2DModelTicker,
  clearLive2DAsyncHandles,
  createLive2DAsyncOwnershipCoordinator,
  syncLive2DPlayback,
  shouldAbortLive2DBoot,
  shouldContinueLive2DModelAttempt,
  shouldDestroyLateLive2DModel,
  trackLive2DAsyncHandle,
} from './live2d/lifecycle.ts'
import {
  resolveAssetPath,
  type GazeTarget,
  type Live2DModelHandle,
  type MotionPreloadValue,
  type PixiApplication,
} from './live2d/types.ts'
import { ensureLive2DVendorScripts } from './live2d/vendor.ts'

const MODEL_LOAD_TIMEOUT_MS = 15_000
const MODEL_LOAD_MAX_ATTEMPTS = 3
const MOTION_TRIGGER_COOLDOWN_MS = 1500

type Live2DCanvasProps = {
  modelDefinition: PetModelDefinition
  mood: PetMood
  touchZone?: PetTouchZone | null
  isSpeaking?: boolean
  isListening?: boolean
  speechLevel?: number
  speechLevelSource?: SpeechLevelSource
  gazeTarget?: GazeTarget
  performanceCue?: PetPerformanceCue | null
  placement?: 'pet-stage' | 'panel-card'
  paused?: boolean
}

export function Live2DCanvas({
  modelDefinition,
  mood,
  touchZone = null,
  isSpeaking = false,
  isListening = false,
  speechLevel = 0,
  speechLevelSource,
  gazeTarget = { x: 0, y: 0 },
  performanceCue = null,
  placement = 'panel-card',
  paused = false,
}: Live2DCanvasProps) {
  const resolvedModelPath = resolveAssetPath(modelDefinition.modelPath)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<Live2DModelType | null>(null)
  const appRef = useRef<PixiApplication | null>(null)
  const pausedRef = useRef(paused)
  const modelTickerCleanupRef = useRef<(() => void) | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const cleanupBeforeModelUpdateRef = useRef<(() => void) | null>(null)
  const currentExpressionRef = useRef<string | null>(null)
  const currentExpressionSlotRef = useRef<PetExpressionSlot>('idle')
  const lastMotionKeyRef = useRef('')
  const lastMotionAtRef = useRef(0)
  const performanceCueRef = useRef<PetPerformanceCue | null>(null)
  const performanceCueStartedAtRef = useRef(0)
  const isSpeakingRef = useRef(isSpeaking)
  isSpeakingRef.current = isSpeaking
  const speechLevelTargetRef = useRef(clamp(speechLevel, 0, 1))
  const speechLevelSourceRef = useRef<SpeechLevelSource | null>(speechLevelSource ?? null)
  speechLevelSourceRef.current = speechLevelSource ?? null
  const gazeTargetRef = useRef<GazeTarget>({
    x: clamp(gazeTarget.x, -1, 1),
    y: clamp(gazeTarget.y, -1, 1),
  })
  const frameStateRef = useRef<FrameRenderState>({
    smoothedGaze: { x: 0, y: 0 },
    smoothedSpeechLevel: 0,
    blink: createBlinkState(),
  })
  const activeModelDefinitionRef = useRef(buildRuntimePetModelDefinition(modelDefinition))
  const [error, setError] = useState<string | null>(null)
  const [modelReady, setModelReady] = useState(false)

  const syncPlayback = useCallback((app: PixiApplication | null, disposed: boolean) => {
    syncLive2DPlayback(app, {
      disposed,
      visibilityState: document.visibilityState,
      paused: pausedRef.current,
    })
  }, [])

  useEffect(() => {
    pausedRef.current = paused
    syncPlayback(appRef.current, false)
  }, [paused, syncPlayback])

  function setDebugState(partialState: Partial<NonNullable<Window['__desktopPetLive2DDebug']>>) {
    const nextState = {
      phase: 'idle',
      error: null,
      app: null,
      model: null,
      ...window.__desktopPetLive2DDebug,
      ...partialState,
    }

    window.__desktopPetLive2DDebug = nextState
    console.debug(
      `[Live2D] ${nextState.phase ?? 'unknown-phase'}${nextState.error ? `: ${nextState.error}` : ''}`,
    )
  }

  const applyExpression = useCallback((name: string | undefined) => {
    const model = modelRef.current
    if (!model || !name || currentExpressionRef.current === name) return
    currentExpressionRef.current = name
    void model.expression(name)
  }, [])

  const triggerMotion = useCallback((expressionSlot: PetExpressionSlot, options?: { force?: boolean }) => {
    const model = modelRef.current
    if (!model) return

    const motionGroup = resolveMotionGroup(activeModelDefinitionRef.current, expressionSlot)
    if (!motionGroup) return

    const motionKey = `${expressionSlot}:${motionGroup}`
    const now = performance.now()

    if (
      !options?.force
      && (
      lastMotionKeyRef.current === motionKey
      && now - lastMotionAtRef.current < MOTION_TRIGGER_COOLDOWN_MS
      )
    ) {
      return
    }

    lastMotionKeyRef.current = motionKey
    lastMotionAtRef.current = now
    void model.motion(motionGroup).catch((caught) => {
      console.warn('[Live2D] motion-trigger-failed', {
        expressionSlot,
        motionGroup,
        error: caught instanceof Error ? caught.message : String(caught),
      })
    })
  }, [])

  const syncVisualState = useCallback((nextExpressionSlot: PetExpressionSlot) => {
    const previousExpressionSlot = currentExpressionSlotRef.current
    currentExpressionSlotRef.current = nextExpressionSlot

    const expressionMap = activeModelDefinitionRef.current.expressionMap
    const expressionName = expressionMap[nextExpressionSlot] ?? expressionMap.idle

    applyExpression(expressionName)

    if (previousExpressionSlot === nextExpressionSlot) return

    triggerMotion(nextExpressionSlot)
  }, [applyExpression, triggerMotion])

  const layoutModel = useCallback((model: Live2DModelHandle, app: PixiApplication) => {
    layoutLive2DModel({
      model,
      app,
      modelDefinition: activeModelDefinitionRef.current,
      placement,
    })
  }, [placement])

  const bindModelRuntime = useCallback((model: Live2DModelType) => {
    const internalModel = (model as Live2DModelHandle).internalModel
    if (!internalModel) return

    const handleBeforeModelUpdate = () => {
      applyLive2DFrame({
        modelDefinition: activeModelDefinitionRef.current,
        internalModel,
        activeExpressionSlot: currentExpressionSlotRef.current,
        gazeTarget: gazeTargetRef.current,
        speechLevelTarget: isSpeakingRef.current
          ? (speechLevelSourceRef.current?.current ?? speechLevelTargetRef.current)
          : 0,
        performanceCue: performanceCueRef.current,
        performanceCueStartedAt: performanceCueStartedAtRef.current,
        state: frameStateRef.current,
      })
    }

    internalModel.on?.('beforeModelUpdate', handleBeforeModelUpdate)
    cleanupBeforeModelUpdateRef.current = () => {
      internalModel.off?.('beforeModelUpdate', handleBeforeModelUpdate)
      internalModel.removeListener?.('beforeModelUpdate', handleBeforeModelUpdate)
    }
  }, [])

  useEffect(() => {
    activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition)
  }, [modelDefinition])

  useEffect(() => {
    if (!modelReady) return

    const nextSlot = resolveExpressionSlot(
      mood,
      touchZone,
      isListening,
      isSpeaking,
      performanceCue?.expressionSlot,
    )

    // Apply expression immediately (lightweight, no animation jerk)
    const expressionMap = activeModelDefinitionRef.current.expressionMap
    const expressionName = expressionMap[nextSlot] ?? expressionMap.idle
    applyExpression(expressionName)

    // Debounce motion triggers to prevent rapid state transitions
    // (listening→thinking→speaking) from causing twitchy animations
    const timerId = window.setTimeout(() => {
      syncVisualState(resolveExpressionSlot(
        mood,
        touchZone,
        isListening,
        isSpeaking,
        performanceCue?.expressionSlot,
      ))
    }, 120)

    return () => window.clearTimeout(timerId)
  }, [
    applyExpression,
    isListening,
    isSpeaking,
    modelReady,
    mood,
    performanceCue,
    syncVisualState,
    touchZone,
  ])

  useEffect(() => {
    if (!modelReady || !performanceCue) return

    // Inline [motion:wave] tags: look up the model-declared gesture group
    // and fire it directly. Unknown gesture name → silent no-op so personas
    // targeting richer models don't break on gesture-poor models.
    const gestureName = performanceCue.gestureName
    if (gestureName) {
      const model = modelRef.current
      const gestureGroup = resolveGestureGroup(activeModelDefinitionRef.current, gestureName)
      if (model && gestureGroup) {
        void model.motion(gestureGroup).catch((caught) => {
          console.warn('[Live2D] gesture-trigger-failed', {
            gestureName,
            gestureGroup,
            error: caught instanceof Error ? caught.message : String(caught),
          })
        })
      }
    }

    // Let syncVisualState handle expression; only force-trigger if motionSlot
    // differs from the expression slot to avoid double-triggering the same motion.
    const motionSlot = performanceCue.motionSlot
    if (motionSlot && motionSlot !== performanceCue.expressionSlot) {
      triggerMotion(motionSlot, { force: true })
    }
  }, [modelReady, performanceCue, triggerMotion])

  useEffect(() => {
    performanceCueRef.current = performanceCue
    performanceCueStartedAtRef.current = performanceCue ? performance.now() : 0
  }, [performanceCue])

  useEffect(() => {
    const ownership = createLive2DAsyncOwnershipCoordinator()
    let attempts = 0
    let handleVisibilityChange: (() => void) | null = null
    const pendingTimeoutIds = new Set<number>()
    const pendingRafIds = new Set<number>()
    const frameState = frameStateRef.current
    const bootStartedAt = performance.now()

    function isDisposed() {
      return ownership.isDisposed
    }

    function clearPendingBootWork() {
      clearLive2DAsyncHandles(pendingTimeoutIds, (id) => window.clearTimeout(id))
      clearLive2DAsyncHandles(pendingRafIds, (id) => window.cancelAnimationFrame(id))
      // Settle waits + reject load races exactly once (see lifecycle coordinator).
      ownership.dispose()
    }

    function waitForTimeout(ms: number) {
      const { promise, settle } = ownership.createTrackedWait()
      const timeoutId = trackLive2DAsyncHandle(
        pendingTimeoutIds,
        window.setTimeout(() => {
          pendingTimeoutIds.delete(timeoutId)
          settle()
        }, ms),
      )
      return promise
    }

    function waitForAnimationFrame() {
      const { promise, settle } = ownership.createTrackedWait()
      const rafId = trackLive2DAsyncHandle(
        pendingRafIds,
        window.requestAnimationFrame(() => {
          pendingRafIds.delete(rafId)
          settle()
        }),
      )
      return promise
    }

    function destroyOwnedRuntime() {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (handleVisibilityChange) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        handleVisibilityChange = null
      }
      modelTickerCleanupRef.current?.()
      modelTickerCleanupRef.current = null
      cleanupBeforeModelUpdateRef.current?.()
      cleanupBeforeModelUpdateRef.current = null
      // Teardown policy lives in LIVE2D_TEARDOWN / ownership.destroyOwnedRuntime.
      ownership.destroyOwnedRuntime({
        model: modelRef.current,
        app: appRef.current,
      })
      modelRef.current = null
      appRef.current = null
    }

    async function boot() {
      if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) return

      async function loadModelWithRetry(
        Live2DModelCtor: {
          from: (
            source: string,
            options?: {
              autoInteract?: boolean
              autoUpdate?: boolean
              motionPreload?: MotionPreloadValue
            },
          ) => Promise<Live2DModelType>
        },
      ) {
        let lastError: unknown = null

        for (let attempt = 1; attempt <= MODEL_LOAD_MAX_ATTEMPTS; attempt += 1) {
          if (!shouldContinueLive2DModelAttempt({
            disposed: isDisposed(),
            attempt,
            maxAttempts: MODEL_LOAD_MAX_ATTEMPTS,
          })) {
            break
          }

          attempts = attempt
          let timedOut = false
          let timeoutId: number | null = null
          try {
            setDebugState({ phase: `loading-model-${attempt}` })
            setDebugState({ attempts: attempt })

            if (attempt > 1) {
              await waitForTimeout(attempt * 300)
            } else {
              await waitForAnimationFrame()
            }

            if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) {
              break
            }

            const model = await ownership.raceModelLoad({
              loadPromise: Live2DModelCtor.from(resolvedModelPath, {
                autoInteract: false,
                autoUpdate: false,
                motionPreload: window.PIXI?.live2d?.MotionPreloadStrategy?.NONE ?? 'NONE',
              }),
              shouldDiscard: () => shouldDestroyLateLive2DModel({
                disposed: isDisposed(),
                timedOut,
              }),
              registerAbort: (abort) => {
                timeoutId = trackLive2DAsyncHandle(
                  pendingTimeoutIds,
                  window.setTimeout(() => {
                    timedOut = true
                    pendingTimeoutIds.delete(timeoutId as number)
                    abort(new Error('Live2D model load timed out.'))
                  }, MODEL_LOAD_TIMEOUT_MS),
                )
              },
            })

            if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) {
              ownership.destroyLateModel(model)
              break
            }

            const modelLoadedAt = performance.now()
            if (containerRef.current) {
              containerRef.current.dataset.live2dModelLoadedMs = (modelLoadedAt - bootStartedAt).toFixed(1)
            }
            setDebugState({ modelLoadedAt })
            return model
          } catch (caught) {
            lastError = caught
            if (isDisposed()) {
              break
            }
            setDebugState({
              phase: `loading-model-retry-${attempt}`,
              error: caught instanceof Error ? caught.message : 'unknown-error',
            })
          } finally {
            if (timeoutId !== null) {
              pendingTimeoutIds.delete(timeoutId)
              window.clearTimeout(timeoutId)
            }
          }
        }

        if (isDisposed()) {
          throw new Error('Live2D boot aborted.')
        }

        throw lastError instanceof Error ? lastError : new Error('Live2D model failed to initialize.')
      }

      try {
        const bootContainer = containerRef.current
        if (shouldAbortLive2DBoot(isDisposed(), Boolean(bootContainer)) || !bootContainer) return

        // Visible boot state is initialized synchronously before any await so a
        // remount never inherits a stale ready/error surface. Cleanup must not
        // call React setters — only ownership invalidation + resource destroy.
        setDebugState({
          phase: 'booting',
          error: null,
          app: null,
          model: null,
          bootStartedAt,
          vendorReadyAt: undefined,
          appCreatedAt: undefined,
          modelLoadedAt: undefined,
          modelReadyAt: undefined,
          firstFrameAt: undefined,
          attempts: 0,
          readyMs: undefined,
          firstFrameMs: undefined,
        })
        setError(null)
        setModelReady(false)
        delete bootContainer.dataset.live2dReadyMs
        delete bootContainer.dataset.live2dFirstFrameMs
        delete bootContainer.dataset.live2dAttempts
        delete bootContainer.dataset.live2dVendorMs
        delete bootContainer.dataset.live2dAppCreatedMs
        delete bootContainer.dataset.live2dModelLoadedMs
        bootContainer.dataset.live2dPhase = 'booting'
        bootContainer.dataset.live2dModelId = modelDefinition.id
        bootContainer.dataset.live2dError = '0'
        currentExpressionRef.current = null
        activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition)

        await ensureLive2DVendorScripts()
        const containerAfterVendor = containerRef.current
        if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerAfterVendor)) || !containerAfterVendor) return
        const vendorReadyAt = performance.now()
        containerAfterVendor.dataset.live2dVendorMs = (vendorReadyAt - bootStartedAt).toFixed(1)
        setDebugState({ vendorReadyAt })

        try {
          const modelResponse = await fetch(resolvedModelPath)
          if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) return
          if (modelResponse.ok) {
            const modelFile = (await modelResponse.json()) as CubismModelFile
            if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) return
            activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition, modelFile)
          }
        } catch {
          if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) return
          activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition)
        }
        if (shouldAbortLive2DBoot(isDisposed(), Boolean(containerRef.current))) return

        const pixiRuntime = window.PIXI
        if (!pixiRuntime) {
          throw new Error('PIXI runtime is not available.')
        }
        if (!window.Live2DCubismCore) {
          throw new Error('Live2D Cubism Core is not available.')
        }

        setDebugState({ phase: 'module-importing' })
        const Live2DModel = pixiRuntime.live2d?.Live2DModel
        if (!Live2DModel) {
          throw new Error('Live2D Pixi plugin is not available.')
        }

        setDebugState({ phase: 'app-creating' })
        const hostContainer = containerRef.current
        if (shouldAbortLive2DBoot(isDisposed(), Boolean(hostContainer)) || !hostContainer) return

        const app = new pixiRuntime.Application({
          autoStart: true,
          resizeTo: hostContainer,
          backgroundAlpha: 0,
          antialias: true,
        })

        // Effect cleanup can only interleave at await points; still destroy any
        // app that became ownerless before refs are published.
        const containerAfterApp = containerRef.current
        if (isDisposed() || !containerAfterApp) {
          ownership.destroyApplication(app)
          return
        }

        const appCreatedAt = performance.now()
        containerAfterApp.dataset.live2dAppCreatedMs = (appCreatedAt - bootStartedAt).toFixed(1)
        setDebugState({ appCreatedAt })

        appRef.current = app
        containerAfterApp.appendChild(app.view as HTMLCanvasElement)
        handleVisibilityChange = () => {
          syncPlayback(app, isDisposed())
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)
        // Respect the document's current visibility; do not invent a visible start
        // when the host document is already hidden.
        handleVisibilityChange()

        const { width, height } = containerAfterApp.getBoundingClientRect()
        app.renderer.resize(Math.max(width, MIN_CANVAS_WIDTH), Math.max(height, MIN_CANVAS_HEIGHT))

        const model = await loadModelWithRetry(Live2DModel)
        const containerAfterModel = containerRef.current
        if (isDisposed() || !containerAfterModel || appRef.current !== app) {
          ownership.destroyLateModel(model)
          // If dispose already ran, cleanup owns refs. Otherwise tear down the
          // app this boot published so a failed/aborted boot leaves no canvas.
          if (!isDisposed() && appRef.current === app) {
            destroyOwnedRuntime()
          }
          return
        }

        modelRef.current = model
        app.stage.addChild(model)
        modelTickerCleanupRef.current = attachLive2DModelTicker({
          ticker: app.ticker,
          model,
          shouldUpdate: () => !isDisposed()
            && appRef.current === app
            && modelRef.current === model
            && !pausedRef.current
            && document.visibilityState !== 'hidden',
        })
        app.renderer.render(app.stage)
        layoutModel(model as Live2DModelHandle, app)
        bindModelRuntime(model)
        app.renderer.render(app.stage)
        if (isDisposed() || appRef.current !== app) {
          ownership.destroyLateModel(model)
          if (!isDisposed() && appRef.current === app) {
            destroyOwnedRuntime()
          }
          return
        }
        const modelReadyAt = performance.now()
        containerAfterModel.dataset.live2dReadyMs = (modelReadyAt - bootStartedAt).toFixed(1)
        containerAfterModel.dataset.live2dAttempts = String(attempts || 1)
        containerAfterModel.dataset.live2dPhase = 'model-ready'
        setDebugState({
          phase: 'model-ready',
          error: null,
          app,
          model,
          modelReadyAt,
          readyMs: modelReadyAt - bootStartedAt,
        })
        setModelReady(true)
        frameState.blink = createBlinkState()
        frameState.smoothedGaze = { x: 0, y: 0 }

        resizeObserverRef.current = new ResizeObserver(() => {
          if (isDisposed()) return
          const activeContainer = containerRef.current
          const activeApp = appRef.current
          const activeModel = modelRef.current

          if (!activeContainer || !activeApp || !activeModel) return

          const nextBounds = activeContainer.getBoundingClientRect()
          activeApp.renderer.resize(
            Math.max(nextBounds.width, MIN_CANVAS_WIDTH),
            Math.max(nextBounds.height, MIN_CANVAS_HEIGHT),
          )
          layoutModel(activeModel as Live2DModelHandle, activeApp)
        })

        resizeObserverRef.current.observe(containerAfterModel)

        const firstFrameRafId = trackLive2DAsyncHandle(
          pendingRafIds,
          window.requestAnimationFrame(() => {
            pendingRafIds.delete(firstFrameRafId)
            if (isDisposed()) return
            const firstFrameAt = performance.now()
            if (containerRef.current) {
              containerRef.current.dataset.live2dFirstFrameMs = (firstFrameAt - bootStartedAt).toFixed(1)
              containerRef.current.dataset.live2dPhase = 'first-frame'
            }
            setDebugState({
              phase: 'first-frame',
              firstFrameAt,
              firstFrameMs: firstFrameAt - bootStartedAt,
            })
          }),
        )
      } catch (caught) {
        if (isDisposed()) {
          return
        }
        console.error('Live2D boot failed:', caught)
        destroyOwnedRuntime()
        setDebugState({
          phase: 'boot-failed',
          error: caught instanceof Error ? caught.message : 'Live2D failed to load.',
        })
        if (containerRef.current) {
          containerRef.current.dataset.live2dPhase = 'boot-failed'
          containerRef.current.dataset.live2dError = '1'
        }
        setError(caught instanceof Error ? caught.message : 'Live2D failed to load.')
        setModelReady(false)
      }
    }

    void boot()

    return () => {
      // Cleanup only invalidates ownership and destroys resources — no React state.
      clearPendingBootWork()
      destroyOwnedRuntime()
      currentExpressionRef.current = null
      currentExpressionSlotRef.current = 'idle'
      lastMotionKeyRef.current = ''
      lastMotionAtRef.current = 0
      performanceCueRef.current = null
      performanceCueStartedAtRef.current = 0
      frameState.smoothedGaze = { x: 0, y: 0 }
      frameState.blink = createBlinkState()
      window.__desktopPetLive2DDebug = {
        phase: 'destroyed',
        error: null,
        app: null,
        model: null,
      }
    }
  }, [
    bindModelRuntime,
    layoutModel,
    modelDefinition,
    resolvedModelPath,
    syncPlayback,
  ])

  useEffect(() => {
    speechLevelTargetRef.current = clamp(speechLevel, 0, 1)
  }, [speechLevel])

  useEffect(() => {
    gazeTargetRef.current = {
      x: clamp(gazeTarget.x, -1, 1),
      y: clamp(gazeTarget.y, -1, 1),
    }
  }, [gazeTarget.x, gazeTarget.y])

  return (
    <div className="live2d-shell">
      <div ref={containerRef} className={`live2d-canvas ${modelReady ? 'is-ready' : ''}`} />
      {error ? <div className="live2d-fallback">{error}</div> : null}
    </div>
  )
}
