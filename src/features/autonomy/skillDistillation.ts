/**
 * Skill auto-distillation — extracts reusable skill templates from conversation history.
 *
 * During the memory dream phase, recent conversations are analyzed for repeated
 * multi-step patterns. Discovered patterns are saved as skill templates in long-term
 * memory with category 'skill'. When a user later makes a similar request, the
 * semantic memory search surfaces the skill template, letting the LLM follow a
 * proven path instead of improvising.
 */

import type { AppSettings, DailyMemoryEntry } from '../../types'

const DISTILLATION_SYSTEM_PROMPT = `你是一个技能提取模块。你的任务是分析对话历史，识别用户反复执行或可能会再次需要的多步操作模式。

对于每个发现的技能，输出一条简洁的技能描述，让 AI 助手在下次遇到类似请求时能快速执行。

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "skills": [
    {
      "name": "技能名称（4-12字）",
      "trigger": "用户可能怎么说来触发这个技能",
      "steps": "执行步骤的简洁描述",
      "tools": ["涉及的工具ID，如 web_search, weather 等"]
    }
  ]
}

规则：
- 只提取出现过至少 2 次的操作模式，或者用户明确表示以后还会用的操作
- 每个技能用 1-2 句话描述步骤，不要冗长
- 如果没有发现可提取的技能，返回 {"skills": []}
- 不要和已有技能重复`

export type DistilledSkill = {
  name: string
  trigger: string
  steps: string
  tools: string[]
}

export function buildSkillDistillationPrompt(
  dailyEntries: DailyMemoryEntry[],
  existingSkills: string[],
  _settings: AppSettings,
): { system: string; user: string } | null {
  if (dailyEntries.length < 6) return null

  const recentEntries = dailyEntries.slice(-60)
  const entriesText = recentEntries
    .map((e) => `[${e.day} ${e.role}] ${e.content}`)
    .join('\n')

  const existingSection = existingSkills.length
    ? `\n已有技能（不要重复）：\n${existingSkills.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : ''

  return {
    system: DISTILLATION_SYSTEM_PROMPT,
    user: `请从以下对话日记中提取可复用的技能模式：${existingSection}\n## 对话日记\n${entriesText}`,
  }
}

export function parseSkillDistillationResponse(content: string): DistilledSkill[] {
  try {
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const parsed = JSON.parse(cleaned)
    const raw = Array.isArray(parsed.skills) ? parsed.skills : []

    return raw.filter(
      (s: unknown): s is DistilledSkill =>
        typeof s === 'object' && s !== null
        && typeof (s as Record<string, unknown>).name === 'string'
        && typeof (s as Record<string, unknown>).trigger === 'string'
        && typeof (s as Record<string, unknown>).steps === 'string',
    ).map((s: DistilledSkill) => ({
      name: s.name,
      trigger: s.trigger,
      steps: s.steps,
      tools: Array.isArray(s.tools) ? s.tools.filter((t) => typeof t === 'string') : [],
    }))
  } catch {
    return []
  }
}

export function formatSkillAsMemory(skill: DistilledSkill): string {
  const toolsPart = skill.tools.length ? ` [工具: ${skill.tools.join(', ')}]` : ''
  return `【技能】${skill.name} — 触发：${skill.trigger} — 步骤：${skill.steps}${toolsPart}`
}
