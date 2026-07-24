/**
 * Autonomy V2 decision-engine prompt string contract.
 * Kept separate from the locale dispatcher so per-locale files can import
 * the type without forming a cycle through index.ts.
 */

export interface DecisionPromptStrings {
  responseContractBase: string
  /** Optional contract piece — surfaces the `idle_motion` action only
   *  when the engine has decided this tick is idle enough that a silent
   *  gesture would feel peripheral, not interruptive. */
  responseContractIdleMotion: string
  responseContractTail: string

  identityFallback: string
  signaturePhrasesHeader: string
  forbiddenPhrasesHeader: string
  toneHeader: string
  personaMemoryHeader: (memory: string) => string

  activityWindow: (level: string) => string
  relationshipLevel: (level: string) => string
  dayNames: string[]

  sectionNow: (params: {
    datetime: string
    dayName: string
    hour: number
    activityWindow: string
  }) => string
  sectionUserFocus: (params: {
    focusState: string
    idleSeconds: number
    idleTicks: number
    appTitle: string | null | undefined
    activityClass: string
    deepFocused: boolean
  }) => string
  sectionEngineSelf: (params: {
    phase: string
    emotionLine: string
    relLine: string
    relScore: number
    streak: number
    daysInteracted: number
  }) => string

  /**
   * Actionable proactivity leaning derived from the emotion axes. Appended to
   * the emotion line so the decision model knows what the numbers mean for
   * how/whether to reach out. 'neutral' is the empty string (no extra line).
   */
  proactiveLean: Record<import('../../emotionModel.ts').ProactiveLean, string>

  sectionRecentChatHeader: string
  recentChatUserLabel: string
  recentChatAssistantLabel: string

  sectionMemoriesHeader: string
  sectionRemindersHeader: string
  sectionGoalsHeader: string
  goalProgressLabel: string

  sectionLastUtteranceHeader: string
  sectionLastUtteranceTail: string

  forceSilentOverride: string

  retryHeader: string
  retryLine: (params: { rejectedText: string; reason: string }) => string
  retryTail: string

  finalQuestion: string

  /** Variety hint injected when analyzeRecentReplies finds repetition. */
  varietyHint: (params: {
    avoidOpenings: string[]
    avoidEndings: string[]
    lengthMonotone: boolean
    avoidPunctuation: string[]
  }) => string
}
