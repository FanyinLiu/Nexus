// @ts-check
import { validateIpcPayload } from './schemaValidator.js'
import {
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

// Slot names mirror the legacy requireSlotName helper in validate.js:
// word chars, dots, colons, dashes. The pattern keeps path traversal
// out of vault slot names.
const VAULT_SLOT_PATTERN = /^[\w.:-]+$/

// Generous ceiling well above any legitimate settings hydration batch
// (7 built-in key fields plus a handful of provider profiles), tight
// enough to bound a hostile enumerate/flood attempt.
const VAULT_BULK_MAX_ITEMS = 256

const vaultSlotSchema = {
  type: 'string',
  trim: true,
  allowEmpty: false,
  maxLength: SHORT_TEXT_MAX,
  pattern: VAULT_SLOT_PATTERN,
}

// Plaintext secrets are stored verbatim (no trim); empty string is
// allowed, matching the legacy expectString semantics.
const vaultPlaintextSchema = {
  type: 'string',
  maxLength: SECRET_TEXT_MAX,
}

const vaultStoreSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    slot: vaultSlotSchema,
    plaintext: vaultPlaintextSchema,
  },
}

const vaultSlotPayloadSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    slot: vaultSlotSchema,
  },
}

// store-many crosses the wire as an entry list (not a slot-keyed map)
// so every field stays schema-validated with unknown-key rejection.
const vaultStoreManySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    entries: {
      type: 'array',
      maxItems: VAULT_BULK_MAX_ITEMS,
      items: {
        type: 'object',
        unknown: 'reject',
        fields: {
          slot: vaultSlotSchema,
          plaintext: vaultPlaintextSchema,
        },
      },
    },
  },
}

const vaultRetrieveManySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    slots: {
      type: 'array',
      maxItems: VAULT_BULK_MAX_ITEMS,
      items: vaultSlotSchema,
    },
  },
}

/**
 * @param {unknown} payload
 * @returns {{ slot: string, plaintext: string }}
 */
export function validateVaultStorePayload(payload) {
  return /** @type {{ slot: string, plaintext: string }} */ (validateIpcPayload('vault:store', payload, vaultStoreSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ slot: string }}
 */
export function validateVaultSlotPayload(channel, payload) {
  return /** @type {{ slot: string }} */ (validateIpcPayload(channel, payload, vaultSlotPayloadSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ entries: Array<{ slot: string, plaintext: string }> }}
 */
export function validateVaultStoreManyPayload(payload) {
  return /** @type {{ entries: Array<{ slot: string, plaintext: string }> }} */ (validateIpcPayload('vault:store-many', payload, vaultStoreManySchema))
}

/**
 * @param {unknown} payload
 * @returns {{ slots: string[] }}
 */
export function validateVaultRetrieveManyPayload(payload) {
  return /** @type {{ slots: string[] }} */ (validateIpcPayload('vault:retrieve-many', payload, vaultRetrieveManySchema))
}
