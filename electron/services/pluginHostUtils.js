import { createHash } from 'node:crypto'

/**
 * Hash a plugin command + args into a short hex digest.
 * Used to detect command changes since the user last approved a plugin.
 */
export function hashCommand(command, args = []) {
  return createHash('sha256')
    .update([command, ...args].join('\0'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Check if a plugin's command still matches its approved hash.
 * @param {{ id: string, command: string, args: string[] }} plugin
 * @param {Map<string, string>} approvedPlugins  id → command hash
 */
export function isPluginCommandTrusted(plugin, approvedPlugins) {
  const storedHash = approvedPlugins.get(plugin.id)
  // Falsy covers undefined (not approved) and '' (migrated from old format, needs re-approval)
  if (!storedHash) return false
  return storedHash === hashCommand(plugin.command, plugin.args)
}
