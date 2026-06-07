import { readJson, writeJson } from './core.ts'

const PENDING_GREETING_KEY = 'nexus:pending-companion-greeting'

/**
 * A Character-Card import stashes the card's greeting (first_mes) here so the
 * chat layer can open the next empty conversation with it. Decoupled on
 * purpose: the settings UI writes it (it can't reach the chat message state),
 * and the chat hook consumes it once on the next empty thread.
 */
export function savePendingGreeting(greeting: string): void {
  const text = greeting.trim()
  if (!text) return
  writeJson(PENDING_GREETING_KEY, { greeting: text })
}

/** Read the pending greeting once, clearing it so it never repeats. */
export function takePendingGreeting(): string | null {
  const stored = readJson<{ greeting?: string } | null>(PENDING_GREETING_KEY, null)
  try {
    window.localStorage.removeItem(PENDING_GREETING_KEY)
  } catch {
    // best-effort; a failed clear is non-critical
  }
  const text = stored?.greeting?.trim()
  return text || null
}
