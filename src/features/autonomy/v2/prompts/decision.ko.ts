/**
 * Autonomy V2 decision-engine prompt strings — ko locale.
 */

import type { DecisionPromptStrings } from './index.ts'

export const koDecisionPrompts: DecisionPromptStrings = {
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

    사용자가 한동안 조작하지 않았고, 지금은 **말할 필요는 없지만 "여기 있어요"라는 작은 신호만 전하고 싶을 때**만 사용하세요.
    텍스트도, 말풍선도, TTS도 없이, 데스크톱 한쪽에서 작은 동작 하나(기지개, 하품, 살짝 고개 갸우뚱)만.
    한 번에 모션 하나만. 말하고 싶은 이유가 조금이라도 있다면 speak를 사용하세요.`,

  responseContractSpawn: `  {"action": "spawn", "task": "...", "purpose": "...", "announcement": "..."}

    Use this when the user would genuinely benefit from you doing
    something behind the scenes — looking a fact up, checking a site,
    summarising a doc they mentioned. A background helper agent runs
    the task and returns a summary to the chat when done.

    - task: a clear natural-language instruction for the helper. Be
      specific ("오늘 밤 서울 날씨를 기온과 강수 확률 포함해서 확인"), not
      vague ("뭐 좀 알아봐").
    - purpose: one short sentence the user sees, explaining why you're
      doing this now. Stay in character.
    - announcement: OPTIONAL. If you want to verbally acknowledge it
      ("잠깐 찾아볼게요" / "조금만 기다려주세요"), put it here — it will be
      spoken in your voice. Omit when silent dispatch feels more natural.
      Keep it short.

    Only spawn when the task clearly helps. Don't spawn to fill air, don't
    spawn when you can just answer from context, don't spawn for things the
    user can answer faster themselves.`,

  responseContractTail: `Anything else in the response — reasoning, apology, self-narration, multi-
line commentary — will be discarded and treated as silent. So don't.`,

  identityFallback:
    '# Identity\n\n당신은 데스크톱 동반자입니다. 캐릭터를 유지하고 간결하게 답하세요.',

  signaturePhrasesHeader:
    '# 단골 표현\n\n당신이 자주 쓰는 말 — 자연스럽게 사용하고, 억지로 끼워 넣지 마세요:\n',

  forbiddenPhrasesHeader:
    '# 금지 표현\n\n다음 표현은 캐릭터를 깨뜨립니다. 절대 사용하지 마세요:\n',

  toneHeader: '# 어조\n\n감정적 어조의 목표: ',

  personaMemoryHeader: (memory) => `# 인격 기억\n\n${memory}`,

  activityWindow: (level) => {
    if (level === 'high') return '활발한 시간대 (이 시간대에 자주 대화합니다)'
    if (level === 'medium') return '중간 정도 활동 시간대'
    return '비활성 시간대 (평소 이 시간에는 대화하지 않습니다)'
  },

  relationshipLevel: (level) => {
    const map: Record<string, string> = {
      stranger: '처음 만남 (stranger)',
      acquaintance: '아는 사이 (acquaintance)',
      friend: '친구 (friend)',
      close_friend: '가까운 친구 (close_friend) — 더 친하게 / 농담 가능',
      intimate: '아주 가까운 사이 (intimate) — 기대고 응석부려도 됨',
    }
    return map[level] ?? level
  },

  dayNames: ['일', '월', '화', '수', '목', '금', '토'],

  sectionNow: ({ datetime, dayName, hour, activityWindow }) =>
    `## 현재\n시간: ${datetime} (${dayName}, ${hour}시)\nrhythm 활성도: ${activityWindow}`,

  sectionUserFocus: ({ focusState, idleSeconds, idleTicks, appTitle, activityClass, deepFocused }) => {
    const appLabel = appTitle ?? '(감지되지 않음)'
    const focusTail = deepFocused
      ? '**휴리스틱: 사용자가 현재 집중 상태입니다. silent 쪽으로 판단하세요.**'
      : '사용자는 현재 깊은 집중 상태가 아닙니다.'
    return (
      `## 사용자 상태\n`
      + `focusState=${focusState}, idle=${idleSeconds}s, 연속 유휴 ${idleTicks} tick\n`
      + `전경 앱: ${appLabel} → 분류 ${activityClass}\n`
      + focusTail
    )
  },

  sectionEngineSelf: ({ phase, emotionLine, relLine, relScore, streak, daysInteracted }) =>
    `## 당신 자신의 상태\n`
    + `tick phase: ${phase}\n`
    + `감정: ${emotionLine}\n`
    + `관계: ${relLine} (score ${relScore}/100, ${streak}일 연속, 누적 ${daysInteracted}일)`,

  sectionRecentChatHeader: '## 최근 대화 (오래된 순)',
  recentChatUserLabel: '주인',
  recentChatAssistantLabel: '당신',

  sectionMemoriesHeader: '## 주인에 관한 기억 (중요도 순)',
  sectionRemindersHeader: '## 한 시간 내 발동할 리마인더',
  sectionGoalsHeader: '## 주인이 진행 중인 목표',
  goalProgressLabel: '진행도',

  sectionLastUtteranceHeader: '## 지난번 당신이 자발적으로 말했을 때',
  sectionLastUtteranceTail:
    '같은 주제를 곧바로 다시 꺼내지 마세요 — 주인이 아직 소화하지 못했을 수 있습니다.',

  sectionSubagentHeader: '## 백그라운드 작업 상태',
  subagentCapacityLine: (active, max) => `백그라운드 서브에이전트 점유: ${active}/${max}`,
  subagentBudgetLine: (remaining) =>
    remaining !== null ? `오늘 남은 예산: $${remaining.toFixed(2)}` : '오늘 예산: 상한 없음',
  subagentCautionNearCapacity:
    '동시 실행 한도에 가깝습니다. 분명한 이득이 있을 때만 spawn 하세요.',
  subagentCautionLowBudget:
    '예산이 빠듯합니다. 가치 있는 작업이 아니면 spawn 하지 마세요.',

  forceSilentOverride:
    '# Override\n\n이번 tick 은 상류에서 강제로 silent 처리되었습니다. 어떻게 판단하든 반드시 {"action": "silent"} 를 반환하세요.',

  retryHeader: '## 재시도 힌트',
  retryLine: ({ rejectedText, reason }) =>
    `직전 시도 "${rejectedText}" 는 인격 가드에서 차단되었습니다. 이유: ${reason}.`,
  retryTail:
    '이번에는 silent 를 반환하거나 다른 표현으로 바꿔주세요. 이전과 같은 드리프트를 피하세요.',

  finalQuestion:
    '위 상태를 바탕으로 지금 말을 걸겠습니까? response contract 에 따라 JSON 을 반환하세요.',

  varietyHint: ({ avoidOpenings, avoidEndings, lengthMonotone, avoidPunctuation }) => {
    const lines: string[] = ['## 반복을 피하기 위해, 다음 한마디에서는 피해주세요:']
    if (avoidOpenings.length) lines.push(`- 같은 시작: ${avoidOpenings.map((s) => `"${s}"`).join(', ')}`)
    if (avoidEndings.length) lines.push(`- 같은 끝맺음: ${avoidEndings.map((s) => `"${s}"`).join(', ')}`)
    if (lengthMonotone) lines.push('- 최근 답변과 비슷한 길이 — 좀 더 길거나 짧게.')
    if (avoidPunctuation.length) lines.push(`- 과도한 사용: ${avoidPunctuation.join(' ')}`)
    return lines.join('\n')
  },
}
