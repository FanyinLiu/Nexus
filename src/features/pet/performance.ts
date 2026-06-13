import type { PetExpressionSlot } from './models'

export type PetPerformanceAccent =
  | 'peek'
  | 'search'
  | 'organize'
  | 'write'
  | 'deliver'
  | 'confirm'
  | 'sparkle'
  | 'listen'
  | 'shy'

export type PetPerformancePlan = {
  expressionSlot?: PetExpressionSlot
  motionSlot?: PetExpressionSlot
  // Model-defined gesture name (e.g. 'wave', 'nod'). Looked up in
  // motionGroups.gestures at apply time; unknown names are silent no-ops
  // so personas on gesture-poor models don't break.
  gestureName?: string
  accentStyle?: PetPerformanceAccent
  durationMs: number
  stageDirection: string
}

export type PetPerformanceCue = PetPerformancePlan & {
  id: string
}

type ParsedAssistantPerformance = {
  cue: PetPerformancePlan | null
  cues: PetPerformancePlan[]
  spokenContent: string
  displayContent: string
  stageDirections: string[]
}

type ExtractedStageDirection = {
  plan: PetPerformancePlan | null
  stageDirection: string
  start: number
  end: number
}

type ExtractedPresentationSections = {
  displayContent: string
  spokenContent: string
}

const MAX_PERFORMANCE_CUES = 4

const BRACKETED_DISPLAY_SECTION_PATTERNS = [
  /[（(【[]\s*(?:屏幕展示区|屏幕展示|展示区|展示内容|气泡展示(?:区)?|结果展示(?:区)?)\s*[：:]\s*([\s\S]{1,500}?)\s*[）)】\]]/giu,
]

const BRACKETED_SPOKEN_SECTION_PATTERNS = [
  /[（(【[]\s*(?:语音播报|语音回复|语音内容|播报内容|口头回复)\s*[：:]\s*([\s\S]{1,500}?)\s*[）)】\]]/giu,
]

const INLINE_DISPLAY_SECTION_PATTERNS = [
  /(?:^|\n)\s*(?:屏幕展示区|屏幕展示|展示区|展示内容|气泡展示(?:区)?|结果展示(?:区)?)\s*[：:]\s*([\s\S]{1,500}?)(?=(?:\n\s*(?:语音播报|语音回复|语音内容|播报内容|口头回复)\s*[：:])|\n{2,}|$)/giu,
]

const INLINE_SPOKEN_SECTION_PATTERNS = [
  /(?:^|\n)\s*(?:语音播报|语音回复|语音内容|播报内容|口头回复)\s*[：:]\s*([\s\S]{1,500}?)(?=(?:\n\s*(?:屏幕展示区|屏幕展示|展示区|展示内容|气泡展示(?:区)?|结果展示(?:区)?)\s*[：:])|\n{2,}|$)/giu,
]

function buildKeywordPattern(keywords: string[]) {
  return new RegExp(keywords.join('|'), 'u')
}

// Stage directions are full-width-bracketed asides \u2014 \uFF08\u2026\uFF09/\u3010\u2026\u3011 (the Chinese RP
// convention the model actually uses). ASCII [ ] / ( ) are deliberately NOT
// matched: they show up in code, markdown links, and ordinary parentheticals,
// and treating those as asides would silently strip them from speech / italicize
// them. Full-width only keeps the aside handling from eating real content.
const STAGE_DIRECTION_GLOBAL_PATTERN = /[\uFF08\u3010]([^\uFF09\u3011]{1,32})[\uFF09\u3011]/gu

const SLEEPY_STAGE_PATTERN = buildKeywordPattern([
  '\u56f0\u5026',
  '\u75b2\u60eb',
  '\u6253\u54c8\u6b20',
  '\u660f\u660f\u6b32\u7761',
  '\u7728\u7740\u56f0',
  '\u6ca1\u7cbe\u795e',
  '\u6ca1\u4ec0\u4e48\u7cbe\u795e',
  '\u7741\u773c\u60fa\u5fcc',
  '\u772f\u773c',
])

