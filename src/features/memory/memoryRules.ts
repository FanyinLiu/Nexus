/**
 * Memory curation rules that the daily pass and the hot path both enforce.
 *
 * Prompt text is not enough: an operation without evidence is dropped,
 * sensitive text is not stored, and a run that would destroy too much is
 * aborted before any of those writes land.
 */

import { isProtectedMemory } from '../../lib/storage/memoryCap.ts'
import type { MemoryItem } from '../../types/memory.ts'

export const DESTRUCTIVE_OPS = new Set(['DELETE', 'SUPERSEDE', 'MERGE'])
export const EVIDENCE_OPS = new Set(['ADD', 'UPDATE', 'MERGE', 'SUPERSEDE', 'DELETE'])
/** Hard cap on rows a single run may retire. */
export const DESTRUCTIVE_ITEM_CAP = 10
export const DESTRUCTIVE_FRACTION = 0.2

export interface MemoryEvidenceInput {
  evidenceQuote?: string
  messageRef?: string
}

/**
 * How many active rows one run may retire.
 * The limit is 20% of the active set, and never more than 10.
 */
export function destructiveOpCap(activeCount: number): number {
  if (!Number.isFinite(activeCount) || activeCount <= 0) return 0
  const fraction = Math.floor(activeCount * DESTRUCTIVE_FRACTION)
  return Math.min(DESTRUCTIVE_ITEM_CAP, Math.max(1, fraction))
}

/** True when a mutating op is missing the quote or the message it came from. */
export function lacksEvidence(input: MemoryEvidenceInput | null | undefined): boolean {
  const quote = input?.evidenceQuote?.trim() ?? ''
  const ref = input?.messageRef?.trim() ?? ''
  return quote.length === 0 || ref.length === 0
}

/**
 * Text we will not write unless the user confirms it.
 * City-level "I live in Shanghai" is not a street address. A door number is.
 */
export function isSensitiveMemoryText(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (/(?:密码|密碼|口令)\s*(?:是|为|為|:|：)/u.test(value)) return true
  if (/\b(?:password|passcode|api[_ -]?key|secret)\b\s*(?:is|:|：)/iu.test(value)) return true
  if (/(?:银行卡|銀行卡|卡号|卡號|账号|賬號|account number)\s*[:：]?\s*\d{6,}/iu.test(value)) return true
  if (/\b\d{13,19}\b/u.test(value) && /(?:卡|账号|賬號|account)/iu.test(value)) return true
  if (/(?:身份证|身份證|护照号|護照號|社保号|社保號)\s*[:：]?\s*[0-9xX]{6,}/u.test(value)) return true
  if (/\b\d{17}[\dXx]\b/u.test(value)) return true
  if (/(?:血压|血壓|诊断|診斷|处方|處方|病历|病歷|怀孕|懷孕|癌|艾滋|HIV)/iu.test(value)) return true
  if (/(?:住在|住在|家住|地址|路|街|巷|弄).{0,12}\d+\s*号/u.test(value)) return true
  if (/\b\d+[^.\n]{0,24}\b(?:street|st|avenue|ave|road|rd)\b/iu.test(value)) return true
  if (/(?:他|她|他们|他們|别人|別人)的(?:手机号?|手機號?|电话|電話|住址|身份证|身份證|密码|密碼)/u.test(value)) return true
  if (/\b(?:his|her|their)\s+(?:password|address|phone|ssn|id number)\b/iu.test(value)) return true
  return false
}

/**
 * Rows the user owns. Open loops are not included: a due-date repair may
 * still touch an ordinary loop, and must not touch one the user pinned or edited.
 */
export function isUserOwnedMemory(memory: MemoryItem): boolean {
  return memory.importance === 'pinned'
    || memory.pinned === true
    || memory.userEdited === true
    || memory.userConfirmed === true
    || memory.source === 'manual'
}

/** Cap eviction and model rewrite also leave an open loop in place. */
export function isUserProtectedMemory(memory: MemoryItem): boolean {
  return isProtectedMemory(memory)
}

/**
 * Open loops that arrived through migration stay in the list and are
 * never handed to a proactive channel.
 */
export function isNagFreeMemory(memory: MemoryItem): boolean {
  return memory.migrated === true
}
