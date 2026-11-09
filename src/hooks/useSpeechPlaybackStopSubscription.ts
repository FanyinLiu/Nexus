import { useCallback, useEffect, useRef } from 'react'

/**
 * Run the local stop-all when the peer window asks main to fan out Stop.
 * The callback is read through a ref so the IPC subscription stays mounted
 * once even though the voice bindings are rebuilt on every render.
 */
export function useSpeechPlaybackStopSubscription(stopLocally: () => void): () => void {
  const stopLocallyRef = useRef(stopLocally)

  useEffect(() => {
    stopLocallyRef.current = stopLocally
  })

  useEffect(() => {
    const unsubscribe = window.desktopPet?.subscribeSpeechPlaybackStop?.(() => {
      stopLocallyRef.current()
    })
    return () => { unsubscribe?.() }
  }, [])

  return useCallback(() => { stopLocallyRef.current() }, [])
}
