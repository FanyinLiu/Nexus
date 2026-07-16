// Shared Live2D / PIXI runtime type declarations for the pet canvas.
// Pulled out of Live2DCanvas.tsx so the component file can stay focused on
// React state, effects, and JSX.

import type { Live2DModel as Live2DModelType } from 'pixi-live2d-display/cubism4'

export type PixiRuntime = typeof import('pixi.js')
export type PixiApplication = import('pixi.js').Application
export type MotionPreloadValue = number | string

export type GazeTarget = {
  x: number
  y: number
}

export type CubismCoreModel = {
  addParameterValueById?: (parameterId: string, value: number, weight?: number) => void
}

type InternalFocusController = {
  focus: (x: number, y: number, instant?: boolean) => void
}

type InternalEventSource = {
  on?: (eventName: string, handler: () => void) => void
  off?: (eventName: string, handler: () => void) => void
  removeListener?: (eventName: string, handler: () => void) => void
}

export type Live2DInternalModel = InternalEventSource & {
  coreModel?: CubismCoreModel
  focusController?: InternalFocusController
}

export type Live2DModelHandle = Live2DModelType & {
  anchor?: {
    set: (x: number, y: number) => void
  }
  internalModel?: Live2DInternalModel
}

declare global {
  interface Window {
    PIXI?: PixiRuntime & {
      live2d?: {
        MotionPreloadStrategy?: {
          NONE?: MotionPreloadValue
          IDLE?: MotionPreloadValue
          ALL?: MotionPreloadValue
        }
        Live2DModel?: {
          from: (
            source: string,
            options?: {
              autoInteract?: boolean
              autoUpdate?: boolean
              motionPreload?: MotionPreloadValue
            },
          ) => Promise<Live2DModelType>
        }
      }
    }
    Live2DCubismCore?: unknown
    __desktopPetLive2DDebug?: {
      phase?: string
      error?: string | null
      app?: PixiApplication | null
      model?: Live2DModelType | null
      bootStartedAt?: number
      vendorReadyAt?: number
      appCreatedAt?: number
      modelLoadedAt?: number
      modelReadyAt?: number
      firstFrameAt?: number
      attempts?: number
      readyMs?: number
      firstFrameMs?: number
    }
  }
}

export function resolveAssetPath(relativePath: string) {
  const normalizedPath = relativePath.replace(/^\.\//, '')
  return new URL(normalizedPath, new URL(import.meta.env.BASE_URL, window.location.href)).toString()
}
