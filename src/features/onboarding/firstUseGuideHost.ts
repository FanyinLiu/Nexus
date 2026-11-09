/**
 * First-use setup belongs to the panel in Electron because only that window
 * may access the settings vault. Browser previews keep their local guide.
 * A handoff never carries a settings draft or marks onboarding as completed.
 */
export function resolveFirstUseGuideHost({
  pending,
  view,
  canOpenPanel,
}: {
  pending: boolean
  view: 'pet' | 'panel'
  canOpenPanel: boolean
}): 'none' | 'local' | 'panel' {
  if (!pending) return 'none'
  return view === 'pet' && canOpenPanel ? 'panel' : 'local'
}

/**
 * Panel surfaces that mean the user is still doing something. Retirement is
 * only safe on the bare first-use panel; a draft, guide or overlay must keep
 * the ordinary hide-and-reuse lifecycle. The class list is asserted by the
 * hook test so renaming a surface cannot silently disable the guard.
 */
export const FIRST_USE_PANEL_TRANSIENT_SURFACE_SELECTORS = [
  '.chat-sheet-v2',
  '.settings-v2',
  '.sd',
  '.onboarding-card',
  '.sunday-letter-reader',
  '[role="dialog"]',
] as const

/** Selector used to detect any open transient surface on the panel. */
export function firstUsePanelTransientSurfaceSelector(): string {
  return FIRST_USE_PANEL_TRANSIENT_SURFACE_SELECTORS.join(', ')
}

/** A minimal DOM query surface so the guard stays testable outside Electron. */
export type FirstUsePanelSurfaceQuery = {
  querySelector: (selector: string) => unknown
}

/** Whether an open transient surface blocks first-use panel retirement. */
export function hasOpenFirstUsePanelTransientSurface(
  root: FirstUsePanelSurfaceQuery | null | undefined,
): boolean {
  if (!root) return false
  return Boolean(root.querySelector(firstUsePanelTransientSurfaceSelector()))
}

/**
 * A completed first-use panel may be retired only while it is still the
 * pristine onboarding surface. Once the user has a draft, a user message, an
 * active stream, a pending attachment, settings, or an unfinished guide, the
 * ordinary hide-and-reuse lifecycle must win.
 */
export function shouldRetireFirstUsePanel(input: {
  firstUsePanel: boolean
  onboardingPending: boolean
  onboardingOpen: boolean
  settingsOpen: boolean
  busy: boolean
  hasDraft: boolean
  hasPendingImage: boolean
  hasUserMessage: boolean
  voiceActive: boolean
  petRuntimeOnline: boolean
}): boolean {
  return input.firstUsePanel
    && input.petRuntimeOnline
    && !input.onboardingPending
    && !input.onboardingOpen
    && !input.settingsOpen
    && !input.busy
    && !input.voiceActive
    && !input.hasDraft
    && !input.hasPendingImage
    && !input.hasUserMessage
}

/** Reuse a single launch attempt across repeated effect subscriptions. */
export function createFirstUsePanelHandoff({ openPanel }: { openPanel: () => Promise<void> }) {
  let pending: Promise<void> | null = null
  return () => {
    pending ??= Promise.resolve().then(openPanel)
    return pending
  }
}