const TOUCH_BODY_STAGE_PATTERN = buildKeywordPattern([
  '\u51d1\u8fd1',
  '\u9760\u8fd1',
  '\u8d34\u8fd1',
  '\u6271\u8fc7\u6765',
  '\u62b1\u4f4f',
  '\u62e5\u62b1',
  '\u8d34\u7740',
  '\u8e6d\u4e86\u8e6d',
  '\u8f7b\u8f7b\u8e6d',
  '\u6478\u6478',
  '\u5f80\u4f60\u8eab\u8fb9\u9760',
  '\u4fef\u8eab',
])

const TOUCH_FACE_STAGE_PATTERN = buildKeywordPattern([
  '\u5bb3\u7f9e',
  '\u8138\u7ea2',
  '\u7ea2\u7740\u8138',
  '\u62bf\u5634',
  '\u5077\u7b11',
  '\u8f7b\u7b11',
  '\u4fef\u76ae',
  '\u8c03\u76ae',
  '\u7728\u773c',
  '\u843d\u843d\u5927\u65b9\u5730\u7b11',
])

const THINKING_STAGE_PATTERN = buildKeywordPattern([
  '\u6b6a\u5934',
  '\u5fae\u5fae\u6b6a\u5934',
  '\u8f7b\u8f7b\u6b6a\u5934',
  '\u504f\u5934',
  '\u7591\u60d1',
  '\u56f0\u60d1',
  '\u82e5\u6709\u6240\u601d',
  '\u6c89\u541f',
  '\u601d\u7d22',
  '\u601d\u8003',
  '\u8ba4\u771f\u60f3',
  '\u60f3\u4e86\u60f3',
  '\u7406\u4e86\u7406\u601d\u8def',
])

const HAPPY_STAGE_PATTERN = buildKeywordPattern([
  '\u5f00\u5fc3',
  '\u9ad8\u5174',
  '\u5174\u594b',
  '\u96c0\u8dc3',
  '\u5fae\u5fae\u4e00\u7b11',
  '\u5fae\u7b11',
  '\u8f7b\u8f7b\u7b11\u4e86\u7b11',
  '\u7b11\u772f\u772f',
  '\u7b11\u7740',
  '\u6ee1\u8138\u7b11\u610f',
  '\u773c\u775b\u5fae\u5fae\u53d1\u4eae',
  '\u773c\u775b\u4eae\u8d77\u6765',
  '\u773c\u7738\u5fae\u4eae',
  '\u773c\u775b\u53d1\u4eae',
  '\u773c\u775b\u4eae\u6676\u6676',
  '\u773c\u775b\u4eae\u4e86',
  '\u773c\u775b\u4e00\u4eae',
  '\u773c\u524d\u4e00\u4eae',
  '\u70b9\u5934',
  '\u8f7b\u8f7b\u70b9\u5934',
  '\u8fde\u8fde\u70b9\u5934',
  '\u70b9\u70b9\u5934',
])

const LISTENING_STAGE_PATTERN = buildKeywordPattern([
  '\u8ba4\u771f\u542c',
  '\u4fa7\u8033\u503e\u542c',
  '\u5b89\u9759\u5730\u770b\u7740',
  '\u5b89\u9759\u770b\u7740',
  '\u6ce8\u89c6',
  '\u671b\u7740',
  '\u51dd\u89c6',
  '\u4e13\u6ce8\u5730\u770b',
  '\u4e13\u5fc3\u542c',
])

const SURPRISED_STAGE_PATTERN = buildKeywordPattern([
  '吃惊',
  '惊讶',
  '惊了',
  '大吃一惊',
  '瞪大眼睛',
  '瞪大了眼',
  '眼睛瞪大',
  '不敢相信',
  '震惊',
  '目瞪口呆',
  '愣住',
  '愣了一下',
  '一愣',
])

const CONFUSED_STAGE_PATTERN = buildKeywordPattern([
  '不解',
  '迷茫',
  '茫然',
  '不太明白',
  '不太理解',
  '摸不着头脑',
  '一头雾水',
  '问号',
  '满头问号',
  '搞不懂',
  '纳闷',
])

const EMBARRASSED_STAGE_PATTERN = buildKeywordPattern([
  '不好意思',
  '难为情',
  '尴尬',
  '羞涩',
  '局促',
  '红了脸',
  '低下头',
  '不敢看',
  '心虚',
  '手足无措',
])

