/**
 * Decide when a single-texture draft preview may move. A decoded image must
 * match its bounded metadata before motion is available; lifecycle gates never
 * change the user's settings or install the draft as a companion.
 */
import type { PortraitPreview } from '../../../shared/portraitPreview.js'

export type PortraitPreviewMotionInput = {
  preview: PortraitPreview
  decodedWidth: number
  decodedHeight: number
  failed: boolean
  requested: boolean
  active: boolean
  hidden: boolean
  reducedMotion: boolean
}

export function portraitPreviewMotion(input: PortraitPreviewMotionInput) {
  const decoded = input.decodedWidth > 0 && input.decodedHeight > 0
  const valid = decoded && input.decodedWidth === input.preview.width && input.decodedHeight === input.preview.height
  const unavailable = input.failed || (decoded && !valid)
  const canStart = valid && !unavailable && input.active && !input.hidden && !input.reducedMotion
  return {
    unavailable,
    canStart,
    moving: canStart && input.requested,
    messageKey: unavailable ? 'settings.chat.portrait_flow.preview_unavailable'
      : input.reducedMotion ? 'settings.chat.portrait_flow.preview_reduced_motion'
        : canStart && input.requested ? 'settings.chat.portrait_flow.preview_moving'
          : 'settings.chat.portrait_flow.preview_static',
  } as const
}
