// Parse a comma-separated string of IDs (chatIds/userIds) into a Set of
// trimmed non-empty strings. Used to match bridge senders against the
// owner whitelist, so the system prompt can treat the master's own
// Telegram/Discord messages as coming from the master rather than an
// external contact.
const MAX_BRIDGE_ID_SET_ENTRIES = 256

export function parseCsvIdSet(csv: unknown): Set<string> {
  const result = new Set<string>()
  if (typeof csv !== 'string') return result

  for (const raw of csv.split(',')) {
    const trimmed = raw.trim()
    if (trimmed) result.add(trimmed)
    if (result.size >= MAX_BRIDGE_ID_SET_ENTRIES) break
  }
  return result
}

export function resolveBridgeReplyTarget<TId, TEntry>(
  entriesById: ReadonlyMap<TId, TEntry>,
  latestEntry: TEntry | null,
  targetId?: TId | null,
): TEntry | null {
  if (targetId !== undefined && targetId !== null) {
    return entriesById.get(targetId) ?? null
  }
  return latestEntry
}
