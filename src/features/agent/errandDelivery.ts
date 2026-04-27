/**
 * Build the morning-bracket notification body when an overnight errand
 * was completed. Companion-voice phrasing in 5 locales — short, warm,
 * gestures at the prompt the user originally asked, and ends with an
 * invitation to read the full result in the chat panel.
 *
 * Pure: takes prompt + result + locale, returns a single string ≤220
 * chars. The full result text stays in the errand store; the chat
 * surface (when the user opens it) sees it via the assistant prompt
 * pipeline.
 */

import type { UiLanguage } from '../../types'

const PROMPT_SNIPPET_MAX = 60
const RESULT_SNIPPET_MAX = 90

interface LocaleCopy {
  format: (companionName: string, promptSnippet: string, resultSnippet: string) => string
}

const COPY_BY_LOCALE: Record<string, LocaleCopy> = {
  'en-US': {
    format: (name, prompt, result) =>
      `${name}: I looked into "${prompt}" overnight. ${result} — open the panel to see the full notes.`,
  },
  'zh-CN': {
    format: (_name, prompt, result) =>
      `昨晚我帮你研究了"${prompt}"。${result} —— 打开面板看完整记录吧。`,
  },
  'zh-TW': {
    format: (_name, prompt, result) =>
      `昨晚我幫你研究了「${prompt}」。${result} —— 打開面板看完整記錄吧。`,
  },
  'ja': {
    format: (_name, prompt, result) =>
      `昨夜「${prompt}」について調べておきました。${result} —— パネルを開くと全文を見られます。`,
  },
  'ko': {
    format: (_name, prompt, result) =>
      `어젯밤에 "${prompt}"에 대해 알아봤어요. ${result} —— 패널을 열면 전체 내용을 볼 수 있어요.`,
  },
}

function trim(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (single.length <= max) return single
  return single.slice(0, max - 1) + '…'
}

export interface BuildErrandDeliveryBodyInput {
  uiLanguage: UiLanguage
  companionName: string
  prompt: string
  result: string
}

export function buildErrandDeliveryBody(input: BuildErrandDeliveryBodyInput): string {
  const copy = COPY_BY_LOCALE[input.uiLanguage] ?? COPY_BY_LOCALE['en-US']
  const name = input.companionName?.trim() || 'Nexus'
  const prompt = trim(input.prompt, PROMPT_SNIPPET_MAX)
  const result = trim(input.result, RESULT_SNIPPET_MAX) || '—'
  return copy.format(name, prompt, result)
}
