import { useCallback, useEffect, useRef, useState } from 'react'
import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'
import type { PetMood, PetTouchZone } from '../../../types'
import {
  buildRuntimePetModelDefinition,
  type CubismModelFile,
  type PetModelDefinition,
  type PetExpressionSlot,
} from '../models'
import type { PetPerformanceCue } from '../performance'
import { createBlinkState } from './live2d/blink'
import { resolveExpressionName, resolveExpressionSlot, resolveMotionGroup } from './live2d/expressions'
import { applyLive2DFrame, type FrameRenderState } from './live2d/frameRender'
import { layoutLive2DModel, MIN_CANVAS_HEIGHT, MIN_CANVAS_WIDTH } from './live2d/layout'
import { clamp } from '../../../lib/common'
import {
  resolveAssetPath,
  type GazeTarget,
  type Live2DModelHandle,
  type MotionPreloadValue,
  type PixiApplication,
} from './live2d/types'
import { ensureLive2DVendorScripts } from './live2d/vendor'

const MODEL_LOAD_TIMEOUT_MS = 15_000
const MOTION_TRIGGER_COOLDOWN_MS = 1500

type Live2DCanvasProps = {
  modelDefinition: PetModelDefinition
  mood: PetMood
  touchZone?: PetTouchZone | null
  isSpeaking?: boolean
  isListening?: boolean
  speechLevel?: number
  gazeTarget?: GazeTarget
  performanceCue?: PetPerformanceCue | null
  placement?: 'pet-stage' | 'panel-card'
}

export function Live2DCanvas({
  modelDefinition,
  mood,
  touchZone = null,
  isSpeaking = false,
  isListening = false,
  speechLevel = 0,
  gazeTarget = { x: 0, y: 0 },
  performanceCue = null,
  placement = 'panel-card',
}: Live2DCanvasProps) {
  const resolvedModelPath = resolveAssetPath(modelDefinition.modelPath)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<Live2DModelType | null>(null)
  const appRef = useRef<PixiApplication | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const cleanupBeforeModelUpdateRef = useRef<(() => void) | null>(null)
  const currentExpressionRef = useRef<string | null>(null)
  const currentExpressionSlotRef = useRef<PetExpressionSlot>('idle')
  const lastMotionKeyRef = useRef('')
  const lastMotionAtRef = useRef(0)
  const performanceCueRef = useRef<PetPerformanceCue | null>(null)
  const performanceCueStartedAtRef = useRef(0)
  const speechLevelTargetRef = useRef(clamp(speechLevel, 0, 1))
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
    console.warn(
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
    const expressionName = resolveExpressionName(nextExpressionSlot, expressionMap)

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
        speechLevelTarget: speechLevelTargetRef.current,
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
    const expressionName = resolveExpressionName(nextSlot, expressionMap)
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
    let disposed = false
    const frameState = frameStateRef.current

    async function boot() {
      if (!containerRef.current) return

      async function loadModelWithRetry(
        Live2DModelCtor: {
          from: (
            source: string,
            options?: {
              autoInteract?: boolean
              motionPreload?: MotionPreloadValue
            },
          ) => Promise<Live2DModelType>
        },
      ) {
        let lastError: unknown = null

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            setDebugState({ phase: `loading-model-${attempt}` })

            if (attempt > 1) {
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 300))
            } else {
              await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
            }

            const model = await Promise.race([
              Live2DModelCtor.from(resolvedModelPath, {
                autoInteract: false,
                motionPreload: window.PIXI?.live2d?.MotionPreloadStrategy?.NONE ?? 'NONE',
              }),
              new Promise<never>((_resolve, reject) => {
                window.setTimeout(() => reject(new Error('Live2D model load timed out.')), MODEL_LOAD_TIMEOUT_MS)
              }),
            ])

            return model
          } catch (caught) {
            lastError = caught
            setDebugState({
              phase: `loading-model-retry-${attempt}`,
              error: caught instanceof Error ? caught.message : 'unknown-error',
            })
          }
        }

        throw lastError instanceof Error ? lastError : new Error('Live2D model failed to initialize.')
      }

      try {
        setDebugState({ phase: 'booting', error: null, app: null, model: null })
        setError(null)
        setModelReady(false)
        currentExpressionRef.current = null
        activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition)

        await ensureLive2DVendorScripts()

        try {
          const modelResponse = await fetch(resolvedModelPath)
          if (modelResponse.ok) {
            const modelFile = (await modelResponse.json()) as CubismModelFile
            activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition, modelFile)
          }
        } catch {
          activeModelDefinitionRef.current = buildRuntimePetModelDefinition(modelDefinition)
        }

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
        const app = new pixiRuntime.Application({
          autoStart: true,
          resizeTo: containerRef.current,
          backgroundAlpha: 0,
          antialias: true,
        })

        appRef.current = app
        containerRef.current.appendChild(app.view as HTMLCanvasElement)

        const { width, height } = containerRef.current.getBoundingClientRect()
        app.renderer.resize(Math.max(width, MIN_CANVAS_WIDTH), Math.max(height, MIN_CANVAS_HEIGHT))

        const model = await loadModelWithRetry(Live2DModel)
        if (disposed) {
          model.destroy()
          return
        }

        modelRef.current = model
        app.stage.addChild(model)
        app.renderer.render(app.stage)
        setDebugState({ phase: 'model-ready', error: null, app, model })

        layoutModel(model as Live2DModelHandle, app)
        bindModelRuntime(model)
        app.renderer.render(app.stage)
        setModelReady(true)
        frameState.blink = createBlinkState()
        frameState.smoothedGaze = { x: 0, y: 0 }

        resizeObserverRef.current = new ResizeObserver(() => {
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

        resizeObserverRef.current.observe(containerRef.current)
      } catch (caught) {
        console.error('Live2D boot failed:', caught)
        setDebugState({
          phase: 'boot-failed',
          error: caught instanceof Error ? caught.message : 'Live2D failed to load.',
        })
        setError(caught instanceof Error ? caught.message : 'Live2D failed to load.')
        setModelReady(false)
      }
    }

    void boot()

    return () => {
      disposed = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      cleanupBeforeModelUpdateRef.current?.()
      cleanupBeforeModelUpdateRef.current = null
      modelRef.current?.destroy()
      appRef.current?.destroy(true, { children: true, texture: false, baseTexture: false })
      modelRef.current = null
      appRef.current = null
      currentExpressionRef.current = null
      currentExpressionSlotRef.current = 'idle'
      lastMotionKeyRef.current = ''
      lastMotionAtRef.current = 0
      performanceCueRef.current = null
      performanceCueStartedAtRef.current = 0
      frameState.smoothedGaze = { x: 0, y: 0 }
      frameState.blink = createBlinkState()
      setModelReady(false)
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