const PEEK_STAGE_PATTERN = buildKeywordPattern([
  '\u51d1\u8fd1\u5c4f\u5e55',
  '\u51d1\u8fd1',
  '\u9760\u8fd1',
  '\u8d34\u8fd1',
  '\u63a2\u5934',
  '\u63a2\u8fc7\u6765',
  '\u51d1\u8fc7\u6765',
  '\u8d34\u5230\u5c4f\u5e55\u524d',
])

const SEARCH_STAGE_PATTERN = buildKeywordPattern([
  '\u67e5\u627e\u8d44\u6599',
  '\u67e5\u770b\u8d44\u6599',
  '\u7ffb\u770b\u8d44\u6599',
  '\u5bf9\u7167\u8d44\u6599',
  '\u641c\u7d22',
  '\u641c\u5bfb',
  '\u68c0\u7d22',
  '\u67e5\u627e',
  '\u67e5\u770b',
  '\u7ffb\u9605',
  '\u6d4f\u89c8',
  '\u5bf9\u7167',
  '\u6838\u5bf9',
  '\u5bfb\u627e',
])

const ORGANIZE_STAGE_PATTERN = buildKeywordPattern([
  '\u6574\u7406\u8d44\u6599',
  '\u6574\u7406\u7b14\u8bb0',
  '\u6574\u7406\u6587\u6863',
  '\u6574\u7406',
  '\u5f52\u7c7b',
  '\u5f52\u6863',
  '\u6536\u62fe',
  '\u7ffb\u9875',
  '\u6446\u653e',
  '\u6392\u597d',
])

const WRITE_STAGE_PATTERN = buildKeywordPattern([
  '\u8bb0\u5f55',
  '\u8bb0\u4e0b',
  '\u5199\u4e0b',
  '\u6253\u5b57',
  '\u6572\u952e\u76d8',
  '\u6572\u51fb\u952e\u76d8',
  '\u8f93\u5165',
  '\u7f16\u8f91',
  '\u5199\u5165',
  '\u8d77\u8349',
  '\u751f\u6210\u6587\u6863',
  '\u5199\u597d',
  '\u5b8c\u5584\u5185\u5bb9',
])

const DELIVER_STAGE_PATTERN = buildKeywordPattern([
  '\u53d1\u5230\u684c\u9762',
  '\u653e\u5230\u684c\u9762',
  '\u653e\u5728\u684c\u9762',
  '\u9012\u7ed9',
  '\u4ea4\u7ed9',
  '\u53d1\u9001',
  '\u63d0\u4ea4',
  '\u8d34\u5230',
  '\u653e\u597d',
  '\u5b89\u6392\u597d',
])

const CONFIRM_STAGE_PATTERN = buildKeywordPattern([
  '\u8f7b\u8f7b\u70b9\u5934',
  '\u8fde\u8fde\u70b9\u5934',
  '\u70b9\u70b9\u5934',
  '\u70b9\u5934',
  '\u786e\u8ba4',
  '\u6bd4\u4e86\u4e2aok',
  '\u6bd4\u4e86\u4e2aOK',
  '\u6bd4\u4e2aok',
  '\u6bd4\u4e2aOK',
])

const SPARKLE_STAGE_PATTERN = buildKeywordPattern([
  '\u773c\u775b\u5fae\u5fae\u53d1\u4eae',
  '\u773c\u775b\u4eae\u8d77\u6765',
  '\u773c\u7738\u5fae\u4eae',
  '\u773c\u775b\u53d1\u4eae',
  '\u773c\u775b\u4eae\u6676\u6676',
  '\u661f\u661f\u773c',
])

function resolveAccentStyle(stageDirection: string): PetPerformanceAccent | undefined {
  if (SPARKLE_STAGE_PATTERN.test(stageDirection)) return 'sparkle'
  if (PEEK_STAGE_PATTERN.test(stageDirection)) return 'peek'
  if (SEARCH_STAGE_PATTERN.test(stageDirection)) return 'search'
  if (ORGANIZE_STAGE_PATTERN.test(stageDirection)) return 'organize'
  if (WRITE_STAGE_PATTERN.test(stageDirection)) return 'write'
  if (DELIVER_STAGE_PATTERN.test(stageDirection)) return 'deliver'
  if (LISTENING_STAGE_PATTERN.test(stageDirection)) return 'listen'
  if (CONFIRM_STAGE_PATTERN.test(stageDirection)) return 'confirm'
  if (TOUCH_FACE_STAGE_PATTERN.test(stageDirection)) return 'shy'
  return undefined
}

