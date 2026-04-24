/**
 * Autonomy V2 decision-engine prompt strings — en-US locale.
 */

import type { DecisionPromptStrings } from './index.ts'

export const enUSDecisionPrompts: DecisionPromptStrings = {
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

    Use this ONLY when the user has been idle a while and the moment
    calls for a tiny ambient sign-of-life — a stretch, a yawn, a small
    head-tilt — without any text or speech. No bubble, no TTS, just the
    pet visibly being alive in the corner. Pick at most one motion;
    skip if there's any reason to actually speak instead.`,

  responseContractSpawn: `  {"action": "spawn", "task": "...", "purpose": "...", "announcement": "..."}

    Use this when the user would genuinely benefit from you doing
    something behind the scenes — looking a fact up, checking a site,
    summarising a doc they mentioned. A background helper agent runs
    the task and returns a summary to the chat when done.

    - task: a clear natural-language instruction for the helper. Be
      specific ("check tonight's weather in Beijing with temperature and
      precipitation chance"), not vague ("look something up for me").
    - purpose: one short sentence the user sees, explaining why you're
      doing this now. Stay in character.
    - announcement: OPTIONAL. If you want to verbally acknowledge it
      ("let me check" / "one sec"), put it here — it will be spoken in
      your voice. Omit when silent dispatch feels more natural. Keep it
      short.

    Only spawn when the task clearly helps. Don't spawn to fill air, don't
    spawn when you can just answer from context, don't spawn for things the
    user can answer faster themselves.`,

  responseContractTail: `Anything else in the response — reasoning, apology, self-narration, multi-
line commentary — will be discarded and treated as silent. So don't.`,

  identityFallback: '# Identity\n\nYou are a desktop companion. Stay in character and be concise.',

  signaturePhrasesHeader: `# Signature phrases\n\nPhrases you're known to say — use naturally, don't force:\n`,

  forbiddenPhrasesHeader: `# Never say\n\nThe following phrasings break character. Do NOT use them:\n`,

  toneHeader: '# Tone\n\nTargets for emotional register: ',

  personaMemoryHeader: (memory) => `# Persona memory\n\n${memory}`,

  activityWindow: (level) => {
    if (level === 'high') return 'High-activity window (the user often interacts around this time)'
    if (level === 'medium') return 'Medium-activity window'
    return 'Low-activity window (the user usually does not interact at this hour)'
  },

  relationshipLevel: (level) => {
    const map: Record<string, string> = {
      stranger: 'just met (stranger)',
      acquaintance: 'acquaintance',
      friend: 'friend',
      close_friend: 'close friend — you can be more familiar / playful',
      intimate: 'intimate — you can lean on each other / be affectionate',
    }
    return map[level] ?? level
  },

  dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  sectionNow: ({ datetime, dayName, hour, activityWindow }) =>
    `## Now\nTime: ${datetime} (${dayName}, ${hour}:00)\nrhythm activity window: ${activityWindow}`,

  sectionUserFocus: ({ focusState, idleSeconds, idleTicks, appTitle, activityClass, deepFocused }) => {
    const appLabel = appTitle ?? '(not detected)'
    const focusTail = deepFocused
      ? '**Heuristic: the user is currently deep-focused — lean toward silent.**'
      : 'The user is not currently in deep-focus mode.'
    return (
      `## User state\n`
      + `focusState=${focusState}, idle=${idleSeconds}s, ${idleTicks} consecutive idle ticks\n`
      + `Foreground app: ${appLabel} → class ${activityClass}\n`
      + focusTail
    )
  },

  sectionEngineSelf: ({ phase, emotionLine, relLine, relScore, streak, daysInteracted }) =>
    `## Your own state\n`
    + `tick phase: ${phase}\n`
    + `Emotion: ${emotionLine}\n`
    + `Relationship: ${relLine} (score ${relScore}/100, ${streak}-day streak, ${daysInteracted} days total)`,

  sectionRecentChatHeader: '## Recent chat (oldest first)',
  recentChatUserLabel: 'User',
  recentChatAssistantLabel: 'You',

  sectionMemoriesHeader: '## What you know about the user (by importance)',
  sectionRemindersHeader: '## Reminders firing within the next hour',
  sectionGoalsHeader: "## User's active goals",
  goalProgressLabel: 'progress',

  sectionLastUtteranceHeader: '## The last time you spoke up on your own',
  sectionLastUtteranceTail:
    "Don't immediately revisit the same topic — the user may not have had a chance to react yet.",

  sectionSubagentHeader: '## Background task state',
  subagentCapacityLine: (active, max) => `Background subagents in use: ${active}/${max}`,
  subagentBudgetLine: (remaining) =>
    remaining !== null
      ? `Remaining daily budget: $${remaining.toFixed(2)}`
      : 'Daily budget: no cap set',
  subagentCautionNearCapacity:
    'Near the concurrency cap — only spawn when the benefit is clear.',
  subagentCautionLowBudget:
    "Budget is tight — don't spawn unless the task is high-value.",

  forceSilentOverride:
    '# Override\n\nThis tick has been force-silenced upstream. Regardless of what you think, you MUST return {"action": "silent"}.',

  retryHeader: '## Retry hint',
  retryLine: ({ rejectedText, reason }) =>
    `Your previous attempt "${rejectedText}" was blocked by the persona guardrail. Reason: ${reason}.`,
  retryTail:
    'Either return silent this time or rephrase — avoid the same drift as before.',

  finalQuestion:
    'Based on all of the above, would you speak up right now? Reply with JSON per the response contract.',
}
