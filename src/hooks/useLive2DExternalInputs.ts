// Host wiring for the Live2D canvas's externally supplied presence inputs.
// The canvas owns the model refs; this hook owns the mirrors and the one
// bounds publication callback so the component file stays under its size
// budget. Decisions about the glance itself live in desktopPresence.

import { useCallback, useEffect, useRef } from 'react'
import { typingIntensityFromRate } from '../features/desktopPresence/typingPresence.ts'
import { measureLive2DModelBounds } from '../features/pet/components/live2d/modelBounds.ts'
import type { MouseNearGlance, MouseNearRect } from '../features/desktopPresence/mouseNear.ts'

type ModelRef = {
  current: { getBounds?: () => { x: number; y: number; width: number; height: number } } | null
}

type AppRef = {
  current: { renderer: { screen: { width: number; height: number } } } | null
}

type ContainerRef = {
  current: { getBoundingClientRect: () => { left: number; top: number; width: number; height: number } } | null
}

export function useLive2DExternalInputs(input: {
  modelRef: ModelRef
  appRef: AppRef
  containerRef: ContainerRef
  typingActivity?: { active: boolean; keysPerSecond: number }
  mouseNearGlance?: MouseNearGlance | null
  onModelBoundsChange?: (bounds: MouseNearRect | null) => void
}) {
  const typingActive = Boolean(input.typingActivity?.active)
  const typingIntensity = typingActive
    ? typingIntensityFromRate(input.typingActivity?.keysPerSecond ?? 0)
    : 0
  const typingIntensityRef = useRef(0)
  const typingQuietRef = useRef(false)
  const mouseNearGlanceRef = useRef<MouseNearGlance | null>(input.mouseNearGlance ?? null)
  const onModelBoundsChangeRef = useRef(input.onModelBoundsChange)

  useEffect(() => {
    typingIntensityRef.current = typingIntensity
  }, [typingIntensity])

  // Runs before the canvas's later cue/motion effects, so a typing hold
  // blocks every motion start in the same commit that turns the hold on.
  useEffect(() => {
    typingQuietRef.current = typingActive
  }, [typingActive])

  useEffect(() => {
    mouseNearGlanceRef.current = input.mouseNearGlance ?? null
  }, [input.mouseNearGlance])

  useEffect(() => {
    onModelBoundsChangeRef.current = input.onModelBoundsChange
  }, [input.onModelBoundsChange])

  // Leave no stale rectangle behind when the canvas unmounts.
  useEffect(() => () => {
    onModelBoundsChangeRef.current?.(null)
  }, [])

  const publishModelBounds = useCallback(() => {
    const notify = onModelBoundsChangeRef.current
    if (!notify) return
    notify(measureLive2DModelBounds({
      model: input.modelRef.current,
      app: input.appRef.current,
      container: input.containerRef.current,
    }))
  }, [input.appRef, input.containerRef, input.modelRef])

  return {
    typingActive,
    typingIntensity,
    typingIntensityRef,
    typingQuietRef,
    mouseNearGlanceRef,
    publishModelBounds,
  }
}