function resolveExpressionSlot(stageDirection: string, accentStyle?: PetPerformanceAccent): PetExpressionSlot | null {
  if (SLEEPY_STAGE_PATTERN.test(stageDirection)) return 'sleepy'
  if (SURPRISED_STAGE_PATTERN.test(stageDirection)) return 'surprised'
  if (CONFUSED_STAGE_PATTERN.test(stageDirection)) return 'confused'
  if (EMBARRASSED_STAGE_PATTERN.test(stageDirection)) return 'embarrassed'
  if (TOUCH_BODY_STAGE_PATTERN.test(stageDirection)) return 'touchBody'
  if (TOUCH_FACE_STAGE_PATTERN.test(stageDirection)) return 'touchFace'
  if (THINKING_STAGE_PATTERN.test(stageDirection)) return 'thinking'
  if (HAPPY_STAGE_PATTERN.test(stageDirection)) return 'happy'
  if (LISTENING_STAGE_PATTERN.test(stageDirection)) return 'listening'

  switch (accentStyle) {
    case 'peek':
      return 'touchBody'
    case 'search':
    case 'write':
      return 'thinking'
    case 'organize':
    case 'deliver':
    case 'confirm':
    case 'sparkle':
      return 'happy'
    case 'listen':
      return 'listening'
    case 'shy':
      return 'touchFace'
    default:
      return null
  }
}

function resolveMotionSlot(
  expressionSlot: PetExpressionSlot,
  accentStyle?: PetPerformanceAccent,
): PetExpressionSlot | undefined {
  switch (accentStyle) {
    case 'peek':
    case 'organize':
    case 'write':
    case 'deliver':
      return 'touchBody'
    case 'search':
    case 'confirm':
    case 'sparkle':
      return 'touchHead'
    case 'listen':
      return 'listening'
    case 'shy':
      return 'touchFace'
    default:
      break
  }

  switch (expressionSlot) {
    case 'touchHead':
    case 'touchFace':
    case 'touchBody':
      return expressionSlot
    case 'listening':
      return 'listening'
    case 'thinking':
    case 'happy':
      return 'touchHead'
    default:
      return undefined
  }
}

function resolveDurationMs(expressionSlot: PetExpressionSlot, accentStyle?: PetPerformanceAccent) {
  switch (accentStyle) {
    case 'peek':
      return 1_900
    case 'search':
      return 2_500
    case 'organize':
      return 2_250
    case 'write':
      return 2_250
    case 'deliver':
      return 2_100
    case 'confirm':
      return 1_950
    case 'sparkle':
      return 2_150
    case 'listen':
      return 2_100
    case 'shy':
      return 2_150
    default:
      break
  }

  switch (expressionSlot) {
    case 'sleepy':
      return 2_800
    case 'thinking':
      return 2_400
    case 'happy':
      return 2_100
    case 'listening':
      return 2_000
    case 'touchFace':
    case 'touchHead':
    case 'touchBody':
      return 2_200
    default:
      return 2_000
  }
}

function resolvePerformancePlan(stageDirection: string) {
  const accentStyle = resolveAccentStyle(stageDirection)
  const expressionSlot = resolveExpressionSlot(stageDirection, accentStyle)

  if (!expressionSlot) {
    return null
  }

  return {
    expressionSlot,
    motionSlot: resolveMotionSlot(expressionSlot, accentStyle),
    accentStyle,
    durationMs: resolveDurationMs(expressionSlot, accentStyle),
    stageDirection,
  } satisfies PetPerformancePlan
}

function normalizeDisplayContent(content: string) {
  return content
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}

function stripHiddenReasoning(content: string) {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/giu, '')
    .replace(/<thinking\b[^>]*>[\s\S]*?(?:<\/thinking>|$)/giu, '')
    .trim()
}

