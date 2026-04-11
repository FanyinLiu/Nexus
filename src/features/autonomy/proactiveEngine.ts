import type {
  AppSettings,
  AutonomyTickState,
  ChatMessage,
  FocusState,
  Goal,
  MemoryItem,
  ProactiveDecision,
  ReminderTask,
} from '../../types'
import { shouldSuppressAutonomy } from './focusAwareness'
import { evaluateGoalReminders } from './goalTracker'
import { predictIntent } from './intentPredictor'

// ── Input context for the decision engine ─────────────────────────────────────

export type ProactiveContextInput = {
  tickState: AutonomyTickState
  focusState: FocusState
  currentHour: number
  recentMessages: ChatMessage[]
  memories: MemoryItem[]
  pendingReminders: ReminderTask[]
  goals: Goal[]
  lastPresenceCategory: string | null
  activeWindowTitle: string | null
  settings: AppSettings
}

// ── Priority constants ────────────────────────────────────────────────────────

const PRIORITY_REMINDER = 90
const PRIORITY_GOAL_URGENT = 75
const PRIORITY_BRIEF_MORNING = 70
const PRIORITY_WELCOME_BACK = 60
const PRIORITY_GOAL_MEDIUM = 55
const PRIORITY_CONTEXT_AWARE = 50
const PRIORITY_MEMORY_RECALL = 40
const PRIORITY_IDLE_CHECK = 30
const PRIORITY_GOAL_LOW = 25
const PRIORITY_INTENT_SUGGEST = 45
const PRIORITY_TIME_GREETING = 20

// ── Desktop activity classification ──────────────────────────────────────────

type ActivityClass = 'coding' | 'browsing' | 'media' | 'gaming' | 'communication' | 'documents' | 'unknown'

const ACTIVITY_PATTERNS: Array<{ class: ActivityClass; pattern: RegExp }> = [
  {
    class: 'coding',
    pattern: /Visual Studio|VS ?Code|IntelliJ|WebStorm|PyCharm|Sublime Text|Atom|Neovim|Vim|Emacs|Cursor|Android Studio|Xcode|CLion|GoLand|RustRover|GitHub Desktop|GitKraken|Terminal|PowerShell|cmd\.exe|Windows Terminal|iTerm|Warp|Alacritty/i,
  },
  {
    class: 'browsing',
    pattern: /Chrome|Firefox|Edge|Safari|Opera|Brave|Arc|Vivaldi/i,
  },
  {
    class: 'media',
    pattern: /Spotify|YouTube|Netflix|Bilibili|VLC|PotPlayer|网易云|QQ音乐|Apple Music|foobar/i,
  },
  {
    class: 'gaming',
    pattern: /Steam|Epic Games|Minecraft|Genshin|原神|崩坏|League of Legends|Valorant|CS2|Overwatch/i,
  },
  {
    class: 'communication',
    pattern: /WeChat|微信|QQ|Telegram|Discord|Slack|Teams|Zoom|钉钉|飞书|Lark/i,
  },
  {
    class: 'documents',
    pattern: /Word|Excel|PowerPoint|Notion|Obsidian|Typora|WPS|OneNote|Google Docs|Figma/i,
  },
]

function classifyActivity(windowTitle: string | null): ActivityClass {
  if (!windowTitle) return 'unknown'
  for (const group of ACTIVITY_PATTERNS) {
    if (group.pattern.test(windowTitle)) return group.class
  }
  return 'unknown'
}

/**
 * Returns true if the user appears deeply focused (coding, documents, etc.)
 * and should not be interrupted with ambient messages.
 */
function isUserDeepFocused(activity: ActivityClass, idleTicks: number): boolean {
  return idleTicks <= 2 && (activity === 'coding' || activity === 'documents')
}

// ── Decision evaluation ───────────────────────────────────────────────────────

