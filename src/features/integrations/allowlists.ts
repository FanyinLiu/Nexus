export const MAX_INTEGRATION_WHITELIST_ENTRIES = 256

function parseDelimitedList<T>(
  raw: unknown,
  parse: (piece: string) => T | null,
  keyFor: (value: T) => string,
): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  if (typeof raw !== 'string') return out

  for (const piece of raw.split(',')) {
    const value = parse(piece.trim())
    if (value == null) continue

    const key = keyFor(value)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(value)
    }

    if (out.length >= MAX_INTEGRATION_WHITELIST_ENTRIES) break
  }

  return out
}

export function parseTelegramChatIdList(raw: unknown): number[] {
  return parseDelimitedList(
    raw,
    (piece) => {
      if (!/^-?\d+$/.test(piece)) return null
      const value = Number(piece)
      if (!Number.isSafeInteger(value) || value === 0) return null
      return value
    },
    String,
  )
}

export function parseDiscordChannelIdList(raw: unknown): string[] {
  return parseDelimitedList(
    raw,
    (piece) => (/^\d{1,20}$/.test(piece) ? piece : null),
    (value) => value,
  )
}

/**
 * Append an ID to a comma-separated allowlist, deduplicating and keeping the
 * existing entries' order. Used by the pairing-approval flow.
 */
export function appendIdToCsvList(csv: unknown, id: string): string {
  const existing = typeof csv === 'string'
    ? csv.split(',').map((piece) => piece.trim()).filter(Boolean)
    : []
  const trimmed = id.trim()
  if (!trimmed || existing.includes(trimmed)) return existing.join(', ')
  return [...existing, trimmed].join(', ')
}