function extractLabeledSections(content: string, patterns: RegExp[]) {
  const sections: string[] = []
  let remainingContent = content

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    remainingContent = remainingContent.replace(pattern, (_match, body: string) => {
      const normalizedBody = normalizeDisplayContent(body ?? '')
      if (normalizedBody) {
        sections.push(normalizedBody)
      }

      return ' '
    })
  }

  return {
    remainingContent: normalizeDisplayContent(remainingContent),
    sections,
  }
}

function extractPresentationSections(content: string): ExtractedPresentationSections {
  const bracketedDisplay = extractLabeledSections(content, BRACKETED_DISPLAY_SECTION_PATTERNS)
  const inlineDisplay = extractLabeledSections(bracketedDisplay.remainingContent, INLINE_DISPLAY_SECTION_PATTERNS)
  const bracketedSpoken = extractLabeledSections(inlineDisplay.remainingContent, BRACKETED_SPOKEN_SECTION_PATTERNS)
  const inlineSpoken = extractLabeledSections(bracketedSpoken.remainingContent, INLINE_SPOKEN_SECTION_PATTERNS)

  const explicitDisplayContent = normalizeDisplayContent([
    ...bracketedDisplay.sections,
    ...inlineDisplay.sections,
  ].join('\n\n'))
  const explicitSpokenContent = normalizeDisplayContent([
    ...bracketedSpoken.sections,
    ...inlineSpoken.sections,
  ].join('\n\n'))
  const fallbackContent = inlineSpoken.remainingContent

  return {
    displayContent: explicitDisplayContent || fallbackContent || explicitSpokenContent,
    spokenContent: explicitSpokenContent || fallbackContent || explicitDisplayContent,
  }
}

// A bracketed aside that carries a label or note ("语音播报：…", "注：…") is
// structured content, not a stage direction — a colon is the tell. We leave
// those alone so the labeled display/spoken sections keep working and genuine
// notes stay visible and spoken.
function isStructuredBracket(inner: string) {
  return /[：:]/u.test(inner)
}

type StageDirectionSplit = {
  keptContent: string
  strippedContent: string
  cue: PetPerformancePlan | null
  cues: PetPerformancePlan[]
  stageDirections: string[]
}

// Detect short bracketed asides (（…）, (...), 【…】) by SHAPE, not by a keyword
// whitelist — except colon brackets (注：/语音播报：), which are structured
// content and left alone. Then split two ways:
//   • RECOGNISED asides (we have a face cue) are "just an expression": they drive
//     her avatar and are stripped from BOTH display and speech, exactly like
//     before. （眼睛亮了） brightens her face; it is not shown and not spoken.
//   • UNRECOGNISED asides (no cue) are kept in the displayed reply so the bubble
//     can style them as intentional script asides instead of letting them read
//     like leaked text — but they are still stripped from speech.
// Either way nothing leaks as raw text and nothing gets spoken, and a novel cue
// the model invents is handled by shape without anyone editing a list.
function extractStageDirections(content: string): StageDirectionSplit {
  const matches: ExtractedStageDirection[] = []

  STAGE_DIRECTION_GLOBAL_PATTERN.lastIndex = 0

  for (const match of content.matchAll(STAGE_DIRECTION_GLOBAL_PATTERN)) {
    const rawStageDirection = match[1]?.trim()
    const fullMatch = match[0]
    const matchIndex = match.index ?? -1

    if (!rawStageDirection || !fullMatch || matchIndex < 0 || isStructuredBracket(rawStageDirection)) {
      continue
    }

    matches.push({
      plan: resolvePerformancePlan(rawStageDirection),
      stageDirection: rawStageDirection,
      start: matchIndex,
      end: matchIndex + fullMatch.length,
    })
  }

  return {
    // Display keeps unrecognised asides (for styling), strips recognised ones.
    keptContent: normalizeDisplayContent(removeMatches(content, matches.filter((match) => match.plan))),
    // Speech reads no aside aloud — strip them all.
    strippedContent: normalizeDisplayContent(removeMatches(content, matches)),
    cue: matches.find((match) => match.plan)?.plan ?? null,
    cues: matches
      .map((match) => match.plan)
      .filter((plan): plan is PetPerformancePlan => Boolean(plan))
      .slice(0, MAX_PERFORMANCE_CUES),
    stageDirections: matches.map((match) => match.stageDirection),
  }
}