/**
 * Evaluates the current context and returns the best proactive decision.
 * Replaces the legacy random presence system with context-aware decisions.
 *
 * Decision flow:
 * 1. Gates (quiet hours, locked, sleeping) → silent
 * 2. User deep-focused (coding/documents + active) → silent (don't interrupt)
 * 3. Overdue reminders → remind (highest priority)
 * 4. Morning brief window → brief
 * 5. Welcome back after long idle → warm check-in
 * 6. Context-aware comment based on active app → speak
 * 7. Memory recall during light idle → speak
 * 8. Extended idle check-in → speak
 * 9. Time-based greeting → speak
 * 10. Nothing matches → silent
 */
export function evaluateProactiveContext(input: ProactiveContextInput): ProactiveDecision {
  const { tickState, focusState, currentHour, settings } = input
  const activity = classifyActivity(input.activeWindowTitle)

  // Gate: suppress during quiet hours, locked screen
  if (shouldSuppressAutonomy(focusState, currentHour, {
    start: settings.autonomyQuietHoursStart,
    end: settings.autonomyQuietHoursEnd,
  })) {
    return { kind: 'silent' }
  }

  // Gate: sleeping/dreaming → stay silent (ticks still run for housekeeping)
  if (tickState.phase === 'sleeping' || tickState.phase === 'dreaming') {
    return { kind: 'silent' }
  }

  // Gate: user is deep-focused → stay silent (core feature: don't interrupt coding)
  // Exception: overdue reminders still break through
  const deepFocused = isUserDeepFocused(activity, tickState.consecutiveIdleTicks)

  // Collect candidates and pick the highest-priority one
  const candidates: ProactiveDecision[] = []

  // ── Candidate: overdue reminders (always breaks through) ──────────────────
  const overdueReminder = findOverdueReminder(input.pendingReminders)
  if (overdueReminder) {
    candidates.push({
      kind: 'remind',
      taskId: overdueReminder.id,
    })
  }

  // Everything below is suppressed when deep-focused
  if (deepFocused) {
    // If there's an overdue reminder, it still fires; otherwise stay silent
    return candidates.length > 0 ? pickBestCandidate(candidates) : { kind: 'silent' }
  }

  // ── Candidate: morning brief ──────────────────────────────────────────────
  if (isMorningBriefTime(currentHour, tickState) && input.lastPresenceCategory !== 'brief') {
    const briefText = buildMorningBrief(input)
    if (briefText) {
      candidates.push({
        kind: 'brief',
        summary: briefText,
      })
    }
  }

  // ── Candidate: welcome back after long idle ───────────────────────────────
  // User was idle (drowsy/sleeping) and just came back (idle ticks reset to 0)
  if (
    tickState.consecutiveIdleTicks === 0
    && tickState.tickCount > 5
    && focusState === 'active'
    && input.lastPresenceCategory !== 'welcome_back'
  ) {
    // idleSeconds is already reset to 0 when user returns, so we
    // compute idle duration from lastSleepAt instead.
    const idleMinutes = tickState.lastSleepAt
      ? (Date.now() - new Date(tickState.lastSleepAt).getTime()) / 60_000
      : 0
    if (idleMinutes >= 30) {
      candidates.push({
        kind: 'speak',
        text: pickWelcomeBackLine(currentHour, settings.userName, idleMinutes),
        category: 'welcome_back',
        priority: PRIORITY_WELCOME_BACK,
      })
    }
  }

  // ── Candidate: goal progress reminder ─────────────────────────────────────
  if (input.goals.length > 0 && input.lastPresenceCategory !== 'goal') {
    const goalReminder = evaluateGoalReminders(input.goals)
    if (goalReminder) {
      const priority = goalReminder.urgency === 'high' ? PRIORITY_GOAL_URGENT
        : goalReminder.urgency === 'medium' ? PRIORITY_GOAL_MEDIUM
        : PRIORITY_GOAL_LOW
      candidates.push({
        kind: 'speak',
        text: goalReminder.text,
        category: 'context' as const,
        priority,
      })
    }
  }

  // ── Candidate: context-aware comment based on active window ───────────────
  if (
    activity !== 'unknown'
    && tickState.consecutiveIdleTicks >= 2
    && tickState.consecutiveIdleTicks <= 8
    && input.lastPresenceCategory !== 'context'
  ) {
    const contextLine = pickContextAwareLine(activity, currentHour, settings.userName)
    if (contextLine) {
      candidates.push({
        kind: 'speak',
        text: contextLine,
        category: 'context',
        priority: PRIORITY_CONTEXT_AWARE,
      })
    }
  }

  // ── Candidate: intent-based suggestion ─────────────────────────────────────
  if (
    input.lastPresenceCategory !== 'context'
    && tickState.consecutiveIdleTicks >= 2
  ) {
    const prediction = predictIntent(
      input.recentMessages,
      input.activeWindowTitle,
      activity,
      currentHour,
    )
    if (prediction.suggestion && prediction.confidence >= 0.6) {
      candidates.push({
        kind: 'suggest',
        suggestion: prediction.suggestion,
      })
    }
  }

  // ── Candidate: memory-based recall ────────────────────────────────────────
  if (
    input.memories.length > 0
    && tickState.consecutiveIdleTicks >= 3
    && input.lastPresenceCategory !== 'memory'
  ) {
    const memory = pickRelevantMemory(input.memories)
    if (memory) {
      candidates.push({
        kind: 'speak',
        text: `想起来了，${memory.content}`,
        category: 'memory',
        priority: PRIORITY_MEMORY_RECALL,
      })
    }
  }

  // ── Candidate: idle check-in (30+ min idle) ──────────────────────────────
  if (
    tickState.phase === 'drowsy'
    && tickState.consecutiveIdleTicks >= 6
    && input.lastPresenceCategory !== 'idle_check'
  ) {
    candidates.push({
      kind: 'speak',
      text: pickIdleCheckLine(currentHour),
      category: 'idle_check',
      priority: PRIORITY_IDLE_CHECK,
    })
  }

  // ── Candidate: time-based greeting ────────────────────────────────────────
  if (
    tickState.consecutiveIdleTicks === 0
    && focusState === 'active'
    && input.lastPresenceCategory !== 'time'
    && isGreetingTime(currentHour)
  ) {
    candidates.push({
      kind: 'speak',
      text: pickTimeGreeting(currentHour, settings.companionName),
      category: 'time',
      priority: PRIORITY_TIME_GREETING,
    })
  }

  // ── Pick best candidate ───────────────────────────────────────────────────
  if (candidates.length === 0) {
    return { kind: 'silent' }
  }

  return pickBestCandidate(candidates)
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function pickBestCandidate(candidates: ProactiveDecision[]): ProactiveDecision {
  let best: ProactiveDecision = candidates[0]
  let bestPriority = getDecisionPriority(candidates[0])

  for (let i = 1; i < candidates.length; i++) {
    const p = getDecisionPriority(candidates[i])
    if (p > bestPriority) {
      best = candidates[i]
      bestPriority = p
    }
  }

  return best
}

function getDecisionPriority(d: ProactiveDecision): number {
  switch (d.kind) {
    case 'remind': return PRIORITY_REMINDER
    case 'brief': return PRIORITY_BRIEF_MORNING
    case 'suggest': return PRIORITY_INTENT_SUGGEST
    case 'speak': return d.priority
    case 'silent': return 0
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function findOverdueReminder(tasks: ReminderTask[]): ReminderTask | null {
  const now = Date.now()
  for (const task of tasks) {
    if (!task.enabled || !task.nextRunAt) continue
    if (new Date(task.nextRunAt).getTime() <= now) return task
  }
  return null
}

function isMorningBriefTime(hour: number, state: AutonomyTickState): boolean {
  if (hour < 7 || hour >= 9) return false
  const wakeAt = new Date(state.lastWakeAt)
  const wakeHour = wakeAt.getHours()
  if (wakeHour < 6 || wakeHour > 9) return false
  // Only show brief within 10 ticks since last wake (not global tickCount)
  const ticksSinceWake = (Date.now() - wakeAt.getTime()) / 1_000
    / 300 // approximate ticks (default ~5 min interval)
  return ticksSinceWake < 10
}

function buildMorningBrief(input: ProactiveContextInput): string | null {
  const parts: string[] = []

  const upcoming = input.pendingReminders.filter((t) => t.enabled).length
  if (upcoming > 0) {
    parts.push(`今天有 ${upcoming} 个待办提醒`)
  }

  const recentCount = input.recentMessages.filter((m) => m.role === 'user').length
  if (recentCount > 0) {
    parts.push(`上次聊了 ${recentCount} 轮对话`)
  }

  if (parts.length === 0) return null

  return `早上好！${parts.join('，')}。有什么需要我帮忙的吗？`
}

function pickRelevantMemory(memories: MemoryItem[]): MemoryItem | null {
  const highImportance = memories.filter((m) => m.importance === 'high' || m.importance === 'pinned')
  const pool = highImportance.length > 0 ? highImportance : memories
  const index = Math.floor(Math.random() * Math.min(pool.length, 5))
  return pool[index] ?? null
}

function isGreetingTime(hour: number): boolean {
  return hour === 8 || hour === 12 || hour === 18
}

function pickTimeGreeting(hour: number, name: string): string {
  if (hour >= 6 && hour < 11) return `${name}在，早上好呀~`
  if (hour >= 11 && hour < 14) return `中午了，${name}提醒你该吃饭啦。`
  if (hour >= 17 && hour < 19) return `傍晚了，今天辛苦了~`
  if (hour >= 22) return `夜深了，早点休息吧。`
  return `${name}一直在哦。`
}

function pickIdleCheckLine(hour: number): string {
  if (hour >= 22 || hour < 6) return '你好像离开了一会儿，我先安静待着。'
  return '好久没互动了，需要我做点什么吗？'
}

// ── Welcome-back after long idle ─────────────────────────────────────────────

function pickWelcomeBackLine(hour: number, userName: string, idleMinutes: number): string {
  const roundedMin = Math.round(idleMinutes)

  if (hour >= 22 || hour < 6) {
    return `${userName}，你回来了，刚离开了大约 ${roundedMin} 分钟。夜里不用急，慢慢来。`
  }

  const lines = [
    `${userName}，你回来了！离开了大约 ${roundedMin} 分钟，要继续之前的事吗？`,
    `欢迎回来，${userName}。离开了一阵子，需要我帮你回顾一下之前在做什么吗？`,
    `${userName}，好久不见！差不多 ${roundedMin} 分钟了，有什么需要我接上的吗？`,
  ]
  return pickRandom(lines)
}

// ── Context-aware comments based on desktop activity ─────────────────────────

function pickContextAwareLine(
  activity: ActivityClass,
  hour: number,
  userName: string,
): string | null {
  switch (activity) {
    case 'browsing': {
      if (hour >= 22) return `${userName}，夜里浏览网页别忘了时间。`
      const lines = [
        `${userName}，在看网页吗？找到有意思的东西可以发给我。`,
        `浏览中~如果遇到想讨论的内容，随时丢过来。`,
      ]
      return pickRandom(lines)
    }
    case 'media': {
      const lines = [
        `在听音乐/看视频呢，${userName}放松一下也很好。`,
        `享受一下~我不打扰，需要的时候叫我就好。`,
      ]
      return pickRandom(lines)
    }
    case 'gaming':
      return `${userName}在打游戏！我在旁边看着，有事叫我就好。`
    case 'communication': {
      const lines = [
        `在聊天呢，有什么需要我帮忙查的随时说。`,
        `社交时间~我先安静，需要的时候叫我。`,
      ]
      return pickRandom(lines)
    }
    case 'documents': {
      if (hour >= 22) return `${userName}，这么晚还在处理文档，辛苦了。`
      return `在写文档呢，如果需要我帮忙整理或者润色，随时丢过来。`
    }
    // 'coding' and 'unknown' → engine stays silent
    case 'coding':
    case 'unknown':
      return null
  }
}
