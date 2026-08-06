import { randomUUID } from 'node:crypto'
import { isVaultRef, VAULT_REF_PREFIX } from '../../shared/vaultRefs.js'
import { vaultRetrieveMany } from './keyVault.js'

/** @public kept exported for the vault security audit contract (scripts/vault-security-audit.mjs). */
export { VAULT_REF_PREFIX } from '../../shared/vaultRefs.js'

const MAX_REFS_PER_SENDER = 512

/** @type {WeakMap<object, Map<string, { slot: string, issuedAt: number }>>} */
const _refsBySender = new WeakMap()

function getSenderRefs(sender) {
  let refs = _refsBySender.get(sender)
  if (!refs) {
    refs = new Map()
    _refsBySender.set(sender, refs)
  }
  return refs
}

function trimSenderRefs(refs) {
  while (refs.size > MAX_REFS_PER_SENDER) {
    const oldest = refs.keys().next().value
    if (!oldest) break
    refs.delete(oldest)
  }
}

function decodeVaultRefToken(value) {
  if (!isVaultRef(value)) return ''
  return value.slice(VAULT_REF_PREFIX.length).trim()
}

export function issueVaultRefForSender(sender, slot) {
  const normalizedSlot = String(slot ?? '').trim()
  if (!sender || !normalizedSlot) {
    throw new Error('Cannot issue vault ref: sender/slot missing')
  }

  const refs = getSenderRefs(sender)
  const token = randomUUID().replaceAll('-', '')
  refs.set(token, {
    slot: normalizedSlot,
    issuedAt: Date.now(),
  })
  trimSenderRefs(refs)
  return `${VAULT_REF_PREFIX}${token}`
}

export async function resolveVaultRefsForSender(sender, source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source
  }

  const names = Array.isArray(fields) ? fields.filter((f) => typeof f === 'string' && f.trim()) : []
  if (!names.length) return source

  /** @type {Record<string, string>} */
  const slotByField = {}
  const refs = sender ? _refsBySender.get(sender) : null

  for (const field of names) {
    const token = decodeVaultRefToken(source[field])
    if (!token) continue
    if (!refs) throw new Error(`payload.${field} references an unknown vault token`)
    const entry = refs.get(token)
    if (!entry) throw new Error(`payload.${field} references an expired vault token`)
    slotByField[field] = entry.slot
  }

  const slots = [...new Set(Object.values(slotByField))]
  if (!slots.length) return source

  const values = await vaultRetrieveMany(slots)
  const resolved = { ...source }

  for (const [field, slot] of Object.entries(slotByField)) {
    resolved[field] = String(values?.[slot] ?? '')
  }

  return resolved
}
