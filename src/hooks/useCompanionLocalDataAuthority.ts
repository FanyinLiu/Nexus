import { useEffect, useState } from 'react'
import {
  COMPANION_LOCAL_DATA_AUTHORITY_CHANGED_EVENT,
  hydrateCompanionLocalDataCache,
  isCompanionLocalDataAuthorityActive,
} from '../lib/storage/companionLocalDataMigration.ts'

export function useCompanionLocalDataAuthority(): boolean {
  const [active, setActive] = useState(() => isCompanionLocalDataAuthorityActive())

  useEffect(() => {
    const handleAuthorityChange = () => setActive(isCompanionLocalDataAuthorityActive())
    window.addEventListener(COMPANION_LOCAL_DATA_AUTHORITY_CHANGED_EVENT, handleAuthorityChange)
    return () => window.removeEventListener(COMPANION_LOCAL_DATA_AUTHORITY_CHANGED_EVENT, handleAuthorityChange)
  }, [])

  useEffect(() => {
    if (!active) return
    void hydrateCompanionLocalDataCache()
  }, [active])

  return active
}
