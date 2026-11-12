// @ts-check
/**
 * Payload schema for the macOS notification-watcher toggle.
 *
 * `appsPattern` is a free-form predicate forwarded to the watcher, so this
 * boundary only pins its type; the watcher owns pattern semantics.
 */

import { validateIpcPayload } from './schemaValidator.js'

const watcherSetSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    enabled: { type: 'boolean', optional: true },
    appsPattern: { type: 'string', optional: true },
  },
}

/**
 * @param {unknown} payload
 * @returns {{ enabled?: boolean, appsPattern?: string }}
 */
export function validateNotificationWatcherSetPayload(payload) {
  return /** @type {{ enabled?: boolean, appsPattern?: string }} */ (
    validateIpcPayload('notification:watcher-set', payload, watcherSetSchema)
  )
}
