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

/** Reuse a single launch attempt across repeated effect subscriptions. */
export function createFirstUsePanelHandoff({ openPanel }: { openPanel: () => Promise<void> }) {
  let pending: Promise<void> | null = null
  return () => {
    pending ??= Promise.resolve().then(openPanel)
    return pending
  }
}
