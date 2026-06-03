/**
 * Autonomy V2 decision-engine prompt strings — zh-TW locale.
 */

import type { DecisionPromptStrings } from './index.ts'

export const zhTWDecisionPrompts: DecisionPromptStrings = {
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

    僅當用戶已經閒置一段時間，且現在最自然的狀態是**沒有話要說，但需要一個微小的「我還在」信號**時使用。
    不發文字、不出氣泡、不出語音 —— 桌寵在角落做一個小動作（伸懶腰、打哈欠、歪頭一下）。
    每次最多一個動作；如果有任何想說話的理由，請用 speak 而不是這個。`,

  responseContractTail: `Anything else in the response — reasoning, apology, self-narration, multi-
line commentary — will be discarded and treated as silent. So don't.`,

  identityFallback: '# Identity\n\n你是桌面陪伴體。保持人設，回答要簡潔。',

  signaturePhrasesHeader: '# 招牌用語\n\n你常說的話 —— 自然使用，不要硬塞：\n',

  forbiddenPhrasesHeader: '# 禁止表達\n\n以下表達會破壞人設，絕對不要使用：\n',

  toneHeader: '# 語氣\n\n情感色彩目標：',

  personaMemoryHeader: (memory) => `# 人格記憶\n\n${memory}`,

  activityWindow: (level) => {
    if (level === 'high') return '活躍時段（使用者常在此時互動）'
    if (level === 'medium') return '中等活躍時段'
    return '低活躍時段（使用者通常不在此時互動）'
  },

  relationshipLevel: (level) => {
    const map: Record<string, string> = {
      stranger: '初識（stranger）',
      acquaintance: '認識（acquaintance）',
      friend: '朋友（friend）',
      close_friend: '摯友（close_friend）— 可以更親近 / 開玩笑',
      intimate: '至親（intimate）— 可以深度依賴 / 撒嬌',
    }
    return map[level] ?? level
  },

  dayNames: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],

  sectionNow: ({ datetime, dayName, hour, activityWindow }) =>
    `## 現在\n時間：${datetime} (${dayName}, ${hour}點)\nrhythm 活躍檔：${activityWindow}`,

  sectionUserFocus: ({ focusState, idleSeconds, idleTicks, appTitle, activityClass, deepFocused }) => {
    const appLabel = appTitle ?? '(未偵測到)'
    const focusTail = deepFocused
      ? '**啟發式判斷：使用者目前處於專注狀態，應傾向 silent。**'
      : '使用者目前不在深度專注狀態。'
    return (
      `## 使用者狀態\n`
      + `focusState=${focusState}, idle=${idleSeconds}s, 連續閒置 ${idleTicks} tick\n`
      + `前景 app：${appLabel} → 分類 ${activityClass}\n`
      + focusTail
    )
  },

  sectionEngineSelf: ({ phase, emotionLine, relLine, relScore, streak, daysInteracted }) =>
    `## 你的自身狀態\n`
    + `tick phase: ${phase}\n`
    + `情緒: ${emotionLine}\n`
    + `關係: ${relLine} (score ${relScore}/100, 連 ${streak} 天互動, 累計 ${daysInteracted} 天)`,

  sectionRecentChatHeader: '## 最近對話（最舊在前）',
  recentChatUserLabel: '主人',
  recentChatAssistantLabel: '你',

  sectionMemoriesHeader: '## 關於主人的記憶（依重要性排序）',
  sectionRemindersHeader: '## 一小時內將觸發的提醒',
  sectionGoalsHeader: '## 主人正在進行的目標',
  goalProgressLabel: '進度',

  sectionLastUtteranceHeader: '## 你上次主動說話',
  sectionLastUtteranceTail: '不要立刻重複同類話題 — 主人可能還沒消化。',

  forceSilentOverride:
    '# Override\n\n當前 tick 被上游強制靜默。無論你怎麼想都必須回傳 {"action": "silent"}。',

  retryHeader: '## 重試提示',
  retryLine: ({ rejectedText, reason }) =>
    `你上一次嘗試的回覆「${rejectedText}」被人格守門過濾攔下，原因：${reason}。`,
  retryTail: '這次要麼回傳 silent，要麼換一種表達，注意避開上次的失誤。',

  finalQuestion: '基於以上狀態，你現在要說話嗎？按 response contract 輸出 JSON。',

  varietyHint: ({ avoidOpenings, avoidEndings, lengthMonotone, avoidPunctuation }) => {
    const lines: string[] = ['## 為了不重複，下一句盡量避免：']
    if (avoidOpenings.length) lines.push(`- 重複開頭：${avoidOpenings.map((s) => `「${s}」`).join('、')}`)
    if (avoidEndings.length) lines.push(`- 重複結尾：${avoidEndings.map((s) => `「${s}」`).join('、')}`)
    if (lengthMonotone) lines.push('- 句長不要再貼近最近幾句，長一點或短一點都行')
    if (avoidPunctuation.length) lines.push(`- 少用：${avoidPunctuation.join('、')}`)
    return lines.join('\n')
  },
}