// Cut the given (ordered, non-overlapping) match ranges out of the content.
function removeMatches(content: string, ranges: ExtractedStageDirection[]) {
  let cursor = 0
  const segments: string[] = []
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push(content.slice(cursor, range.start))
    }
    cursor = range.end
  }
  if (cursor < content.length) {
    segments.push(content.slice(cursor))
  }
  return segments.join('')
}

export type DisplaySegment = { stage: boolean; text: string }

// Split displayed assistant text into normal spans and stage-direction spans so
// the bubble can render UNRECOGNISED asides in a muted, intentional style instead
// of letting them read like leaked text. Recognised asides are pure expressions —
// they were already stripped from the displayed content — so they are skipped
// here too, keeping the renderer in agreement with the parser.
export function segmentStageDirections(content: string): DisplaySegment[] {
  const segments: DisplaySegment[] = []

  STAGE_DIRECTION_GLOBAL_PATTERN.lastIndex = 0

  let cursor = 0
  for (const match of content.matchAll(STAGE_DIRECTION_GLOBAL_PATTERN)) {
    const inner = match[1]?.trim()
    const fullMatch = match[0]
    const matchIndex = match.index ?? -1

    if (!inner || !fullMatch || matchIndex < 0 || isStructuredBracket(inner) || resolvePerformancePlan(inner)) {
      continue
    }

    if (matchIndex > cursor) {
      segments.push({ stage: false, text: content.slice(cursor, matchIndex) })
    }
    segments.push({ stage: true, text: fullMatch })
    cursor = matchIndex + fullMatch.length
  }

  if (cursor < content.length) {
    segments.push({ stage: false, text: content.slice(cursor) })
  }

  return segments
}

export function parseAssistantPerformanceContent(content: string): ParsedAssistantPerformance {
  const trimmedContent = stripHiddenReasoning(content.trim())
  const { keptContent, strippedContent, cue, cues, stageDirections } = extractStageDirections(trimmedContent)
  const displaySections = extractPresentationSections(keptContent)
  const spokenSections = extractPresentationSections(strippedContent)

  return {
    cue,
    cues,
    displayContent: displaySections.displayContent,
    stageDirections,
    spokenContent: spokenSections.spokenContent,
  }
}

// ── Inline performance tags ────────────────────────────────────────────────
//
// LLMs can emit inline `[expr:name]`, `[motion:name]`, `[tts:mode]`, and
// `[recall:memId]` markers — SillyTavern- / ChatdollKit-style. expr / motion
// / tts are ephemeral one-shot cues that don't persist into the emotion
// model. `recall` flags that the LLM is intentionally referencing a
// callback-pending memory; the chat layer uses it to mark the bubble with
// a "recalled from <date>" affordance and consume the pending callback so
// it doesn't get re-suggested.
//
// `expr` accepts the seven "speakable" PetMood slots. `motion` accepts
// gesture names declared on the active pet model (validated at apply
// time, not here). `tts` is parsed here but currently collected-and-
// dropped — wiring will land when an emotion-aware TTS adapter does.
// `recall` value is a memory id (alphanumeric + hyphen).
const PERFORMANCE_TAG_PATTERN = /\[(expr|motion|tts|recall|mood)\s*:\s*([a-zA-Z0-9_-]+)\s*\]/giu
const EXPRESSION_OVERRIDE_DURATION_MS = 2_400
const PUBLIC_EXPRESSION_SLOTS: ReadonlySet<PetExpressionSlot> = new Set([
  'idle', 'thinking', 'happy', 'sleepy', 'surprised', 'confused', 'embarrassed',
])

const TAG_KEYS = ['expr', 'motion', 'tts', 'recall', 'mood'] as const

export type MotionCue = {
  gestureName: string
  stageDirection: string
}

export type TtsCue = {
  mode: string
  stageDirection: string
}

export type RecallCue = {
  memoryId: string
  stageDirection: string
}

/**
 * `[mood:<word>-<0-9>]` — the model's read of the USER's emotional state,
 * appended invisibly at the end of a reply (the deep-emotion channel that
 * regex keyword matching can never reach: "我今天被裁了" carries no sad
 * keyword). Intensity defaults to 5 when omitted. Unknown words drop.
 */
