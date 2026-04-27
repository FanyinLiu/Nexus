/**
 * Render a delivery notification body for a due future-self capsule.
 *
 * The companion's voice carries the message: she's not the author of
 * the words inside, but she's the one who held them and brings them
 * back. The framing is locale-specific; the user's verbatim message
 * stays inside quotes so the past-self voice and the present-companion
 * voice don't blur.
 */

import type { UiLanguage } from '../../types'
import type { FutureCapsuleRecord } from './futureCapsuleStore.ts'

const MESSAGE_SNIPPET_MAX = 140

interface LocaleCopy {
  /**
   * Format the OS notification body. Receives the days-elapsed integer,
   * the trimmed user message, and the optional title (already trimmed
   * by the caller; empty string when absent).
   */
  format: (params: {
    companionName: string
    daysAgo: number
    message: string
    title: string
  }) => string
}

const COPY_BY_LOCALE: Record<string, LocaleCopy> = {
  'en-US': {
    format: ({ companionName, daysAgo, message, title }) =>
      title
        ? `${companionName}: ${daysAgo} days ago you wrote yourself a note titled "${title}". Reading it back: "${message}"`
        : `${companionName}: ${daysAgo} days ago you wrote a note for today. Reading it back: "${message}"`,
  },
  'zh-CN': {
    format: ({ daysAgo, message, title }) =>
      title
        ? `${daysAgo} 天前你给今天的自己写过一封信，叫《${title}》。让我念给你："${message}"`
        : `${daysAgo} 天前你给今天的自己写过一封信。让我念给你："${message}"`,
  },
  'zh-TW': {
    format: ({ daysAgo, message, title }) =>
      title
        ? `${daysAgo} 天前你給今天的自己寫過一封信，叫《${title}》。讓我念給你：「${message}」`
        : `${daysAgo} 天前你給今天的自己寫過一封信。讓我念給你：「${message}」`,
  },
  'ja': {
    format: ({ daysAgo, message, title }) =>
      title
        ? `${daysAgo} 日前のあなたが今日のあなたへ宛てた手紙「${title}」を預かっていました。読みあげますね：「${message}」`
        : `${daysAgo} 日前のあなたが今日のあなたへ宛てた手紙を預かっていました。読みあげますね：「${message}」`,
  },
  'ko': {
    format: ({ daysAgo, message, title }) =>
      title
        ? `${daysAgo}일 전 당신이 오늘의 당신에게 보낸 편지 "${title}"를 보관해두었어요. 읽어드릴게요: "${message}"`
        : `${daysAgo}일 전 당신이 오늘의 당신에게 보낸 편지를 보관해두었어요. 읽어드릴게요: "${message}"`,
  },
}

export interface BuildDeliveryBodyInput {
  uiLanguage: UiLanguage
  companionName: string
  capsule: FutureCapsuleRecord
  now?: Date
}

export interface BuildDeliveryBodyResult {
  title: string
  body: string
}

const TITLE_BY_LOCALE: Record<string, string> = {
  'en-US': 'A note from your past self',
  'zh-CN': '过去的你给现在的你',
  'zh-TW': '過去的你給現在的你',
  'ja': '過去のあなたから今日のあなたへ',
  'ko': '과거의 당신이 오늘의 당신에게',
}

function trimMessage(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (single.length <= MESSAGE_SNIPPET_MAX) return single
  return single.slice(0, MESSAGE_SNIPPET_MAX - 1) + '…'
}

export function daysBetween(fromIso: string, now: Date): number {
  const fromMs = Date.parse(fromIso)
  if (!Number.isFinite(fromMs)) return 0
  const diffMs = now.getTime() - fromMs
  if (diffMs <= 0) return 0
  return Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)))
}

export function buildFutureCapsuleDelivery(input: BuildDeliveryBodyInput): BuildDeliveryBodyResult {
  const copy = COPY_BY_LOCALE[input.uiLanguage] ?? COPY_BY_LOCALE['en-US']
  const titleLabel = TITLE_BY_LOCALE[input.uiLanguage] ?? TITLE_BY_LOCALE['en-US']
  const now = input.now ?? new Date()
  const daysAgo = daysBetween(input.capsule.createdAt, now)
  const message = trimMessage(input.capsule.message)
  const title = (input.capsule.title ?? '').trim()
  const companionName = input.companionName?.trim() || 'Nexus'
  return {
    title: titleLabel,
    body: copy.format({ companionName, daysAgo, message, title }),
  }
}
