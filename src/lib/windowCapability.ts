/**
 * Renderer-side probe for channels the main process classifies as panel-only
 * (settings vault, external-action policy sync).
 *
 * The main process stays the authority and still rejects every unauthorized
 * call (fail-closed). This helper only prevents the pet window from firing IPC
 * that is guaranteed to reject there: a rejected vault read used to abort the
 * pet's settings hydration, which in turn could leave the Live2D boot path
 * without a model after onboarding finished in the panel.
 */

// The preload bridge object is stable for a window's lifetime, so its role
// resolves once even when a settings commit asks several times.
const capabilityByBridge = new WeakMap<object, Promise<boolean>>()

/**
 * Resolve whether this renderer window may use panel-only bridge channels.
 * Browser previews and test harnesses without a bound window role are treated
 * as panel-like; in Electron the preload probe reports the creation-time role.
 */
export function canUsePanelOnlyBridge(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  const bridge = window.desktopPet
  if (!bridge) return Promise.resolve(false)

  const cached = capabilityByBridge.get(bridge)
  if (cached) return cached

  const probe = bridge.isPanelWindow
  if (typeof probe !== 'function') {
    // No window-role binding (browser preview / unit-test fake bridge).
    const access = bridge.vaultStore != null || bridge.externalActionPolicySync != null
    const resolved = Promise.resolve(access)
    capabilityByBridge.set(bridge, resolved)
    return resolved
  }

  const resolved = Promise.resolve()
    .then(() => probe.call(bridge))
    .then(
      (isPanel) => isPanel === true,
      // A failing probe must not grant panel-only access.
      () => false,
    )
  capabilityByBridge.set(bridge, resolved)
  return resolved
}
