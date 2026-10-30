import { randomUUID } from 'node:crypto'

export function mapCardToPersona(card) {
  const { data } = card
  const name = String(data.name ?? '').trim()
  const profileId = `card-${randomUUID().slice(0, 8)}`

  // ── soul.md ──
  const soulSections = [`# ${name}`]
  if (data.description?.trim()) soulSections.push(data.description.trim())
  if (data.personality?.trim()) soulSections.push(`## Personality\n${data.personality.trim()}`)
  if (data.scenario?.trim()) soulSections.push(`## Scenario\n${data.scenario.trim()}`)
  if (data.system_prompt?.trim()) soulSections.push(`## System Instructions\n${data.system_prompt.trim()}`)
  // post_history_instructions is deliberately NOT part of soul.md. Card
  // authors write it to be applied after the conversation history, so it is
  // stored on its own and the post-history reminder injects it there.
  const postHistory = data.post_history_instructions?.trim() ?? ''
  const soulMarkdown = soulSections.join('\n\n')

  // ── memory.md ──
  const memory = data.creator_notes?.trim() ?? ''

  // ── examples.md ──
  const examplesMd = convertMesExample(data.mes_example, name)

  // ── style.json ──
  const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t).trim()).filter(Boolean) : []
  const style = {}
  if (tags.length) style.toneTags = tags
  if (postHistory) style.postHistory = postHistory

  // ── lorebook entries ──
  const lorebookEntries = convertCharacterBook(data.character_book)

  // ── greeting ──
  const greeting = String(data.first_mes ?? '').trim() || null

  return {
    profileId,
    files: {
      'soul.md': soulMarkdown,
      'memory.md': memory,
      'examples.md': examplesMd,
      'style.json': JSON.stringify(style, null, 2),
      'voice.json': '{}',
      'tools.json': '{}',
    },
    profile: {
      id: profileId,
      label: name,
      companionName: name,
      // The card's assembled identity — same content as soul.md — so an
      // imported card actually drives chat via settings.systemPrompt even when
      // the per-profile chat persona flag is off (was a "[Character card: X]"
      // placeholder that leaked into the prompt as literal text).
      systemPrompt: soulMarkdown,
      petModelId: '',
    },
    greeting,
    lorebookEntries,
  }
}

function convertMesExample(mesExample, charName) {
  if (!mesExample?.trim()) return ''
  const blocks = mesExample.split(/<START>/gi).filter((b) => b.trim())
  const sections = []
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split(/\r?\n/)
    const turns = []
    for (const line of lines) {
      const cleaned = line
        .replace(/\{\{user\}\}/gi, 'User')
        .replace(/\{\{char\}\}/gi, 'Assistant')
      const userMatch = cleaned.match(/^User\s*[:：]\s*(.*)$/i)
      if (userMatch) { turns.push(`User: ${userMatch[1]}`); continue }
      const charMatch = cleaned.match(new RegExp(`^(?:Assistant|${escapeRegex(charName)})\\s*[:：]\\s*(.*)$`, 'i'))
      if (charMatch) { turns.push(`Assistant: ${charMatch[1]}`); continue }
      if (turns.length) turns[turns.length - 1] += `\n${line}`
    }
    if (turns.length) {
      sections.push(`### Example ${i + 1}\n${turns.join('\n')}`)
    }
  }
  return sections.join('\n\n')
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function convertCharacterBook(book) {
  if (!book?.entries || !Array.isArray(book.entries)) return []
  const now = new Date().toISOString()
  return book.entries
    .filter((e) => e && typeof e === 'object')
    .map((entry, index) => {
      const keys = Array.isArray(entry.keys)
        ? entry.keys.map((k) => String(k).trim()).filter(Boolean)
        : Array.isArray(entry.key)
          ? entry.key.map((k) => String(k).trim()).filter(Boolean)
          : []
      return {
        id: `card-lore-${Date.now()}-${index}`,
        label: String(entry.comment || entry.name || entry.display_name || `Entry ${index + 1}`).trim(),
        keywords: keys,
        content: String(entry.content ?? '').trim(),
        enabled: entry.enabled !== false && entry.disable !== true,
        priority: Number.isFinite(entry.priority) ? entry.priority
          : Number.isFinite(entry.insertion_order) ? entry.insertion_order
            : 0,
        createdAt: now,
        updatedAt: now,
      }
    })
    .filter((e) => e.content && e.keywords.length)
}
