# Nexus v0.4.3 — Companion Surface Cohesion & Transparency

**Status: Stable unsigned release.** v0.4.3 is the current stable version and
this document is its formal release record. Publication and platform assets are
created only from the release commit by the protected tag workflow; this
document does not claim that a GitHub asset exists before that workflow succeeds.

For this release only, the maintainer explicitly waived the normal multi-day
beta window after reviewing the complete automated release gate, local staging
verification, and the documented platform artifact contracts. Final binaries
must still be rebuilt by the protected workflow. No multi-day or cross-platform
physical-device evidence is claimed.

v0.4.3 keeps building the desktop companion awareness line after the stable
v0.4.0 foundation and the latest public v0.4.1 companion UI and reliability
follow-up. This slice makes the active Settings transparency surface
easier to trust and defines one restrained voice-first companion contract across
Live2D, the temporary caption, conversation history, and Settings. It does not
add new sensing, new prompts, or a new release entry point. The implementation
and comparison boundary is recorded in
[the v0.4.3 optimization and competitor plan](V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md).

## What Changed

- Added a deterministic companion-awareness transparency view model for the
  Settings block.
- Rendered the complete transparency contract on the active Memory Settings V3
  route instead of relying on a retired legacy section for audit evidence.
- Split the transparency explanation into labeled rows for what Nexus can
  observe, what reaches the model, and what is stored locally.
- Exposed explicit local reasons for blocked model reach and unavailable
  clear-summary actions.
- Added a local check-in rationale model so Settings can explain whether Nexus
  is staying quiet or allowed to appear gently without exposing raw signal keys.
- Added visible Settings rows for the recent coarse companion summary and the
  privacy boundary, so users can see what exists locally without seeing raw
  desktop content.
- Removed the resident voice button from the main Panel. Settings → Voice now
  handles save, start, stop, and cancel actions, while Frameless and Pet keep
  their direct voice entry.
- The three included Live2D models are Mao, Haru, and Hiyori. Local smoke,
  transparent-edge, and first-frame evidence is recorded for this release.
- Wired the chat desktop-context path to record the most recent local check-in
  decision, so active chat turns explain why proactive companionship stays
  quiet.
- Kept storage lifetime visible as short-lived session companion state: pausing
  stops collection and model reach but preserves the coarse recent summary, the
  latest local check-in decision, and minimal session/lifecycle/expiry metadata
  for explicit user review or clearing; disabling awareness still purges the
  recent companion data.
- Preserved a hard `rawContentVisible: false` invariant for the transparency
  contract.
- Added a lightweight invariant check so status labels, row ordering, clear
  action state, check-in rationale, coarse time language, and raw-content
  boundaries cannot drift silently.
- Kept the active V2 companion voice/Live2D-first by stopping legacy ambient
  weather polling and scene clocks on that path. Weather now has one Settings
  entry under Tools, with a manually entered city, explicit no-GPS/network
  disclosure, and local time reminders that include the device time-zone name.
  Network weather lookup occurs for an explicit weather question, a
  user-created weather reminder, or opt-in legacy ambient weather; device time
  remains entirely local.
- Localized weather conditions, lookup errors, current/daily summaries,
  result-card period labels, assistant summaries, and fallback speech across
  Simplified Chinese, Traditional Chinese, English, Japanese, and Korean.

## Unsigned Distribution Contract

Official GitHub Releases are the only supported binary source. v0.4.3 targets
macOS arm64, Windows x64, and Linux x64; it does not claim a macOS x64 or
universal artifact.

### macOS unsigned auto-update limitation

The macOS arm64 app is ad-hoc signed, not Apple Developer ID signed or
notarized. Ad-hoc signing does not establish Apple trust, and Gatekeeper may
require right-click → Open or explicit quarantine removal. The app only checks
for a newer version and opens the official release page; users manually
download and replace the app.

### Windows unsigned installer limitation

The Windows x64 NSIS installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning, and the installer cannot provide verified publisher
identity or established reputation. Users should proceed only after confirming
the artifact came from the official GitHub Release.

Each platform build publishes its own checksum list in the same GitHub Release:
`SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`, and
`SHA256SUMS-linux.txt`. Linux users who download one package format can run
`sha256sum --ignore-missing -c SHA256SUMS-linux.txt` to verify it.

Paused awareness blocks collection and model reach without silently deleting
existing short-lived local state. Clearing already-existing recent companion data
remains available as an explicit user action; disabling awareness still purges the
summary and decision.

## Privacy Boundary

The transparency view model must not carry raw window titles, screenshots,
clipboard bodies, message bodies, file paths, exact minute/second durations, or
desktop activity timelines.

The check-in transparency model exposes only coarse reason groups such as active
chat, quiet hours, focus protection, cooldown, duplicate suppression, or
eligible gentle appearance. It does not carry raw window titles or raw signal
keys.

The recent check-in decision stored for Settings is a short-lived local decision;
the storage boundary also carries only minimal session/lifecycle/expiry metadata.
The presence of a signal is retained only as a boolean decision detail, never as
the raw signal key.

The recent summary row shows only a coarse elapsed label and a broad activity
label. The privacy boundary row is static copy that keeps screenshots,
clipboard bodies, exact timers, file paths, and message bodies out of the UI
contract.

The current runtime writer is passive: it records the decision used for
Settings transparency, but it does not emit a proactive line, notification, or
message.

## Not Included

- Release entry points are published only by the protected stable-tag workflow
  after the release commit passes its required gates.
- No external notifications, message sending, tool execution, productivity
  score, raw timeline, new sensing source, pet movement, or desktop window
  control.
- No welcome page, dashboard, persistent greeting, automatic conversation-sheet
  opening, copied competitor skin, or new motion system.
- No persistent clock, weather card, weather particles, or full-window weather
  scene on the active V2 companion surface.
