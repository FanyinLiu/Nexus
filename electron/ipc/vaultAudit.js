const VAULT_REF_PREFIX = 'nexus-vault-ref:'

function summarizeSlot(slot) {
  return {
    present: typeof slot === 'string' && slot.length > 0,
    length: typeof slot === 'string' ? slot.length : 0,
  }
}

function summarizeSlotList(slots) {
  const list = Array.isArray(slots) ? slots.filter((slot) => typeof slot === 'string') : []
  return {
    count: list.length,
    totalLength: list.reduce((sum, slot) => sum + slot.length, 0),
  }
}

function summarizeEntries(entries) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return {
      count: 0,
      slotNameTotalLength: 0,
      nonEmptyValueCount: 0,
      valueTotalLength: 0,
    }
  }

  const normalizedEntries = Object.entries(entries)
  return {
    count: normalizedEntries.length,
    slotNameTotalLength: normalizedEntries.reduce((sum, [slot]) => sum + slot.length, 0),
    nonEmptyValueCount: normalizedEntries.filter(([, value]) => String(value ?? '').length > 0).length,
    valueTotalLength: normalizedEntries.reduce((sum, [, value]) => sum + String(value ?? '').length, 0),
  }
}

function isVaultRef(value) {
  return typeof value === 'string' && value.startsWith(VAULT_REF_PREFIX)
}

function summarizeVaultRef(value) {
  return {
    present: isVaultRef(value),
    length: typeof value === 'string' ? value.length : 0,
  }
}

export function summarizeVaultRequest(channel, payload = {}) {
  switch (channel) {
    case 'vault:is-available':
    case 'vault:list-slots':
      return { channel }
    case 'vault:store':
      return {
        channel,
        slot: summarizeSlot(payload?.slot),
        plaintextLength: typeof payload?.plaintext === 'string' ? payload.plaintext.length : 0,
      }
    case 'vault:retrieve':
    case 'vault:delete':
      return {
        channel,
        slot: summarizeSlot(payload?.slot),
      }
    case 'vault:store-many':
      return {
        channel,
        entries: summarizeEntries(payload?.entries),
      }
    case 'vault:retrieve-many':
      return {
        channel,
        slots: summarizeSlotList(payload?.slots),
      }
    default:
      return { channel }
  }
}

export function summarizeVaultResult(channel, result, error = null) {
  if (error) {
    return {
      channel,
      ok: false,
      resultKind: 'error',
      errorName: error?.name,
      errorMessageLength: error?.message ? String(error.message).length : 0,
    }
  }

  const resultKind = Array.isArray(result)
    ? 'array'
    : result === null
      ? 'null'
      : typeof result

  const summary = {
    channel,
    ok: true,
    resultKind,
    errorMessageLength: 0,
  }

  if (typeof result === 'boolean') {
    summary.available = result
  } else if (typeof result === 'string') {
    summary.ref = summarizeVaultRef(result)
  } else if (Array.isArray(result)) {
    summary.slots = summarizeSlotList(result)
  } else if (result && typeof result === 'object') {
    const entries = Object.entries(result)
    summary.returnedSlotCount = entries.length
    summary.returnedSlotNameTotalLength = entries.reduce((sum, [slot]) => sum + slot.length, 0)
    summary.refCount = entries.filter(([, value]) => isVaultRef(value)).length
    summary.refTextTotalLength = entries.reduce((sum, [, value]) => (
      sum + (typeof value === 'string' ? value.length : 0)
    ), 0)
  }

  return summary
}
