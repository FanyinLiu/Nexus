import type { AppSettings } from '../../types'

type SkillGenerationContext = {
  userQuery: string
  assistantReply: string
  toolCallNames: string[]
  settings: AppSettings
}

const MIN_REPLY_LENGTH = 150
const MIN_TOOL_CALLS = 1

function generateSkillId(query: string) {
  let hash = 0
  for (let i = 0; i < query.length; i++) {
    hash = Math.imul(31, hash) + query.charCodeAt(i) | 0
  }
  return `auto-${(hash >>> 0).toString(36)}-${Date.now().toString(36)}`
}

/**
 * Detect whether a completed assistant reply warrants auto skill generation.
 * Criteria: used tool calls AND reply was substantial.
 */
export function shouldGenerateSkill(context: SkillGenerationContext): boolean {
  if (!context.settings.autoSkillGenerationEnabled) return false
  if (context.toolCallNames.length < MIN_TOOL_CALLS) return false
  if (context.assistantReply.length < MIN_REPLY_LENGTH) return false
  return true
}

/**
 * Build a skill document from a completed interaction.
 * Uses the LLM to summarize the pattern into a reusable skill guide.
 */
export async function generateAndSaveSkill(context: SkillGenerationContext): Promise<boolean> {
  if (!window.desktopPet?.completeChat || !window.desktopPet?.skillSave) return false

  const { userQuery, assistantReply, toolCallNames, settings } = context

  try {
    const response = await window.desktopPet.completeChat({
      providerId: settings.apiProviderId,
      baseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: `You are a skill documentation generator. Given a user query and the assistant's successful response (which used tool calls), generate a concise skill document in the following YAML+markdown format. The skill should capture the PATTERN, not the specific instance. Reply ONLY with the document, no other text.

Format:
---
title: <short skill title, 5-10 words>
trigger: <comma-separated trigger phrases that would activate this skill>
summary: <one-line summary of what this skill does>
---

## Steps
<numbered list of steps the assistant should follow>

## Notes
<any important caveats or tips>`,
        },
        {
          role: 'user',
          content: `User query: ${userQuery}\n\nTools used: ${toolCallNames.join(', ')}\n\nAssistant reply (abbreviated): ${assistantReply.slice(0, 800)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 400,
    })

    const content = response?.content?.trim()
    if (!content) return false

    // Parse the frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/m)
    if (!frontmatterMatch) return false

    const frontmatter = frontmatterMatch[1]
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m)
    const triggerMatch = frontmatter.match(/^trigger:\s*(.+)$/m)
    const summaryMatch = frontmatter.match(/^summary:\s*(.+)$/m)

    if (!titleMatch || !triggerMatch || !summaryMatch) return false

    const id = generateSkillId(userQuery)
    await window.desktopPet.skillSave({
      id,
      title: titleMatch[1].trim(),
      trigger: triggerMatch[1].trim(),
      summary: summaryMatch[1].trim(),
      content,
    })

    return true
  } catch {
    return false
  }
}

/**
 * Search for relevant auto-generated skills and format them for prompt injection.
 */
export async function loadRelevantSkills(query: string, limit = 2): Promise<string> {
  if (!window.desktopPet?.skillSearch) return ''

  try {
    const skills = await window.desktopPet.skillSearch({ query, limit })
    if (!skills.length) return ''

    // Mark skills as used
    for (const skill of skills) {
      void window.desktopPet.skillMarkUsed?.({ id: skill.id })
    }

    const sections = skills.map(
      (s) => `【自动技能 · ${s.title}】\n${s.content.replace(/^---[\s\S]*?---\s*\n/, '')}`,
    )

    return `以下是过往经验生成的参考技能，可按需借鉴：\n${sections.join('\n\n')}`
  } catch {
    return ''
  }
}
