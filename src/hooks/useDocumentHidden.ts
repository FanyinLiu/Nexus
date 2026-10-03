import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

export function useDocumentHidden(): boolean {
  return useSyncExternalStore(subscribe, () => document.hidden, () => true)
}
