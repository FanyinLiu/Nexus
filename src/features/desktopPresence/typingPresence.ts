// Live2D reaction to aggregate typing activity. Intensity is a rate, never
// a key. Official models (Mao, Haru, Hiyori) have no typing motion, so the
// rig offsets below ride parameters every model already declares. A one-shot
// interaction motion, when the model has one, is fired by the canvas.

import type { TranslationKey } from '../../types/index.ts'
import { clamp } from '../../lib/common.ts'

export type DesktopTypingPermission = 'granted' | 'denied' | 'unavailable' | 'not-applicable'

const TYPING_STATUS_MESSAGE_KEYS = [
  'settings.window.typing_status_running',
  'settings.window.typing_status_off',
  'settings.window.typing_permission_denied',
  'settings.window.typing_unavailable',
  'settings.window.typing_linux_wayland',
  'settings.window.typing_linux_permission',
  'settings.window.typing_linux_unavailable',
] as const satisfies readonly TranslationKey[]

const TYPING_STATUS_RECOMMENDATION_KEYS = [
  'settings.window.typing_awareness_hint',
  'settings.window.typing_permission_denied_hint',
  'settings.window.typing_unavailable_hint',
  'settings.window.typing_linux_wayland_hint',
  'settings.window.typing_linux_permission_hint',
  'settings.window.typing_linux_unavailable_hint',
] as const satisfies readonly TranslationKey[]

export type DesktopTypingStatus = {
  running: boolean
  permission: DesktopTypingPermission
  platform: string
  messageKey: (typeof TYPING_STATUS_MESSAGE_KEYS)[number]
  recommendationKey: (typeof TYPING_STATUS_RECOMMENDATION_KEYS)[number]
}

const PERMISSIONS = new Set<DesktopTypingPermission>(['granted', 'denied', 'unavailable', 'not-applicable'])

function isMessageKey(value: unknown): value is DesktopTypingStatus['messageKey'] {
  return typeof value === 'string' && (TYPING_STATUS_MESSAGE_KEYS as readonly string[]).includes(value)
}

function isRecommendationKey(value: unknown): value is DesktopTypingStatus['recommendationKey'] {
  return typeof value === 'string' && (TYPING_STATUS_RECOMMENDATION_KEYS as readonly string[]).includes(value)
}

/**
 * Normalize a main-process status object. A missing hook or a garbled
 * payload becomes "unavailable" so the settings screen can explain it
 * without throwing.
 */
export function readTypingStatus(value: unknown): DesktopTypingStatus {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const permission = PERMISSIONS.has(record.permission as DesktopTypingPermission)
    ? record.permission as DesktopTypingPermission
    : 'unavailable'
  return {
    running: record.running === true,
    permission,
    platform: typeof record.platform === 'string' ? record.platform : '',
    messageKey: isMessageKey(record.messageKey)
      ? record.messageKey
      : permission === 'denied'
        ? 'settings.window.typing_permission_denied'
        : permission === 'granted'
          ? 'settings.window.typing_status_running'
          : permission === 'not-applicable'
            ? 'settings.window.typing_status_off'
            : 'settings.window.typing_unavailable',
    recommendationKey: isRecommendationKey(record.recommendationKey)
      ? record.recommendationKey
      : permission === 'denied'
        ? 'settings.window.typing_permission_denied_hint'
        : permission === 'unavailable'
          ? 'settings.window.typing_unavailable_hint'
          : 'settings.window.typing_awareness_hint',
  }
}

/** Map keys in the last second onto 0..1. Eight keys/sec is a full reaction. */
export function typingIntensityFromRate(keysPerSecond: number): number {
  if (!Number.isFinite(keysPerSecond) || keysPerSecond <= 0) return 0
  return clamp(keysPerSecond / 8, 0, 1)
}

export type TypingPresenceOffset = {
  bodyAngleX: number
  angleZ: number
  mouthOpen: number
  gazeYBias: number
  breath: number
}

/**
 * Parameter offsets that scale with typing intensity. Zero intensity is the
 * idle rig, so a short pause returns the model without a latched pose.
 */
export function typingPresenceOffset(intensity: number, seconds: number): TypingPresenceOffset {
  const level = clamp(intensity, 0, 1)
  if (level <= 0) {
    return { bodyAngleX: 0, angleZ: 0, mouthOpen: 0, gazeYBias: 0, breath: 0 }
  }
  const rate = 8 + level * 14
  const pulse = Math.sin(seconds * rate)
  const tap = Math.max(0, Math.sin(seconds * rate * 2))
  return {
    bodyAngleX: pulse * (1.2 + level * 2.4),
    angleZ: pulse * (0.6 + level * 1.4),
    mouthOpen: tap * (0.04 + level * 0.12),
    gazeYBias: 0.12 + level * 0.08,
    breath: 0.04 + level * 0.06,
  }
}

/**
 * Skip a React render unless the gesture boundary or the integer rate changed.
 */
export function shouldPublishTypingActivity(
  previous: { active: boolean; keysPerSecond: number },
  next: { active: boolean; keysPerSecond: number },
): boolean {
  if (previous.active !== next.active) return true
  return Math.round(previous.keysPerSecond) !== Math.round(next.keysPerSecond)
}
