/**
 * Vault opaque-ref primitives — single source of truth shared by the Electron
 * main process (services/vaultRefs.js, ipc/vaultAudit.js) and the renderer
 * (src/lib/keyVaultBridge.ts). The prefix shape is a security contract: both
 * processes must agree on exactly one literal so ref detection never drifts.
 */
export const VAULT_REF_PREFIX = 'nexus-vault-ref:'

export function isVaultRef(value) {
  return typeof value === 'string' && value.startsWith(VAULT_REF_PREFIX)
}
