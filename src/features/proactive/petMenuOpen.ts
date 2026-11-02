/**
 * Renderer side of the pet right-click menu result.
 *
 * The main process resolves `'messages'` when the user picked the Messages row
 * and `null` when the menu merely closed. This factory keeps that decision out
 * of the React hook so it is testable with a fake bridge, and the hook only
 * supplies the real bridge and the overlay opener.
 */

export type PetMenuResult = 'messages' | null

export type CreatePetMenuOpenHandlerOptions = {
  /** Invoke the native menu; `undefined` means the bridge is unavailable. */
  openPetMenu: () => Promise<PetMenuResult> | undefined
  /** Called only when the menu result asks for the inbox overlay. */
  openInboxOverlay: () => void
  /** Optional logger for a rejected menu invocation. */
  onError?: () => void
}

/**
 * Build the pet-menu callback. It never rejects, so a menu failure cannot
 * surface as an unhandled rejection in the renderer.
 */
export function createPetMenuOpenHandler({
  openPetMenu,
  openInboxOverlay,
  onError,
}: CreatePetMenuOpenHandlerOptions): () => Promise<void> {
  return async () => {
    try {
      const result = await openPetMenu()
      if (result === 'messages') openInboxOverlay()
    } catch {
      onError?.()
    }
  }
}
