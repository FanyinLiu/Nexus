import type { DailyMemoryEntry } from '../../types'

export type MemorySourceRefKind =
  | 'chat'
  | 'voice'
  | 'telegram'
  | 'discord'
  | 'notification'
  | 'scheduler'
  | 'bracket'
  | 'errand'
  | 'arc'
  | 'capsule'
  | 'unknown'

export type ParsedMemorySourceRef = {
  raw: string
  kind: MemorySourceRefKind
  id: string
  canOpenHistory: boolean
  canOpenAutonomy: boolean
}

const KNOWN_SOURCE_REF_KINDS = new Set<MemorySourceRefKind>([
  'chat',
  'voice',
  'telegram',
  'discord',
  'notification',
  'scheduler',
  'bracket',
  'errand',
  'arc',
  'capsule',
])

export function createDailyMemorySourceRef(
  source: DailyMemoryEntry['source'],
  messageId: string,
): string | undefined {
  return createMessageMemorySourceRef(source, messageId)
}

export function createMessageMemorySourceRef(
  source: DailyMemoryEntry['source'],
  messageId: string,
): string | undefined {
  const normalizedId = messageId.replace(/\s+/g, ' ').trim()
  if (!normalizedId) return undefined
  return `${source}:${normalizedId}`
}

export function parseMemorySourceRef(value: unknown): ParsedMemorySourceRef | null {
  if (typeof value !== 'string') return null
  const raw = value.replace(/\s+/g, ' ').trim()
  if (!raw) return null

  const separatorIndex = raw.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    return {
      raw,
      kind: 'unknown',
      id: raw,
      canOpenHistory: false,
      canOpenAutonomy: false,
    }
  }

  const rawKind = raw.slice(0, separatorIndex).trim().toLowerCase()
  const id = raw.slice(separatorIndex + 1).trim()
  const kind = KNOWN_SOURCE_REF_KINDS.has(rawKind as MemorySourceRefKind)
    ? rawKind as MemorySourceRefKind
    : 'unknown'

  return {
    raw,
    kind,
    id,
    canOpenHistory: Boolean(id && (kind === 'chat' || kind === 'voice')),
    canOpenAutonomy: Boolean(id && (
      kind === 'scheduler'
      || kind === 'bracket'
      || kind === 'errand'
      || kind === 'arc'
      || kind === 'capsule'
    )),
  }
}
