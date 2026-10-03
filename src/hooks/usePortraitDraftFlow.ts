import { useEffect, useSyncExternalStore } from 'react'
import { createPortraitDraftFlow } from '../features/pet/portraitDraftFlow.ts'

// Keep in-flight native operations shared when a settings section unmounts.
const flow = createPortraitDraftFlow({ getBridge: () => window.desktopPet })

export function usePortraitDraftFlow(active: boolean) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot)
  useEffect(() => {
    if (active) return flow.open()
  }, [active])
  return { state, refresh: flow.refresh, setConsent: flow.setConsent, download: flow.download, generate: flow.generate, setExportName: flow.setExportName, setExportAttribution: flow.setExportAttribution, exportDraft: flow.exportDraft }
}
