# Nexus v0.3.6 — The foundation is ready for the next companion step.

> **Foundation wrap-up.** This release closes the v0.3 line around the work that
> makes Nexus safe to grow: privacy boundaries, visible memory controls,
> readable settings, and explicit desktop-awareness switches. It does not add
> the new v0.4 desktop-companion sensing loop yet.

## What changes for users

### Settings are easier to read

- Day and warm-day Settings surfaces keep card text, toggle labels, footer
  actions, and release controls readable over the companion panel artwork.
- Control labels and helper text use a consistent compact size so Settings
  feels calmer and easier to scan.
- Empty notification summary cards stay hidden when there are no unread
  notifications.

### Desktop awareness is visible, but still controlled

The Memory settings page now shows the three desktop-awareness sources Nexus can
use:

- active-window context
- clipboard context
- screen OCR

Each source shows whether it is enabled, ready, off, or unavailable. The page
also states the privacy boundary plainly: Nexus sends sanitized text summaries
to chat context, not raw screenshots.

### The 0.3 line is deliberately closing

v0.3 already built the base Nexus needs before larger companion behavior:

- safety and redaction foundations
- memory visibility and pause controls
- settings surfaces for model, companion, memory, voice, tools, and autonomy
- desktop-context privacy checks
- release and packaging gates

The next big companion step should not be squeezed into a patch release.

## What stays out of v0.3.6

- No always-on screen recorder.
- No automatic mouse/keyboard control.
- No desktop pet following the cursor yet.
- No new autonomous work-agent behavior.
- No time-passing proactive companionship loop yet.

Those belong to later milestones:

- **v0.4.0:** desktop companion awareness — Nexus quietly understands that time
  is passing while the user works elsewhere, then can check in at coarse,
  respectful intervals.
- **v0.5.0:** desktop pet behavior — the visible companion reacts to mouse,
  typing, idleness, and desktop context without getting in the user's way.

## Validation focus

Before promoting v0.3.6, verify:

- Settings remains readable in day, warm-day, and night themes.
- Memory -> Context Awareness shows active-window, clipboard, and OCR status.
- The status rows fit the current panel without hiding behind the save bar.
- Desktop context privacy gates still pass.
- Release alignment tests point to v0.3.6.

## Known issues

- macOS packages are still unsigned in local smoke builds. Gatekeeper may keep
  the quarantine bit, so first launch may require the usual right-click -> Open
  flow or, for advanced users, removing quarantine with `xattr`.
- Windows installer trust still depends on a real signing certificate; unsigned
  builds may show SmartScreen warnings.
- The v0.4.0 desktop-companion sensing loop is intentionally not included in
  this release.
