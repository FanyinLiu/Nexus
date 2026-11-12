/**
 * Suppression fingerprints for memories the user deleted one by one.
 *
 * A delete writes only a versioned SHA-256 fingerprint of the normalized
 * wording (first 128 bits), never the wording itself. Matching is exact after
 * trim / whitespace collapse / lowercase / trailing-punctuation removal; no
 * fuzzy or semantic matching is attempted.
 *
 * Unprefixed 32-bit fingerprints from the first format are dropped on read:
 * they stored no plaintext, so they cannot be rehashed into the new format.
 * This also keeps a mixed store from treating bare hashes as live tombstones.
 */

import { sha256Hex } from '../../lib/sha256.ts'

/** Keep the newest tombstones only; older facts may be extracted again. */
export const FORGOTTEN_MEMORY_LIMIT = 500

/** 128 bits of SHA-256, hex-encoded, under the current format version. */
const FINGERPRINT_PATTERN = /^v2:[0-9a-f]{32}$/
const FINGERPRINT_HEX_LENGTH = 32

/** Case, whitespace, and trailing punctuation are not part of the identity. */
export function normalizeForgottenMemoryText(content: string): string {
  return content
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\p{P}]+$/gu, '')
    .trim()
}

/** Empty text returns an empty fingerprint so it is never stored. */
export function fingerprintForgottenMemoryText(content: string): string {
  const normalized = normalizeForgottenMemoryText(content)
  if (!normalized) return ''
  return `v2:${sha256Hex(normalized).slice(0, FINGERPRINT_HEX_LENGTH)}`
}

/** True when the exact normalized text is in the suppression list. */
export function isForgottenMemoryText(
  content: string,
  fingerprints: readonly string[] | undefined,
): boolean {
  if (!fingerprints?.length) return false
  const fingerprint = fingerprintForgottenMemoryText(content)
  return Boolean(fingerprint) && fingerprints.includes(fingerprint)
}

/** Add or refresh one tombstone, returning a new capped list. */
export function addForgottenMemoryFingerprint(
  fingerprints: readonly string[],
  content: string,
): string[] {
  const fingerprint = fingerprintForgottenMemoryText(content)
  if (!fingerprint) return [...fingerprints]
  return [
    fingerprint,
    ...fingerprints.filter((entry) => entry !== fingerprint),
  ].slice(0, FORGOTTEN_MEMORY_LIMIT)
}

/** Drop one tombstone, e.g. after the user manually adds the fact again. */
export function removeForgottenMemoryFingerprint(
  fingerprints: readonly string[],
  content: string,
): string[] {
  const fingerprint = fingerprintForgottenMemoryText(content)
  if (!fingerprint) return [...fingerprints]
  return fingerprints.filter((entry) => entry !== fingerprint)
}

/** Tolerate corrupt blobs and duplicate rows; keep only well-formed entries. */
export function parseForgottenMemoryFingerprints(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const fingerprints: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !FINGERPRINT_PATTERN.test(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    fingerprints.push(item)
    if (fingerprints.length >= FORGOTTEN_MEMORY_LIMIT) break
  }
  return fingerprints
}
