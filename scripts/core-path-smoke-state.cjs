/**
 * Readiness rules for the core path smoke run.
 *
 * The smoke script drives the built app and asks two questions: is the
 * panel usable, and did the settings drawer reach a usable page. Both
 * answers are pure functions of the page snapshot, so they live here
 * and can be checked by a unit test instead of by grepping the script.
 */

/**
 * The panel is ready when the V2 surface has its stage, its utility
 * button and enough room, or when the legacy surface still shows its
 * own chat parts.
 */
function isV2PanelReady(state) {
  if (state.panelSurface === 'v2') {
    return Boolean(
      state.hasV2Root
      && state.hasV2Stage
      && state.hasV2Utility
      && state.panelWidth >= 240
      && state.panelHeight >= 500,
    )
  }
  return Boolean(
    state.hasRoot
    && state.hasPanel
    && state.hasToolbar
    && state.hasSettingsButton
    && state.hasComposer
    && state.hasSendButton
    && state.panelWidth >= 240
    && state.panelHeight >= 500,
  )
}

/**
 * The settings drawer is ready on the V2 home, on the V2 connect page,
 * or on the legacy settings home.
 */
function isSettingsEntryReady(state) {
  const v2Ready = Boolean(state.hasSettingsV2) && Boolean(
    (state.hasSettingsV2Home && state.hasSettingsV2AdvancedCard)
    || (state.settingsV2Destination === 'connect' && state.hasV2ModelContent),
  )
  const legacyReady = Boolean(
    (state.hasSettingsHome && state.hasModelCard)
    || (state.hasModelPage && !state.hasSettingsV2),
  )
  return Boolean(state.hasSettingsDrawer) && (v2Ready || legacyReady)
}

module.exports = { isV2PanelReady, isSettingsEntryReady }
