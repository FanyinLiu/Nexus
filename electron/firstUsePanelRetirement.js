/**
 * Two-phase retirement state for the transient first-use panel.
 *
 * A renderer request only starts a pending confirmation. The panel is destroyed
 * only after the same webContents confirms, while the same window is still
 * hidden, the visibility epoch has not changed, and the request is fresh. Any
 * show/focus/replacement cancels the pending request.
 */

/** @typedef {{ nonce: string, target: object, webContentsId: number, epoch: number, requestedAt: number }} PendingRetirement */
/**
 * `retired` is a session-wide one-way latch: a panel rebuilt to take over
 * reminders must never arm the first-use path again.
 * @typedef {{ pending: PendingRetirement | null, visibilityEpoch: number, retired: boolean }} RetirementState
 */
/** @typedef {{ nonce: string, target: object | null, webContentsId: number, visible: boolean }} RetirementRequest */
/** @typedef {{ nonce?: string, target?: object | null, webContentsId?: number, visible?: boolean, now?: number, maxAgeMs?: number }} RetirementConfirmation */

/** @returns {RetirementState} */
export function createFirstUsePanelRetirementState() {
  return { pending: null, visibilityEpoch: 0, retired: false }
}

/**
 * @param {RetirementState} state
 * @returns {number}
 */
export function bumpFirstUsePanelVisibilityEpoch(state) {
  state.visibilityEpoch += 1
  state.pending = null
  return state.visibilityEpoch
}

/** @param {RetirementState} state */
export function cancelPendingFirstUsePanelRetirement(state) {
  state.pending = null
}

/**
 * @param {RetirementState} state
 * @param {RetirementRequest} input
 * @returns {PendingRetirement | null}
 */
export function beginFirstUsePanelRetirement(state, { nonce, target, webContentsId, visible }) {
  if (!nonce || !target || visible || state.pending || state.retired) return null
  state.pending = {
    nonce,
    target,
    webContentsId,
    epoch: state.visibilityEpoch,
    requestedAt: Date.now(),
  }
  return state.pending
}

/**
 * Consume the pending request. Any mismatch/failure clears it permanently;
 * a later request must be a new explicit confirmation cycle.
 * @param {RetirementState} state
 * @param {RetirementConfirmation} input
 * @returns {{ retired: boolean, reason: string | null }}
 */
export function confirmFirstUsePanelRetirement(state, {
  nonce,
  target,
  webContentsId,
  visible,
  now = Date.now(),
  maxAgeMs = 3000,
} = {}) {
  const pending = state.pending
  if (!pending) return { retired: false, reason: 'no_pending' }
  state.pending = null
  if (pending.nonce !== nonce) return { retired: false, reason: 'nonce_mismatch' }
  if (pending.target !== target) return { retired: false, reason: 'target_replaced' }
  if (pending.webContentsId !== webContentsId) return { retired: false, reason: 'sender_mismatch' }
  if (pending.epoch !== state.visibilityEpoch) return { retired: false, reason: 'visibility_epoch_changed' }
  if (visible) return { retired: false, reason: 'panel_visible' }
  if (now - pending.requestedAt > maxAgeMs) return { retired: false, reason: 'expired' }
  state.retired = true
  return { retired: true, reason: null }
}
