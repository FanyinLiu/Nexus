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

// ── Auto-reply decision ──────────────────────────────────────────────────────

export type BridgeAutoReplyDecision =
  | { kind: 'send' }
  | { kind: 'skip'; reason: 'disabled' | 'no-target' | 'not-owner' | 'read-only' }

/**
 * Decide whether a completed companion reply should be routed back to the
 * originating bridge chat. Replies only ever go back to the owner's own
 * message (never to external contacts — that would let a stranger use the
 * companion as a relay). The auto-reply toggle is the user's standing
 * confirmation for this action, so permission mode 'confirm' does not block
 * it; 'read-only' always does.
 */
export function decideBridgeAutoReply(options: {
  autoReplyEnabled: boolean
  permissionMode: string
  target: { isOwner: boolean } | null
}): BridgeAutoReplyDecision {
  if (!options.autoReplyEnabled) return { kind: 'skip', reason: 'disabled' }
  if (!options.target) return { kind: 'skip', reason: 'no-target' }
  if (!options.target.isOwner) return { kind: 'skip', reason: 'not-owner' }
  if (options.permissionMode === 'read-only') return { kind: 'skip', reason: 'read-only' }
  return { kind: 'send' }
}

/** Containers Telegram renders as a voice bubble; everything else is skipped. */
export function isTelegramVoiceCompatibleMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';')[0].trim()
  return ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a']
    .includes(normalized)
}

// ── Busy-aware forward queue ─────────────────────────────────────────────────

export type BridgeForwardQueue = {
  push: (text: string) => void
  dispose: () => void
  /** Visible for tests/diagnostics. */
  size: () => number
}

/**
 * Bridge messages used to be dropped on the floor when the assistant was
 * mid-reply (useChat.sendMessage returns false while busy and only voice
 * input got a recovery path). This queue retries while the chat is busy and
 * only gives up — loudly, via onDrop — when a send is rejected while idle
 * (a real refusal, e.g. the crisis panel) or the queue overflows.
 */
export function createBridgeForwardQueue(options: {
  send: (text: string) => Promise<boolean>
  isBusy: () => boolean
  onDrop: (text: string, reason: 'overflow' | 'rejected') => void
  retryMs?: number
  maxQueue?: number
  schedule?: (fn: () => void, ms: number) => void
}): BridgeForwardQueue {
  const retryMs = options.retryMs ?? 2_500
  const maxQueue = options.maxQueue ?? 16
  const schedule = options.schedule ?? ((fn, ms) => { setTimeout(fn, ms) })
  const queue: string[] = []
  let draining = false
  let disposed = false

  async function drain(): Promise<void> {
    if (draining || disposed) return
    draining = true
    try {
      while (queue.length > 0 && !disposed) {
        if (options.isBusy()) {
          schedule(() => { void drain() }, retryMs)
          return
        }
        const text = queue[0]
        const accepted = await options.send(text)
        if (accepted) {
          queue.shift()
          continue
        }
        if (options.isBusy()) {
          // Lost the race: something else started a turn between our check
          // and the send. Keep the message and retry after the turn ends.
          schedule(() => { void drain() }, retryMs)
          return
        }
        queue.shift()
        options.onDrop(text, 'rejected')
      }
    } finally {
      draining = false
    }
  }

  return {
    push(text: string) {
      if (disposed) return
      if (queue.length >= maxQueue) {
        const dropped = queue.shift()
        if (dropped !== undefined) options.onDrop(dropped, 'overflow')
      }
      queue.push(text)
      void drain()
    },
    dispose() {
      disposed = true
      queue.length = 0
    },
    size: () => queue.length,
  }
}
