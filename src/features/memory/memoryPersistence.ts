import type { MemoryItem } from '../../types'
import { getDecayedScore } from './decay.ts'

const MARKER_START = '<!-- nexus:auto-memory -->'
const MARKER_END = '<!-- /nexus:auto-memory -->'
const MAX_PERSISTED = 40

const CATEGORY_LABELS: Record<string, string> = {
  profile: 'About the User',
  preference: 'Preferences',
  goal: 'Goals',
  habit: 'Habits',
  feedback: 'Feedback',
  project: 'Projects',
  reference: 'Reference',
  manual: 'Notes',
}

export function formatMemoriesForPersonaFile(
  memories: MemoryItem[],
  existingContent: string,
): string {
  const now = Date.now()
  const scored = memories
    .map((m) => ({ m, score: getDecayedScore(m, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PERSISTED)

  const grouped = new Map<string, string[]>()
  for (const { m } of scored) {
    const cat = m.category || 'reference'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(m.content)
  }

  const sections: string[] = []
  for (const [cat, items] of grouped) {
    const label = CATEGORY_LABELS[cat] ?? cat
    sections.push(`### ${label}\n${items.map((c) => `- ${c}`).join('\n')}`)
  }

  const autoBlock = sections.length
    ? `${MARKER_START}\n## Remembered\n\n${sections.join('\n\n')}\n${MARKER_END}`
    : ''

  const startIdx = existingContent.indexOf(MARKER_START)
  const endIdx = existingContent.indexOf(MARKER_END)

  if (startIdx >= 0 && endIdx >= 0) {
    const before = existingContent.slice(0, startIdx).trimEnd()
    const after = existingContent.slice(endIdx + MARKER_END.length).trimStart()
    return [before, autoBlock, after].filter(Boolean).join('\n\n') + '\n'
  }

  const userContent = existingContent.trim()
  if (userContent && autoBlock) return `${userContent}\n\n${autoBlock}\n`
  if (autoBlock) return `${autoBlock}\n`
  return userContent ? `${userContent}\n` : ''
}
