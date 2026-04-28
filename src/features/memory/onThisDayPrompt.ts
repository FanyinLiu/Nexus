/**
 * 5-locale prompt hint for on-this-day candidates.
 *
 * Same emotional template as the days-30/100/365 milestones: ask the
 * LLM to weave the reference in only if a moment fits, give explicit
 * permission to skip, and keep the body specific (not "I remember when
 * you said something" but "you said X a year ago"). Caller composes a
 * `[recall:<memoryId>]` tag onto the end so the chat layer can mark
 * the memory consumed downstream.
 */

import type { OnThisDayCandidate, OnThisDayGap } from './onThisDay.ts'

type GapCopyMap = Record<OnThisDayGap, string>

interface LocaleCopy {
  /** Per-gap intro text. `{snippet}` is replaced with a trimmed memory excerpt. */
  intro: GapCopyMap
  /** One-line guidance on how to weave the reference. Suffix to all gaps. */
  guidance: string
}

const COPY_BY_LOCALE: Record<string, LocaleCopy> = {
  'en-US': {
    intro: {
      'year': 'Today is exactly one year since the user said: "{snippet}". Quietly notice this if a moment opens.',
      'half-year': 'Half a year ago today the user said: "{snippet}". You may reference it lightly if it fits the conversation.',
      'month': 'A month ago today the user said: "{snippet}". A soft callback is welcome if natural.',
      'week': 'A week ago today the user said: "{snippet}". You may pick the thread back up if relevant.',
    },
    guidance: 'One sentence, specific, no ceremony. Skip entirely if the conversation is on something else important.',
  },
  'zh-CN': {
    intro: {
      'year': '今天正好是用户一年前说"{snippet}"的日子。如果氛围合适，**安静地**注意到这一点。',
      'half-year': '半年前的今天，用户说过："{snippet}"。如果对话允许，可以轻轻提一下。',
      'month': '一个月前的今天，用户说过："{snippet}"。自然的话可以**轻轻**回响一下。',
      'week': '一周前的今天，用户说过："{snippet}"。如果相关，可以把那条线接回来。',
    },
    guidance: '一句话，具体，不要仪式感。对话正在说别的重要事，就跳过。',
  },
  'zh-TW': {
    intro: {
      'year': '今天正好是用戶一年前說「{snippet}」的日子。如果氛圍合適，**安靜地**注意到這一點。',
      'half-year': '半年前的今天，用戶說過：「{snippet}」。如果對話允許，可以輕輕提一下。',
      'month': '一個月前的今天，用戶說過：「{snippet}」。自然的話可以**輕輕**迴響一下。',
      'week': '一週前的今天，用戶說過：「{snippet}」。如果相關，可以把那條線接回來。',
    },
    guidance: '一句話，具體，不要儀式感。對話正在說別的重要事，就跳過。',
  },
  'ja': {
    intro: {
      'year': '今日でちょうど一年前、ユーザーは「{snippet}」と言っていました。流れが合えば、**静かに**気づいて構いません。',
      'half-year': '半年前の今日、ユーザーは「{snippet}」と言っていました。会話が許せば、軽く触れて大丈夫です。',
      'month': '一ヶ月前の今日、ユーザーは「{snippet}」と言っていました。自然なら**そっと**呼び戻してください。',
      'week': '一週間前の今日、ユーザーは「{snippet}」と言っていました。関係するなら、その糸を拾い直して構いません。',
    },
    guidance: '一文だけ、具体的に、儀式っぽくしない。会話が他の重要な内容なら触れない。',
  },
  'ko': {
    intro: {
      'year': '오늘은 사용자가 1년 전에 "{snippet}"이라고 말했던 바로 그날입니다. 분위기가 맞으면 **조용히** 알아차려도 좋습니다.',
      'half-year': '반년 전 오늘 사용자가 "{snippet}"이라고 했어요. 대화가 허락하면 가볍게 언급해도 괜찮습니다.',
      'month': '한 달 전 오늘 사용자가 "{snippet}"이라고 했어요. 자연스럽다면 **가볍게** 다시 짚어도 좋습니다.',
      'week': '일주일 전 오늘 사용자가 "{snippet}"이라고 했어요. 관련 있으면 그 흐름을 다시 이어도 됩니다.',
    },
    guidance: '한 문장, 구체적으로, 의식적이지 않게. 대화가 다른 중요한 내용이면 건너뜁니다.',
  },
}

const SNIPPET_MAX_CHARS = 120

function trimSnippet(content: string): string {
  const single = content.replace(/\s+/g, ' ').trim()
  if (single.length <= SNIPPET_MAX_CHARS) return single
  return single.slice(0, SNIPPET_MAX_CHARS - 1) + '…'
}

function pickCopy(locale: string): LocaleCopy {
  return COPY_BY_LOCALE[locale] ?? COPY_BY_LOCALE['en-US']
}

/**
 * Render a one-shot prompt hint for an on-this-day candidate, ready to
 * paste into the system prompt assembly. Includes the memory excerpt
 * and a `[recall:<id>]` instruction so the chat layer can consume the
 * callback if the LLM weaves it in.
 */
export function formatOnThisDayPromptHint(
  candidate: OnThisDayCandidate,
  uiLanguage: string,
): string {
  const copy = pickCopy(uiLanguage)
  // Function-form replacement: trimSnippet returns user memory content,
  // which can contain `$&` / `$$` / `$\`` / `$'` — those would be parsed
  // as JS replacement-string placeholders if passed as a string arg.
  const snippet = trimSnippet(candidate.content)
  const intro = copy.intro[candidate.gap].replace('{snippet}', () => snippet)
  const recall = `If you reference it, emit \`[recall:${candidate.memoryId}]\` inline once.`
  return `${intro} ${copy.guidance} ${recall}`
}
