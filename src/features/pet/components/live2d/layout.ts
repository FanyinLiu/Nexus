// Pure layout helper that computes the model's scale, anchor, and (x, y)
// position inside the PIXI Application based on the active model definition,
// the renderer dimensions, and the placement context (pet stage vs panel
// card).  Live2DCanvas calls this from a useCallback wrapper.

import type { PetModelDefinition } from '../../models.ts'
import { clamp } from '../../../../lib/common.ts'
import type { Live2DModelHandle, PixiApplication } from './types.ts'

export const MIN_CANVAS_WIDTH = 280
export const MIN_CANVAS_HEIGHT = 360

export type Live2DPlacement = 'pet-stage' | 'panel-card'

export function layoutLive2DModel(options: {
  model: Live2DModelHandle
  app: PixiApplication
  modelDefinition: PetModelDefinition
  placement: Live2DPlacement
}) {
  const { model, app, modelDefinition, placement } = options
  const bounds = model.getLocalBounds()
  const isPetStagePlacement = placement === 'pet-stage'
  const widthRatio = isPetStagePlacement
    ? Math.max(modelDefinition.layout?.widthRatio ?? 0.74, 0.9)
    : modelDefinition.layout?.widthRatio ?? 0.74
  const heightRatio = isPetStagePlacement
    ? Math.max(modelDefinition.layout?.heightRatio ?? 0.84, 0.96)
    : modelDefinition.layout?.heightRatio ?? 0.84
  const minWidth = isPetStagePlacement
    ? Math.max(modelDefinition.layout?.minWidth ?? 250, 320)
    : modelDefinition.layout?.minWidth ?? 250
  const minHeight = isPetStagePlacement
    ? Math.max(modelDefinition.layout?.minHeight ?? 360, 520)
    : modelDefinition.layout?.minHeight ?? 360

  if (!bounds.width || !bounds.height) {
    throw new Error('Failed to measure the Live2D model.')
  }

  const horizontalInset = isPetStagePlacement ? 12 : 8
  const topInset = isPetStagePlacement
    ? Math.max(
      app.renderer.height * Math.max(modelDefinition.layout?.yOffsetRatio ?? 0.03, 0.08),
      Math.max(modelDefinition.layout?.yOffsetPx ?? 12, 42),
    )
    : Math.max(
      app.renderer.height * (modelDefinition.layout?.yOffsetRatio ?? 0.03),
      modelDefinition.layout?.yOffsetPx ?? 12,
    )
  const bottomInset = isPetStagePlacement ? 10 : 6
  const availableWidth = Math.max(app.renderer.width - horizontalInset * 2, 1)
  const availableHeight = Math.max(app.renderer.height - topInset - bottomInset, 1)
  const maxWidth = Math.min(
    Math.max(app.renderer.width * widthRatio, Math.min(minWidth, availableWidth)),
    availableWidth,
  )
  const maxHeight = Math.min(
    Math.max(app.renderer.height * heightRatio, Math.min(minHeight, availableHeight)),
    availableHeight,
  )
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height)

  model.scale.set(scale)

  const anchorX = clamp(modelDefinition.layout?.anchorX ?? 0.5, 0, 1)
  const anchorY = clamp(modelDefinition.layout?.anchorY ?? 0, 0, 1)

  if (model.anchor) {
    model.anchor.set(anchorX, anchorY)
  }

  model.x = horizontalInset + availableWidth * anchorX
  model.y = topInset + availableHeight * anchorY
}
