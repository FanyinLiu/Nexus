/**
 * Pairing-code flow for the messaging gateways (bridge plan Phase 2 #4,
 * modeled on OpenClaw's dmPolicy:"pairing").
 *
 * Deny-by-default left a UX hole: to allow even YOURSELF you had to dig up
 * your numeric chat ID by hand. Now an unauthorized sender gets a one-time
 * 6-digit code back, the desktop shows the pending request, and approving
 * it in Settings writes the ID into the allowlist. Security properties
 * (per the 2026 device-linking phishing lessons): codes are short-lived
 * (1 h), per-sender unique, capped at 3 pending per gateway, and approval
 * happens on the already-trusted side — the desktop app.
 *
 * Pure module — no Electron imports — so node:test covers it directly.
 */

import { randomInt } from 'node:crypto'

/**
 * @param {{ maxPending?: number, ttlMs?: number, now?: () => number, generateCode?: () => string }} [options]
 */
export function createPairingManager(options = {}) {
  const maxPending = options.maxPending ?? 3
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000
  const now = options.now ?? (() => Date.now())
  const generateCode = options.generateCode ?? (() => String(randomInt(100000, 1000000)))

  /** @type {Map<string, { code: string, name: string, createdAt: number }>} */
  const pending = new Map()

  function prune() {
    const cutoff = now() - ttlMs
    for (const [senderId, entry] of pending) {
      if (entry.createdAt <= cutoff) pending.delete(senderId)
    }
  }

  return {
    /**
     * Called when a message arrives from a sender outside the allowlist.
     * @param {string} senderId
     * @param {string} [name]
     * @returns {{ kind: 'created', code: string } | { kind: 'existing' } | { kind: 'capped' }}
     */
    requestPairing(senderId, name) {
      prune()
      const key = String(senderId)
      if (pending.has(key)) {
        // Repeat messages from the same stranger must NOT mint new codes or
        // re-trigger replies — that would let anyone make the bot spam.
        return { kind: 'existing' }
      }
      if (pending.size >= maxPending) return { kind: 'capped' }
      const code = generateCode()
      pending.set(key, { code, name: String(name ?? '').slice(0, 64), createdAt: now() })
      return { kind: 'created', code }
    },

    /** Remove a request after the desktop approved or dismissed it. */
    resolve(senderId) {
      return pending.delete(String(senderId))
    },

    /** @returns {Array<{ senderId: string, name: string, code: string, createdAt: number }>} */
    list() {
      prune()
      return [...pending].map(([senderId, entry]) => ({
        senderId,
        name: entry.name,
        code: entry.code,
        createdAt: entry.createdAt,
      }))
    },

    clear() {
      pending.clear()
    },
  }
}
