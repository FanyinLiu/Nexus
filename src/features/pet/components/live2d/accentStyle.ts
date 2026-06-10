// Performance-cue accent rendering for the pet model.  When a performance
// cue is active, the canvas overlays an "accent style" (peek/search/organize/
// write/deliver/confirm/sparkle/listen/shy) on top of the base expression
// rig parameters to give the cue a distinctive feel.  All functions here are
// pure — they take inputs and return updated visual state with no side
// effects.

import type { PetPerformanceAccent, PetPerformanceCue } from '../../performance.ts'
import { clamp } from '../../../../lib/common.ts'

export const PERFORMANCE_ACCENT_WINDOW_MS = 1_150

export function resolvePerformanceAccentWindowMs(performanceCue: PetPerformanceCue | null) {
  if (!performanceCue) return PERFORMANCE_ACCENT_WINDOW_MS

  return Math.min(
    Math.max(performanceCue.durationMs * 0.72, 900),
    PERFORMANCE_ACCENT_WINDOW_MS * 1.45,
  )
}

export type AccentVisualState = {
  gazeX: number
  gazeY: number
  angleZ: number
  bodyAngleX: number
  smileLevel: number
  cheekLevel: number
  browFormLevel: number
  breathLevel: number
}

export function applyAccentStyle(options: {
  accentStyle: PetPerformanceAccent
  accentLevel: number
  elapsedMs: number
  pulse: number
  state: AccentVisualState
}) {
  const {
    accentStyle,
    accentLevel,
    elapsedMs,
    pulse,
  } = options
  let {
    gazeX,
    gazeY,
    angleZ,
    bodyAngleX,
    smileLevel,
    cheekLevel,
    browFormLevel,
    breathLevel,
  } = options.state

  const quickPulse = Math.abs(Math.sin(elapsedMs / 1000 * 10.4)) * accentLevel

  switch (accentStyle) {
    case 'peek':
      gazeY = clamp(gazeY - 0.14 * accentLevel, -1, 1)
      angleZ += 2.8 * accentLevel + pulse * 1.8
      bodyAngleX += 4.4 * accentLevel + quickPulse * 2.6
      smileLevel += 0.08 * accentLevel
      break
    case 'search': {
      const scan = Math.sin(elapsedMs / 1000 * 7.4) * accentLevel
      gazeX = clamp(gazeX + scan * 0.8, -1, 1)
      gazeY = clamp(gazeY + 0.16 * accentLevel, -1, 1)
      angleZ += scan * 2.6
      bodyAngleX += scan * 3.8
      browFormLevel -= 0.1 * accentLevel
      breathLevel += 0.04 * accentLevel
      break
    }
    case 'organize': {
      const nod = Math.abs(Math.sin(elapsedMs / 1000 * 8.6)) * accentLevel
      angleZ += pulse * 1.5
      bodyAngleX += nod * 4.4
      smileLevel += 0.14 * accentLevel
      cheekLevel += 0.08 * accentLevel
      breathLevel += 0.06 * accentLevel
      break
    }
    case 'write': {
      const typing = Math.abs(Math.sin(elapsedMs / 1000 * 12.8)) * accentLevel
      gazeX *= 0.38
      gazeY = clamp(gazeY + 0.24 * accentLevel, -1, 1)
      angleZ += pulse * 1.2 - 1.8 * accentLevel
      bodyAngleX += typing * 4.8
      browFormLevel -= 0.08 * accentLevel
      breathLevel += 0.05 * accentLevel
      break
    }
    case 'deliver': {
      const present = Math.sin(elapsedMs / 1000 * 5.2) * accentLevel
      angleZ += 2.2 * accentLevel + present * 1.2
      bodyAngleX += 4.8 * accentLevel + Math.abs(present) * 2.8
      smileLevel += 0.2 * accentLevel
      cheekLevel += 0.12 * accentLevel
      breathLevel += 0.04 * accentLevel
      break
    }
    case 'confirm': {
      const nod = Math.abs(Math.sin(elapsedMs / 1000 * 10.2)) * accentLevel
      angleZ += 1.4 * accentLevel + pulse * 1.4
      bodyAngleX += nod * 5.2
      smileLevel += 0.14 * accentLevel
      cheekLevel += 0.08 * accentLevel
      break
    }
    case 'sparkle':
      gazeY = clamp(gazeY - 0.08 * accentLevel, -1, 1)
      angleZ += 3.2 * accentLevel + pulse * 2.2
      smileLevel += 0.18 * accentLevel
      cheekLevel += 0.18 * accentLevel
      breathLevel += 0.03 * accentLevel
      break
    case 'listen': {
      const lean = Math.sin(elapsedMs / 1000 * 6.5) * accentLevel
      angleZ += lean * 1.6
      bodyAngleX += lean * 2.6
      smileLevel += 0.08 * accentLevel
      break
    }
    case 'shy':
      gazeX *= 0.22
      gazeY = clamp(gazeY + 0.12 * accentLevel, -1, 1)
      angleZ += 2.4 * accentLevel + pulse * 1.6
      smileLevel += 0.14 * accentLevel
      cheekLevel += 0.16 * accentLevel
      break
    default:
      break
  }

  return {
    gazeX,
    gazeY,
    angleZ,
    bodyAngleX,
    smileLevel,
    cheekLevel,
    browFormLevel,
    breathLevel,
  } satisfies AccentVisualState
}
