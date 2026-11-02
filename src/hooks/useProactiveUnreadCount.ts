import { useEffect, useState } from 'react'

import { createLogger } from '../lib/logger.ts'
import { normalizeNonNegativeInteger } from '../lib/normalize.ts'

const log = createLogger('proactive.inbox')

/**
 * Live unread count behind the pet's red dot.
 *
 * Lifecycle only: one initial read, then whatever `inbox:changed` pushes. The
 * push is metadata-only (count, changed ids, removed ids), which is all this
 * hook needs. The label/no-label decision belongs to the feature module.
 */
export function useProactiveUnreadCount(): number {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const bridge = window.desktopPet
    if (!bridge?.listProactiveInbox) return
    let cancelled = false
    // A push that lands while the initial read is in flight is newer than
    // that read, so the read must not overwrite it when it finally resolves.
    let pushApplied = false

    const applyPush = (value: unknown) => {
      if (cancelled) return
      pushApplied = true
      setUnreadCount(normalizeNonNegativeInteger(value))
    }

    void bridge.listProactiveInbox()
      .then((snapshot) => {
        if (cancelled || pushApplied) return
        setUnreadCount(normalizeNonNegativeInteger(snapshot.unreadCount))
      })
      .catch(() => {
        log.warn('proactive inbox read failed', { errorPresent: true })
      })

    const unsubscribe = bridge.subscribeProactiveInbox?.((change) => applyPush(change.unreadCount))
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return unreadCount
}
