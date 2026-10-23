// The panel's opening chat intent is delivered twice: once on the section
// event, and again by the mount catch-up invoke. Those two copies share one
// token. Applying the second copy reopens chat after Back and unmounts the
// More button underneath a click that already found it. A later request bumps
// the token, so asking for chat again still opens it.

/**
 * @typedef {'chat' | 'settings'} PanelSectionName
 * @typedef {'text' | 'recent' | null} PanelChatIntent
 * @typedef {{ section: PanelSectionName, intent: PanelChatIntent, intentToken: number }} PanelSectionState
 * @typedef {{ section: PanelSectionName, intent: PanelChatIntent, intentToken: number }} PanelSectionSnapshot
 */

/**
 * @returns {PanelSectionState}
 */
export function initialPanelSectionState() {
  return { section: 'chat', intent: null, intentToken: 0 }
}

/**
 * One open-panel request. Text and recent each take a new token; plain chat
 * and settings clear the intent without looking like a fresh text request.
 * @param {PanelSectionState} state
 * @param {string} section
 * @returns {PanelSectionState}
 */
export function requestPanelSection(state, section) {
  const intent = section === 'chat-text' ? 'text' : section === 'chat-recent' ? 'recent' : null
  return {
    section: section === 'settings' ? 'settings' : 'chat',
    intent,
    intentToken: intent ? state.intentToken + 1 : state.intentToken,
  }
}

/**
 * What the event and the catch-up invoke both carry. No live intent means no
 * token, so a cleared request cannot match one the renderer already applied.
 * @param {PanelSectionState} state
 * @returns {PanelSectionSnapshot}
 */
export function panelSectionSnapshot(state) {
  return {
    section: state.section,
    intent: state.intent,
    intentToken: state.intent ? state.intentToken : 0,
  }
}

/**
 * The catch-up invoke consumes the intent so a later read is not a second
 * request. The token stays so the event copy still matches the one applied.
 * @param {PanelSectionState} state
 * @returns {PanelSectionState}
 */
export function consumePanelSectionIntent(state) {
  return { ...state, intent: null }
}

/**
 * @param {number} appliedToken
 * @param {Partial<PanelSectionSnapshot> | null | undefined} snapshot
 * @returns {{ open: boolean, appliedToken: number }}
 */
export function panelChatIntentDecision(appliedToken, snapshot) {
  const intent = snapshot?.intent
  if (intent !== 'text' && intent !== 'recent') return { open: false, appliedToken }
  const token = Number(snapshot?.intentToken) || 0
  if (token !== 0 && token === appliedToken) return { open: false, appliedToken }
  return { open: true, appliedToken: token === 0 ? appliedToken : token }
}