export type MoodReadCue = { mood: UserMoodWord; intensity: number; stageDirection: string }

export const USER_MOOD_WORDS = [
  'happy', 'excited', 'calm', 'neutral', 'tired', 'sad', 'anxious', 'frustrated', 'angry',
] as const
export type UserMoodWord = (typeof USER_MOOD_WORDS)[number]
const USER_MOOD_WORD_SET = new Set<string>(USER_MOOD_WORDS)

export type ExtractedPerformanceTags = {
  content: string
  exprCues: PetPerformancePlan[]
  motionCues: MotionCue[]
  ttsCues: TtsCue[]
  recallCues: RecallCue[]
  moodCues: MoodReadCue[]
}

/**
 * Pull every `[expr|motion|tts:name]` tag out of raw LLM text. Returns
 * the stripped text (tags removed entirely, whether the slot was valid
 * or not, so no leakage into chat bubbles) plus per-kind cue lists.
 * Unknown `expr` slot names drop silently — we prefer quiet no-ops to
 * visible noise. Motion / tts values pass through as strings; the apply
 * site decides whether the current model / tts adapter supports them.
 */
export function extractPerformanceTags(content: string): ExtractedPerformanceTags {
  if (!content) {
    return { content: '', exprCues: [], motionCues: [], ttsCues: [], recallCues: [], moodCues: [] }
  }
  const exprCues: PetPerformancePlan[] = []
  const motionCues: MotionCue[] = []
  const ttsCues: TtsCue[] = []
  const recallCues: RecallCue[] = []
  const moodCues: MoodReadCue[] = []
  const cleaned = content.replace(PERFORMANCE_TAG_PATTERN, (_match, rawKind: string, rawValue: string) => {
    const kind = String(rawKind ?? '').toLowerCase().trim()
    // Note: only lower-case for kind. Memory ids preserve original case for
    // `recall` since createId uses base36 which is case-sensitive.
    const lowerValue = String(rawValue ?? '').toLowerCase().trim()
    const rawTrimmed = String(rawValue ?? '').trim()
    if (!rawTrimmed) return ''
    if (kind === 'expr') {
      const slot = lowerValue as PetExpressionSlot
      if (PUBLIC_EXPRESSION_SLOTS.has(slot)) {
        exprCues.push({
          expressionSlot: slot,
          durationMs: EXPRESSION_OVERRIDE_DURATION_MS,
          stageDirection: `(expr:${slot})`,
        })
      }
    } else if (kind === 'motion') {
      motionCues.push({ gestureName: lowerValue, stageDirection: `(motion:${lowerValue})` })
    } else if (kind === 'tts') {
      ttsCues.push({ mode: lowerValue, stageDirection: `(tts:${lowerValue})` })
    } else if (kind === 'recall') {
      recallCues.push({ memoryId: rawTrimmed, stageDirection: `(recall:${rawTrimmed})` })
    } else if (kind === 'mood') {
      // `sad-7` → word + intensity; bare `sad` → intensity 5.
      const dash = lowerValue.lastIndexOf('-')
      const maybeIntensity = dash >= 0 ? Number(lowerValue.slice(dash + 1)) : NaN
      const hasIntensity = dash >= 0 && Number.isInteger(maybeIntensity) && maybeIntensity >= 0 && maybeIntensity <= 9
      const word = hasIntensity ? lowerValue.slice(0, dash) : lowerValue
      if (USER_MOOD_WORD_SET.has(word)) {
        moodCues.push({
          mood: word as UserMoodWord,
          intensity: hasIntensity ? maybeIntensity : 5,
          stageDirection: `(mood:${lowerValue})`,
        })
      }
    }
    return ''
  })
  return { content: cleaned, exprCues, motionCues, ttsCues, recallCues, moodCues }
}

/**
 * Backwards-compatible shim for call sites that only care about expr cues.
 */
export function extractExpressionOverrides(content: string): {
  content: string
  cues: PetPerformancePlan[]
} {
  const { content: cleaned, exprCues } = extractPerformanceTags(content)
  return { content: cleaned, cues: exprCues }
}

