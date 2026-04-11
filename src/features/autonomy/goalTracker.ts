/**
 * Goal tracking system.
 *
 * Manages user goals with progress, subtasks, and deadlines.
 * Integrates with the autonomy tick to generate progress reminders.
 */

import type { Goal, GoalSubtask } from '../../types'

// ── Goal operations ─────────────────────────────────────────────────────────

export function createGoal(title: string, options?: {
  description?: string
  deadline?: string
  subtasks?: string[]
}): Goal {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID().slice(0, 8),
    title,
    description: options?.description,
    status: 'active',
    progress: 0,
    subtasks: (options?.subtasks ?? []).map((t) => ({
      id: crypto.randomUUID().slice(0, 6),
      title: t,
      done: false,
    })),
    deadline: options?.deadline,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateGoalProgress(goal: Goal): Goal {
  const total = goal.subtasks.length
  if (total === 0) return goal
  const done = goal.subtasks.filter((s) => s.done).length
  const progress = Math.round((done / total) * 100)
  const allDone = done === total
  return {
    ...goal,
    progress,
    status: allDone ? 'completed' : goal.status,
    completedAt: allDone ? new Date().toISOString() : goal.completedAt,
    updatedAt: new Date().toISOString(),
  }
}

export function toggleSubtask(goal: Goal, subtaskId: string): Goal {
  const subtasks = goal.subtasks.map((s) =>
    s.id === subtaskId ? { ...s, done: !s.done } : s,
  )
  return updateGoalProgress({ ...goal, subtasks })
}

export function addSubtask(goal: Goal, title: string): Goal {
  const subtask: GoalSubtask = {
    id: crypto.randomUUID().slice(0, 6),
    title,
    done: false,
  }
  return updateGoalProgress({
    ...goal,
    subtasks: [...goal.subtasks, subtask],
    updatedAt: new Date().toISOString(),
  })
}

// ── Autonomy integration ────────────────────────────────────────────────────

export type GoalReminder = {
  goalId: string
  text: string
  urgency: 'low' | 'medium' | 'high'
}

/**
 * Check active goals and generate reminders for the autonomy tick.
 * Returns at most one reminder (the most urgent).
 */
export function evaluateGoalReminders(goals: Goal[]): GoalReminder | null {
  const now = Date.now()
  const active = goals.filter((g) => g.status === 'active')
  if (active.length === 0) return null

  let best: GoalReminder | null = null
  let bestScore = -1

  for (const goal of active) {
    let urgency: GoalReminder['urgency'] = 'low'
    let score = 0

    if (goal.deadline) {
      const deadlineMs = Date.parse(goal.deadline)
      const remainingMs = deadlineMs - now
      const remainingHours = remainingMs / 3_600_000

      if (remainingHours < 0) {
        // Overdue
        urgency = 'high'
        score = 100
      } else if (remainingHours < 24) {
        urgency = 'high'
        score = 90
      } else if (remainingHours < 72) {
        urgency = 'medium'
        score = 60
      } else {
        score = 20
      }
    }

    // Stale check: no update in 3+ days
    const staleDays = (now - Date.parse(goal.updatedAt)) / 86_400_000
    if (staleDays >= 3) {
      score = Math.max(score, 50)
      if (urgency === 'low') urgency = 'medium'
    }

    if (score > bestScore) {
      bestScore = score
      const remaining = goal.subtasks.filter((s) => !s.done).length
      const text = buildGoalReminderText(goal, urgency, remaining)
      best = { goalId: goal.id, text, urgency }
    }
  }

  return best
}

function buildGoalReminderText(goal: Goal, urgency: string, remainingSubtasks: number): string {
  const progressStr = goal.subtasks.length > 0
    ? `（进度 ${goal.progress}%，还剩 ${remainingSubtasks} 个子任务）`
    : ''

  if (urgency === 'high' && goal.deadline) {
    const deadlineDate = new Date(goal.deadline).toLocaleDateString('zh-CN')
    return `目标「${goal.title}」截止日期是 ${deadlineDate}，需要抓紧了${progressStr}`
  }

  if (urgency === 'medium') {
    return `目标「${goal.title}」有一阵没更新了${progressStr}，要继续推进吗？`
  }

  return `记得目标「${goal.title}」${progressStr}`
}

/**
 * Format active goals as context for LLM system prompt injection.
 */
export function formatGoalsForPrompt(goals: Goal[]): string {
  const active = goals.filter((g) => g.status === 'active')
  if (active.length === 0) return ''

  const lines = active.map((g) => {
    const progress = g.subtasks.length > 0 ? ` (${g.progress}%)` : ''
    const deadline = g.deadline ? ` 截止: ${new Date(g.deadline).toLocaleDateString('zh-CN')}` : ''
    return `- ${g.title}${progress}${deadline}`
  })

  return `## 用户当前目标\n${lines.join('\n')}`
}
