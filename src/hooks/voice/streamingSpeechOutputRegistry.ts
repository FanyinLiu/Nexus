import type { StreamingSpeechOutputController } from './types.ts'

/**
 * Every live controller, including one created while another reply speaks.
 * Stop has to abort all of them; the single active ref is not enough.
 */
const activeControllers = new Set<StreamingSpeechOutputController>()

/** Register a controller from the moment it can start streaming. */
export function addActiveStreamingController(controller: StreamingSpeechOutputController): void {
  activeControllers.add(controller)
}

/** Drop a controller on settle, failure, or abort so Stop cannot reach it. */
export function removeActiveStreamingController(controller: StreamingSpeechOutputController): void {
  activeControllers.delete(controller)
}

/** Abort every controller live at the instant the user presses Stop. */
export function abortAllStreamingSpeechOutputs(): void {
  for (const controller of [...activeControllers]) controller.abort()
}
