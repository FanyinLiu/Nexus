import type {
  AutonomousAction,
  ContextTriggerCondition,
  ContextTriggeredTask,
  FocusState,
} from '../../types'

// ── Context snapshot for trigger evaluation ───────────────────────────────────

export type ContextSnapshot = {
  focusState: FocusState
  previousFocusState: FocusState
  activeWindowTitle: string | null
  previousActiveWindowTitle: string | null
  clipboardText: string | null
  previousClipboardText: string | null
  currentHour: number
  idleSeconds: number
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluate a single trigger condition against the current context snapshot.
 */
export function evaluateCondition(
  condition: ContextTriggerCondition,
  snapshot: ContextSnapshot,
): boolean {
  switch (condition.kind) {
    case 'app_switched':
      return (
        snapshot.activeWindowTitle !== snapshot.previousActiveWindowTitle
        && snapshot.activeWindowTitle !== null
        && snapshot.activeWindowTitle.toLowerCase().includes(condition.appName.toLowerCase())
      )

    case 'clipboard_changed':
      if (
        snapshot.clipboardText === snapshot.previousClipboardText
        || snapshot.clipboardText === null
      ) return false
      if (!condition.pattern) return true
      try {
        if (condition.pattern.length > 200) return false
        // Reject patterns with nested quantifiers that cause catastrophic backtracking
        if (/(\+\)\+|\*\)\*|\+\}\+|\*\}\*)/.test(condition.pattern)) return false
        return new RegExp(condition.pattern, 'i').test(snapshot.clipboardText)
      } catch {
        // Invalid regex pattern — treat as non-matching rather than crashing
        return false
      }

    case 'time_range':
      if (condition.startHour <= condition.endHour) {
        return snapshot.currentHour >= condition.startHour && snapshot.currentHour < condition.endHour
      }
      // Wraps midnight
      return snapshot.currentHour >= condition.startHour || snapshot.currentHour < condition.endHour

    case 'focus_changed':
      return (
        snapshot.previousFocusState === condition.from
        && snapshot.focusState === condition.to
      )

    case 'idle_threshold':
      return snapshot.idleSeconds >= condition.seconds
    default: {
      // Exhaustiveness guard — adding a new ContextTriggerCondition.kind
      // without an arm becomes a compile error here.
      const _exhaustive: never = condition
      void _exhaustive
      return false
    }
  }
}

/**
 * Find all tasks that should fire given the current context.
 * Respects cooldown periods.
 */
export function findTriggeredTasks(
  tasks: ContextTriggeredTask[],
  snapshot: ContextSnapshot,
  now: Date = new Date(),
): ContextTriggeredTask[] {
  return tasks.filter((task) => {
    if (!task.enabled) return false

    // Cooldown check
    if (task.lastTriggeredAt) {
      const cooldownMs = task.cooldownMinutes * 60_000
      if (now.getTime() - new Date(task.lastTriggeredAt).getTime() < cooldownMs) {
        return false
      }
    }

    return evaluateCondition(task.condition, snapshot)
  })
}

/**
 * Mark a task as triggered (returns a new immutable task).
 */
export function markTaskTriggered(
  task: ContextTriggeredTask,
  now: Date = new Date(),
): ContextTriggeredTask {
  return { ...task, lastTriggeredAt: now.toISOString() }
}

// ── Task factory ──────────────────────────────────────────────────────────────

export function createContextTriggeredTask(input: {
  name: string
  condition: ContextTriggerCondition
  action: AutonomousAction
  cooldownMinutes?: number
}): ContextTriggeredTask {
  // Validate regex pattern at creation time to catch errors early
  if (input.condition.kind === 'clipboard_changed' && input.condition.pattern) {
    if (input.condition.pattern.length > 200) {
      throw new Error(`Regex pattern too long (max 200 chars): ${input.condition.pattern.slice(0, 40)}...`)
    }
    if (/(\+\)\+|\*\)\*|\+\}\+|\*\}\*)/.test(input.condition.pattern)) {
      throw new Error(`Regex pattern contains potentially catastrophic backtracking constructs: ${input.condition.pattern.slice(0, 40)}`)
    }
    try {
      new RegExp(input.condition.pattern, 'i')
    } catch {
      throw new Error(`Invalid regex pattern: ${input.condition.pattern}`)
    }
  }

  return {
    id: crypto.randomUUID().slice(0, 8),
    name: input.name,
    condition: input.condition,
    action: input.action,
    enabled: true,
    cooldownMinutes: input.cooldownMinutes ?? 30,
  }
}
