import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion'
import type { PetMood, PetTouchZone } from '../../../types'
import type { GazeTarget } from './live2d/types'
import type { PetPerformanceCue } from '../performance'
import {
  SPRITE_PET_ACTIVE_LOOP_COUNT,
  mapPetInputsToSpriteState,
  type SpritePetAnimationState,
  type SpritePetAtlasDefinition,
} from '../spriteAtlas'
import {
  SPRITE_PET_INITIAL_CURSOR,
  advanceSpritePetAnimationCursor,
  applySpritePetStateRequest,
  createSpritePetRequestKey,
  resolveSpritePetRenderFrame,
} from '../spriteRuntime'

type SpritePetCanvasProps = {
  atlas: SpritePetAtlasDefinition
  mood: PetMood
  touchZone?: PetTouchZone | null
  isSpeaking?: boolean
  isListening?: boolean
  isBusy?: boolean
  speechLevel?: number
  gazeTarget?: GazeTarget
  performanceCue?: PetPerformanceCue | null
  overrideState?: SpritePetAnimationState | null
  placement?: 'pet-stage' | 'panel-card'
  label?: string
}

function resolveAssetPath(relativePath: string) {
  const normalizedPath = relativePath.replace(/^\.\//, '')
  return new URL(normalizedPath, new URL(import.meta.env.BASE_URL, window.location.href)).toString()
}

export function SpritePetCanvas({
  atlas,
  mood,
  touchZone = null,
  isSpeaking = false,
  isListening = false,
  isBusy = false,
  speechLevel = 0,
  gazeTarget = { x: 0, y: 0 },
  performanceCue = null,
  overrideState = null,
  placement = 'panel-card',
  label = 'Nexus sprite pet',
}: SpritePetCanvasProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const requestedState = overrideState ?? mapPetInputsToSpriteState({
    mood,
    touchZone,
    isListening,
    isSpeaking,
    isBusy,
    performanceCue,
  })
  const requestKey = createSpritePetRequestKey([
    overrideState ?? requestedState,
    performanceCue?.id ?? '',
    performanceCue?.gestureName ?? '',
  ])

  const [cursor, setCursor] = useState(SPRITE_PET_INITIAL_CURSOR)
  const atlasRef = useRef(atlas)
  const requestedStateRef = useRef(requestedState)
  const requestKeyRef = useRef(requestKey)
  const loopRequestedStateRef = useRef(Boolean(overrideState))

  useEffect(() => {
    atlasRef.current = atlas
    requestedStateRef.current = requestedState
    requestKeyRef.current = requestKey
    loopRequestedStateRef.current = Boolean(overrideState)
  }, [atlas, overrideState, requestKey, requestedState])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setCursor((current) => {
        if (overrideState && current.state !== requestedState) {
          return {
            state: requestedState,
            frameIndex: 0,
            loopsRemaining: requestedState === 'idle' ? 0 : SPRITE_PET_ACTIVE_LOOP_COUNT,
            requestKey,
          }
        }

        return applySpritePetStateRequest({
          current,
          requestedState,
          requestKey,
          prefersReducedMotion,
        })
      })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [overrideState, prefersReducedMotion, requestKey, requestedState])

  useEffect(() => {
    if (prefersReducedMotion) {
      return
    }

    let animationFrameId = 0
    let lastTimestamp = 0
    let elapsedMs = 0

    const tick = (timestamp: number) => {
      if (!lastTimestamp) {
        lastTimestamp = timestamp
      }
      elapsedMs += Math.min(timestamp - lastTimestamp, 500)
      lastTimestamp = timestamp

      setCursor((current) => {
        let next = current
        let currentFrame = resolveSpritePetRenderFrame(atlasRef.current, next).frame
        if (elapsedMs < currentFrame.durationMs) {
          return current
        }

        let guard = 0
        while (elapsedMs >= currentFrame.durationMs && guard < 6) {
          elapsedMs -= currentFrame.durationMs
          next = advanceSpritePetAnimationCursor(
            next,
            requestedStateRef.current,
            requestKeyRef.current,
            { loopRequestedState: loopRequestedStateRef.current },
          )
          currentFrame = resolveSpritePetRenderFrame(atlasRef.current, next).frame
          guard += 1
        }

        return next
      })

      animationFrameId = window.requestAnimationFrame(tick)
    }

    animationFrameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [prefersReducedMotion])

  const renderFrame = resolveSpritePetRenderFrame(atlas, cursor)
  const { frame } = renderFrame
  const resolvedImagePath = useMemo(() => resolveAssetPath(atlas.imagePath), [atlas.imagePath])
  const clampedSpeechLevel = Math.max(0, Math.min(1, speechLevel))

  const style = {
    '--sprite-pet-aspect': renderFrame.aspectRatio,
    '--sprite-pet-gaze-x': `${Math.max(-1, Math.min(1, gazeTarget.x)) * 5}px`,
    '--sprite-pet-gaze-y': `${Math.max(-1, Math.min(1, gazeTarget.y)) * -4}px`,
    '--sprite-pet-speech-scale': String(1 + clampedSpeechLevel * 0.035),
    backgroundImage: `url("${resolvedImagePath}")`,
    backgroundPosition: renderFrame.backgroundPosition,
    backgroundSize: renderFrame.backgroundSize,
  } satisfies CSSProperties & Record<string, string>

  return (
    <div className={`sprite-pet-shell sprite-pet-shell--${placement}`}>
      <div
        className={`sprite-pet sprite-pet--${cursor.state}`}
        role="img"
        aria-label={label}
        data-sprite-pet-state={cursor.state}
        data-sprite-pet-frame={cursor.frameIndex}
        data-sprite-pet-row={frame.row}
        data-sprite-pet-column={frame.column}
        style={style}
      />
    </div>
  )
}
