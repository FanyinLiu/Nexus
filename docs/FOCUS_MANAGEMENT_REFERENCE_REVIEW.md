# Focus Management Surface Reference Review

This note records the bounded Pro review for the `focus-management` surface.
It is a local implementation contract, not a transcript of the Pro answer.

## Source References

- Radix UI Primitives: borrow keyboard-first focus predictability for dialogs, menus, controlled primitives, Escape/Tab behavior, and accessible labelling.
- assistant-ui: borrow thread, message action, composer, and streaming focus separation without replacing Nexus state ownership.
- Cline: borrow human-in-the-loop approval and checkpoint focus boundaries without copying IDE, terminal, diff, or workbench chrome.

## Pro Review Summary

`focus-management` is an accessibility interaction contract layer, not a visual repaint layer.

The core judgment is: keyboard users must always know where they are, where focus will move next, how to exit, and whether a dangerous action is explicitly confirmed.

For Nexus, focus behavior must serve the companion-first side panel. It must not turn Settings, chat actions, or future desktop-control prompts into a dashboard, IDE extension, or agent workbench.

## Focus Management Contract

- Focus remains visible for all keyboard-reachable controls.
- Drawer open moves focus inside the drawer.
- Drawer close restores focus to the opener when possible.
- Section navigation keeps a stable order: close/back, title, navigation, active section heading, controls, footer actions.
- Section changes programmatically focus the new section heading with `tabIndex={-1}`.
- Hover-only actions are not allowed when the action can affect messages, settings, approval, or destructive work.
- Dangerous actions enter an explicit confirmation state before execution.
- Confirmation should prefer a safe focus target such as Cancel, not an accidental default confirm.
- Escape closes the current innermost modal-like layer and returns focus to a stable local target.
- Streaming and message updates must not steal composer focus while the user is typing.
- Approval prompts may take focus only when a dangerous or external action needs a decision.

## Current Nexus Baseline

- `SettingsDrawer` uses `role="dialog"`, `aria-modal="true"`, and `tabIndex={-1}`.
- `useModalFocusTrap` keeps Tab traversal inside the drawer while it is open.
- The drawer records the opener on open and restores focus on dismiss.
- Settings section headings are programmatically focusable and receive focus after section changes.
- Language menu keyboard handling supports Arrow, Home, End, and Escape with focus returning to the trigger.
- Appearance mode options use radio semantics and roving `tabIndex`.
- Settings CSS already contains visible `:focus-visible` rules for drawer controls, navigation, buttons, toggles, and cards.

## Implementation Route

1. Keep focus tokens scoped to settings or the affected surface.
2. Preserve focus return and section-heading focus before changing drawer layout.
3. Treat section navigation as stable navigation unless a true tablist contract is needed.
4. Add inline confirmation contracts for destructive settings before adding heavier dialogs.
5. Keep composer focus primary unless the user intentionally tabs into message actions, drawer controls, or approval prompts.
6. Use source-only audits for deterministic behavior boundaries and human review for perceived focus-ring quality.

## Automatic Checks

- `SettingsDrawer` keeps dialog semantics, modal focus trap, opener focus return, and section-heading focus handoff.
- `useModalFocusTrap` keeps Tab inside the drawer and ignores hidden or disabled controls.
- Settings CSS keeps visible `:focus-visible` behavior.
- `:focus-visible` rules must draw a visible local cue such as outline, ring, border, background, or text treatment; they must not only remove the browser outline.
- Focus styles do not use transform, scale, translate, wrapper z-index, or layout movement to communicate focus.
- The open-source reference registry maps `focus-management` to at least two references.

## Human Review Checks

- Focus rings are visible on dark, warm-day, and compact settings surfaces without becoming the primary visual event.
- Section changes do not feel like a panel jump.
- Dangerous confirmations are clear enough before execution.
- Composer remains the primary intent gateway while settings and message actions stay secondary.
- Reduced-motion mode still leaves focus visible without relying on animation or glow movement.

## Rejected Routes

- Rebuilding Settings as a card-heavy dashboard.
- Copying Cline terminal, diff, approval, or IDE extension chrome.
- Importing Radix or assistant-ui demo skins to solve local focus behavior.
- Adding a global focus manager when a local drawer contract is enough.
- Using strong glow, wrapper scale, z-index lift, or layout movement as focus treatment.
