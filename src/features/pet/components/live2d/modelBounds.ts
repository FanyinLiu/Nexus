/**
 * Measure the drawn Live2D model in window-relative DIP.
 *
 * The cursor sample the main process publishes is relative to the pet window
 * content. The model is only a part of that transparent window, so proximity
 * must use this rectangle rather than the window bounds. Returns null when the
 * runtime is not measurable yet or the model throws during layout.
 */

import type { MouseNearRect } from '../../../desktopPresence/mouseNear.ts'

type MeasurableModel = {
  getBounds?: () => { x: number; y: number; width: number; height: number }
}

type MeasurableApp = {
  renderer: { screen: { width: number; height: number } }
}

type MeasurableContainer = {
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
}

export function measureLive2DModelBounds(input: {
  model: MeasurableModel | null
  app: MeasurableApp | null
  container: MeasurableContainer | null
}): MouseNearRect | null {
  const { model, app, container } = input
  if (!model?.getBounds || !app || !container) return null
  try {
    const bounds = model.getBounds()
    const rect = container.getBoundingClientRect()
    const screen = app.renderer.screen
    const scaleX = screen.width > 0 ? rect.width / screen.width : 1
    const scaleY = screen.height > 0 ? rect.height / screen.height : 1
    return {
      x: rect.left + bounds.x * scaleX,
      y: rect.top + bounds.y * scaleY,
      width: bounds.width * scaleX,
      height: bounds.height * scaleY,
    }
  } catch {
    return null
  }
}
