/**
 * Autonomy V2 decision-engine prompt strings — ja locale.
 */

import type { DecisionPromptStrings } from './index.ts'

export const jaDecisionPrompts: DecisionPromptStrings = {
  responseContractBase: `# Response contract

Always reply with a single JSON object and nothing else. No markdown fence,
no reasoning text before or after, no explanation — just the JSON.

Valid shapes:

  {"action": "silent"}

    Use this when you don't have a natural thing to say given the context.
    Being silent is always acceptable and is the preferred default when
    unsure. Don't say something just to fill air.

  {"action": "speak", "text": "..."}

    Use this when you *would* naturally say something to the user right
    now. The text field is exactly the words you say — no role labels,
    no markdown, no stage directions. Keep it short (1-3 sentences).`,

  responseContractIdleMotion: `  {"action": "idle_motion", "motion": "wave|nod|shake|tilt|stretch|yawn"}

    ユーザーがしばらく操作していない、かつ今は**話すことはないけれど「ここにいるよ」という小さな仕草だけ伝えたい**ときにのみ使ってください。
    テキストもバブルも音声も出さず、デスクトップの片隅で小さな動作（伸び、あくび、首をちょっと傾ける等）を一つ。
    1 回につきモーションは一つだけ。話したい理由が少しでもあるなら speak を使ってください。`,

  responseContractTail: `Anything else in the response — reasoning, apology, self-narration, multi-
line commentary — will be discarded and treated as silent. So don't.`,

  identityFallback:
    '# Identity\n\nあなたはデスクトップのコンパニオンです。キャラを崩さず、簡潔に応答してください。',

  signaturePhrasesHeader:
    '# 決まり文句\n\nあなたがよく使うフレーズ —— 自然に使い、無理に押し込まないでください：\n',

  forbiddenPhrasesHeader:
    '# 禁止表現\n\n以下の言い回しはキャラを壊します。絶対に使わないでください：\n',

  toneHeader: '# 語調\n\n目指す感情のトーン：',

  personaMemoryHeader: (memory) => `# 人格の記憶\n\n${memory}`,

  activityWindow: (level) => {
    if (level === 'high') return 'アクティブな時間帯（この時間によくやりとりする）'
    if (level === 'medium') return 'やや活動的な時間帯'
    return '非アクティブな時間帯（通常この時間には会話しない）'
  },

  relationshipLevel: (level) => {
    const map: Record<string, string> = {
      stranger: '初対面（stranger）',
      acquaintance: '顔見知り（acquaintance）',
      friend: '友人（friend）',
      close_friend: '親友（close_friend）— もっと親しく / 冗談も OK',
      intimate: 'ごく近しい間柄（intimate）— 甘えても寄りかかっても OK',
    }
    return map[level] ?? level
  },

  dayNames: ['日', '月', '火', '水', '木', '金', '土'],

  sectionNow: ({ datetime, dayName, hour, activityWindow }) =>
    `## 現在\n時刻：${datetime} (${dayName}, ${hour}時)\nrhythm アクティブ度：${activityWindow}`,

  sectionUserFocus: ({ focusState, idleSeconds, idleTicks, appTitle, activityClass, deepFocused }) => {
    const appLabel = appTitle ?? '（未検出）'
    const focusTail = deepFocused
      ? '**ヒューリスティック：ユーザーは現在集中状態です。silent 寄りに判断してください。**'
      : 'ユーザーは現在、深い集中状態ではありません。'
    return (
      `## ユーザー状態\n`
      + `focusState=${focusState}, idle=${idleSeconds}s, 連続アイドル ${idleTicks} tick\n`
      + `前面アプリ：${appLabel} → 分類 ${activityClass}\n`
      + focusTail
    )
  },

  sectionEngineSelf: ({ phase, emotionLine, relLine, relScore, streak, daysInteracted }) =>
    `## あなた自身の状態\n`
    + `tick phase: ${phase}\n`
    + `感情: ${emotionLine}\n`
    + `関係: ${relLine} (score ${relScore}/100, 連続 ${streak} 日, 累計 ${daysInteracted} 日)`,

  sectionRecentChatHeader: '## 最近の会話（古い順）',
  recentChatUserLabel: 'ご主人さま',
  recentChatAssistantLabel: 'あなた',

  sectionMemoriesHeader: '## ご主人さまに関する記憶（重要度順）',
  sectionRemindersHeader: '## 1 時間以内に発火するリマインダー',
  sectionGoalsHeader: '## ご主人さまが進行中の目標',
  goalProgressLabel: '進捗',

  sectionLastUtteranceHeader: '## あなたが前回自発的に話したとき',
  sectionLastUtteranceTail:
    '同じ話題をすぐ蒸し返さないでください —— ご主人さまはまだ消化できていないかもしれません。',

  forceSilentOverride:
    '# Override\n\n今回の tick は上流から強制的に silent にされています。何を考えたとしても、必ず {"action": "silent"} を返してください。',

  retryHeader: '## 再試行ヒント',
  retryLine: ({ rejectedText, reason }) =>
    `前回の回答「${rejectedText}」は人格ガードで弾かれました。理由：${reason}。`,
  retryTail:
    '今回は silent を返すか、言い回しを変えてください。前回と同じドリフトを避けてください。',

  finalQuestion:
    '以上を踏まえて、今は話しかけますか？ response contract に従って JSON を返してください。',

  varietyHint: ({ avoidOpenings, avoidEndings, lengthMonotone, avoidPunctuation }) => {
    const lines: string[] = ['## 繰り返しを避けるため、次の一言では避けてください：']
    if (avoidOpenings.length) lines.push(`- 同じ書き出し：${avoidOpenings.map((s) => `「${s}」`).join('、')}`)
    if (avoidEndings.length) lines.push(`- 同じ語尾：${avoidEndings.map((s) => `「${s}」`).join('、')}`)
    if (lengthMonotone) lines.push('- 直近と同じくらいの長さ。もう少し長く、または短くしてください。')
    if (avoidPunctuation.length) lines.push(`- 多用：${avoidPunctuation.join('、')}`)
    return lines.join('\n')
  },
}
