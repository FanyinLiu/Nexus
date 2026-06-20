import { ipcMain } from 'electron'
import {
  vaultStore,
  vaultDelete,
  vaultListSlots,
  vaultStoreMany,
  vaultIsAvailable,
} from '../services/keyVault.js'
import { issueVaultRefForSender } from '../services/vaultRefs.js'
import {
  requireTrustedSender,
  requireSlotName,
  requireSlotNames,
  requireVaultEntries,
  expectString,
} from './validate.js'
import { audit } from '../services/auditLog.js'
import {
  summarizeVaultRequest,
  summarizeVaultResult,
} from './vaultAudit.js'

// Per-sender rate limit on bulk vault operations. Hostile renderer code
// (XSS in chat-rendered markdown, compromised plugin page) could
// otherwise enumerate every stored API key in milliseconds via
// retrieve-many. The limit is generous for legit settings hydration on
// startup but kicks in fast enough to make brute exfil noisy.
const BULK_OP_WINDOW_MS = 60_000
const BULK_OP_MAX_PER_WINDOW = 6

// Per-sender rate limit on single-slot retrieve. Closes the slow-burn
// enumeration gap (one retrieve every 11s would otherwise drain every
// known slot in a few minutes, evading the bulk limit). The legitimate
// renderer never calls vaultRetrieve(slot) directly — settings hydration
// always goes through vaultRetrieveMany — so a tight ceiling here costs
// nothing and forces an attacker to trip the audit log loudly.
const SINGLE_RETRIEVE_WINDOW_MS = 60_000
const SINGLE_RETRIEVE_MAX_PER_WINDOW = 3

const _bulkOpHistory = new WeakMap() // webContents → [timestamps]
const _singleRetrieveHistory = new WeakMap() // webContents → [timestamps]

function rateLimitBulkOp(event, opName) {
  const now = Date.now()
  const history = _bulkOpHistory.get(event.sender) ?? []
  const recent = history.filter((t) => now - t < BULK_OP_WINDOW_MS)
  if (recent.length >= BULK_OP_MAX_PER_WINDOW) {
    audit('vault', `${opName}-rate-limited`, { recentCount: recent.length })
    throw new Error(
      `vault ${opName} rate-limited: more than ${BULK_OP_MAX_PER_WINDOW} bulk operations in 60s — `
      + 'looks like programmatic enumeration. Check the audit log.',
    )
  }
  recent.push(now)
  _bulkOpHistory.set(event.sender, recent)
}

function rateLimitSingleRetrieve(event, slotName) {
  const now = Date.now()
  const history = _singleRetrieveHistory.get(event.sender) ?? []
  const recent = history.filter((t) => now - t < SINGLE_RETRIEVE_WINDOW_MS)
  if (recent.length >= SINGLE_RETRIEVE_MAX_PER_WINDOW) {
    audit('vault', 'retrieve-rate-limited', {
      slot: {
        present: typeof slotName === 'string' && slotName.length > 0,
        length: typeof slotName === 'string' ? slotName.length : 0,
      },
      recentCount: recent.length,
    })
    throw new Error(
      `vault retrieve rate-limited: more than ${SINGLE_RETRIEVE_MAX_PER_WINDOW} single retrievals in 60s `
      + '— renderer should batch via vault:retrieve-many. Check the audit log for the slot list.',
    )
  }
  recent.push(now)
  _singleRetrieveHistory.set(event.sender, recent)
}

async function runAuditedVaultAction(channel, payload, action) {
  audit('vault', 'request', summarizeVaultRequest(channel, payload))
  try {
    const result = await action()
    audit('vault', 'result', summarizeVaultResult(channel, result))
    return result
  } catch (error) {
    audit('vault', 'result', summarizeVaultResult(channel, undefined, error))
    throw error
  }
}

export function register() {
  ipcMain.handle('vault:is-available', async (event) => {
    requireTrustedSender(event)
    return runAuditedVaultAction('vault:is-available', {}, () => vaultIsAvailable())
  })

  ipcMain.handle('vault:store', async (event, slot, plaintext) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    const value = expectString(plaintext, 'plaintext')
    return runAuditedVaultAction('vault:store', { slot: name, plaintext: value }, () => vaultStore(name, value))
  })

  ipcMain.handle('vault:retrieve', async (event, slot) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    return runAuditedVaultAction('vault:retrieve', { slot: name }, () => {
      rateLimitSingleRetrieve(event, name)
      return issueVaultRefForSender(event.sender, name)
    })
  })

  ipcMain.handle('vault:delete', async (event, slot) => {
    requireTrustedSender(event)
    const name = requireSlotName(slot)
    return runAuditedVaultAction('vault:delete', { slot: name }, () => vaultDelete(name))
  })

  ipcMain.handle('vault:list-slots', async (event) => {
    requireTrustedSender(event)
    return runAuditedVaultAction('vault:list-slots', {}, () => {
      rateLimitBulkOp(event, 'list-slots')
      return vaultListSlots()
    })
  })

  ipcMain.handle('vault:store-many', async (event, entries) => {
    requireTrustedSender(event)
    const validated = requireVaultEntries(entries)
    return runAuditedVaultAction('vault:store-many', { entries: validated }, () => vaultStoreMany(validated))
  })

  ipcMain.handle('vault:retrieve-many', async (event, slots) => {
    requireTrustedSender(event)
    const names = requireSlotNames(slots)
    return runAuditedVaultAction('vault:retrieve-many', { slots: names }, () => {
      rateLimitBulkOp(event, 'retrieve-many')
      /** @type {Record<string, string>} */
      const refs = {}
      for (const name of names) {
        refs[name] = issueVaultRefForSender(event.sender, name)
      }
      return refs
    })
  })
}