// Stateful prefix-match for the streaming filter. A buffer that starts with
// `[` could still grow into a valid performance tag; until we know for sure,
// we must hold it back from the UI bubble and TTS. Returns true while the
// buffer remains a plausible prefix of `[expr:`, `[motion:`, or `[tts:`.
function isPerformanceTagPrefix(buffer: string): boolean {
  if (!buffer.startsWith('[')) return false
  if (buffer === '[') return true
  const afterBracket = buffer.slice(1).toLowerCase()
  for (const key of TAG_KEYS) {
    if (key.startsWith(afterBracket)) return true
    if (afterBracket.startsWith(key)) {
      const rest = afterBracket.slice(key.length)
      if (/^\s*(?::\s*[a-zA-Z0-9_-]*\s*)?$/i.test(rest)) return true
    }
  }
  return false
}

/**
 * Streaming companion to extractPerformanceTags. The final reply gets
 * scrubbed before it lands in chat history, but streaming deltas are
 * sent straight to the pet dialog bubble AND the TTS pipeline —
 * without this filter, `[expr:happy]` would flash on screen and get
 * pronounced character-by-character over the user's speakers.
 *
 * Holds back any buffer suffix that could still grow into a tag, strips
 * completed tags, and passes everything else through verbatim.
 */
export class PerformanceTagStreamFilter {
  private buffer = ''

  push(delta: string): string {
    if (!delta) return ''
    this.buffer += delta
    return this.drain(false)
  }

  flush(): string {
    return this.drain(true)
  }

  private drain(forceFlush: boolean): string {
    this.buffer = this.buffer.replace(PERFORMANCE_TAG_PATTERN, '')

    if (forceFlush) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    const lastOpenIdx = this.buffer.lastIndexOf('[')
    if (lastOpenIdx === -1) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    const suffix = this.buffer.slice(lastOpenIdx)
    // A runaway suffix (no closing `]` after many chars) is almost certainly
    // not a tag — flush it so the bubble doesn't appear stuck.
    const MAX_SUFFIX_LOOKAHEAD = 64
    if (suffix.length >= MAX_SUFFIX_LOOKAHEAD || !isPerformanceTagPrefix(suffix)) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    const out = this.buffer.slice(0, lastOpenIdx)
    this.buffer = suffix
    return out
  }
}

/**
 * Backwards-compatible alias for the older class name.
 */
export { PerformanceTagStreamFilter as ExpressionOverrideStreamFilter }

const STAGE_DIRECTION_OPEN_CHARS = '（【'

/**
 * Streaming counterpart of the speech-side aside strip: removes complete
 * bracketed stage directions from the TTS delta stream and holds back a
 * trailing partial "（…" until it closes (or clearly isn't an aside), so the
 * voice never speaks an aside even mid-stream. Display keeps the asides; only
 * this speech stream drops them. Mirrors PerformanceTagStreamFilter.
 */
export class StageDirectionStreamFilter {
  private buffer = ''

  push(delta: string): string {
    if (!delta) return ''
    this.buffer += delta
    return this.drain(false)
  }

  flush(): string {
    return this.drain(true)
  }

  private drain(forceFlush: boolean): string {
    STAGE_DIRECTION_GLOBAL_PATTERN.lastIndex = 0
    this.buffer = this.buffer.replace(
      STAGE_DIRECTION_GLOBAL_PATTERN,
      (full: string, inner: string) => (isStructuredBracket(inner.trim()) ? full : ''),
    )

    if (forceFlush) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    let lastOpenIdx = -1
    for (const ch of STAGE_DIRECTION_OPEN_CHARS) {
      lastOpenIdx = Math.max(lastOpenIdx, this.buffer.lastIndexOf(ch))
    }
    if (lastOpenIdx === -1) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    // A runaway open bracket (no close after more than a stage direction's worth
    // of text) is almost certainly not an aside — release it so speech doesn't
    // stall waiting for a close that never comes.
    const suffix = this.buffer.slice(lastOpenIdx)
    const MAX_SUFFIX_LOOKAHEAD = 40
    if (suffix.length >= MAX_SUFFIX_LOOKAHEAD) {
      const out = this.buffer
      this.buffer = ''
      return out
    }

    const out = this.buffer.slice(0, lastOpenIdx)
    this.buffer = suffix
    return out
  }
}
