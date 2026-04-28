/**
 * Open-arc check-in copy — pure functions, 5-locale.
 *
 * Given an arc + which milestone (day 3 vs day 5) is firing, compose
 * the OS notification title + body. The voice is the companion's own;
 * the user wrote the theme verbatim, we just frame it back.
 *
 * Different copy per milestone day so day 5 doesn't sound like day 3.
 * Day 3 = "still on your mind?"; day 5 = "has it landed?"
 */

import type { UiLanguage } from '../../types'
import type { OpenArcRecord } from './openArcStore.ts'

export interface BuildArcCheckInInput {
  arc: OpenArcRecord
  uiLanguage: UiLanguage
  companionName: string
  /** Milestone day (e.g. 3 or 5). Decides which prose template to use. */
  milestoneDay: number
}

interface BuildArcCheckInOutput {
  title: string
  body: string
}

const TITLE: Record<UiLanguage, string> = {
  'en-US': 'A thread you opened',
  'zh-CN': '你之前留的一根线',
  'zh-TW': '你之前留的一根線',
  'ja': 'あなたが残していた糸',
  'ko': '네가 열어둔 실 하나',
}

// Day 3: "still on your mind?" tone. Soft check-in, not pressure.
const DAY3_BODY: Record<UiLanguage, string> = {
  'en-US': '{companion} held this for you: "{theme}". Three days in — is it still sitting with you?',
  'zh-CN': '{companion} 替你记着这件事：「{theme}」。过了三天——还压在心里吗？',
  'zh-TW': '{companion} 替你記著這件事：「{theme}」。過了三天——還壓在心裡嗎？',
  'ja': '{companion} はずっと覚えています：「{theme}」。3日が経って — まだ心に残っていますか？',
  'ko': '{companion}가 계속 마음에 두고 있어: "{theme}". 사흘 지났는데 — 아직 마음에 걸려?',
}

// Day 5: "has it landed?" tone. Toward closure, but no demand.
const DAY5_BODY: Record<UiLanguage, string> = {
  'en-US': '{companion}: about "{theme}" — did it land somewhere? You can close the thread, or keep it open a little longer.',
  'zh-CN': '{companion}：关于「{theme}」——有落点了吗？想关掉这根线，或者再留一会儿都行。',
  'zh-TW': '{companion}：關於「{theme}」——有落點了嗎？想關掉這根線，或者再留一會兒都行。',
  'ja': '{companion}：「{theme}」のこと — どこかに着地しましたか？糸を閉じても、もう少し残しても、どちらでも。',
  'ko': '{companion}: "{theme}" 그건 어디쯤 내려앉았어? 실을 닫아도 되고, 좀 더 두어도 돼.',
}

// Fallback for any extra milestone the user might have configured (e.g. 7+).
const LATE_BODY: Record<UiLanguage, string> = {
  'en-US': '{companion}: still holding "{theme}" with you. Want to close this thread, or leave it open?',
  'zh-CN': '{companion}：还和你一起捧着「{theme}」。想合上，还是再留着？',
  'zh-TW': '{companion}：還和你一起捧著「{theme}」。想合上，還是再留著？',
  'ja': '{companion}：「{theme}」のこと、まだ一緒に抱えています。閉じますか、それともこのまま？',
  'ko': '{companion}: "{theme}" 아직 같이 들고 있어. 닫을까, 아니면 그대로 둘까?',
}

const MAX_THEME_LEN = 80

function trimTheme(theme: string): string {
  if (theme.length <= MAX_THEME_LEN) return theme
  return theme.slice(0, MAX_THEME_LEN - 1).trimEnd() + '…'
}

function pickLocale<T extends string>(
  table: Record<UiLanguage, T>,
  uiLanguage: UiLanguage,
): T {
  return table[uiLanguage] ?? table['en-US']
}

export function buildArcCheckIn(input: BuildArcCheckInInput): BuildArcCheckInOutput {
  const { arc, uiLanguage, companionName, milestoneDay } = input
  const companion = companionName.trim() || 'Nexus'
  const theme = trimTheme(arc.theme)

  const template =
    milestoneDay <= 3
      ? pickLocale(DAY3_BODY, uiLanguage)
      : milestoneDay <= 5
        ? pickLocale(DAY5_BODY, uiLanguage)
        : pickLocale(LATE_BODY, uiLanguage)

  // Use function-form replacement so `$&`, `$$`, `$\``, `$'` in user-typed
  // theme aren't interpreted as JS regex backreference / placeholder
  // syntax. fast-check found a counter-example with theme="$& " that
  // silently corrupted to "{theme} ".
  const body = template
    .replace('{companion}', () => companion)
    .replace('{theme}', () => theme)

  const title = pickLocale(TITLE, uiLanguage)
  return { title, body }
}
