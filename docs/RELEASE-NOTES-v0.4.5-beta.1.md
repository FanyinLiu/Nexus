# Nexus v0.4.5-beta.1 — Maintenance and hardening beta

> **Beta.** This is the v0.4.5 maintenance beta. It contains no new runtime
> features and no user-facing behavior changes — the same release posture as
> the v0.4.4 stable. It exists to validate a large internal cleanup slice
> before a stable v0.4.5: reliability fixes, security hardening, and a
> significant dead-code removal. Stable users are NOT auto-upgraded; beta
> installers are for manual validation.

## What changes for users

Nothing user-visible. The chat surface, voice pipeline, settings layout,
companion behavior, and privacy boundaries behave exactly as in v0.4.4.

Under the hood, v0.4.5-beta.1 carries:

- **Reliability fixes** — background errands interrupted by a process exit
  are re-queued on next boot; deleting every chat session or memory no longer
  resurrects legacy storage; memory decay is no longer compounded across
  dream cycles; chat turn hard-timeout and tool-call loop edge cases are
  closed; VAD voice sessions survive wake-word listener rebuilds.
- **Security hardening** — SSRF bypasses on chat completion paths closed;
  corrupted `vault.json` is never overwritten; high-risk IPC schemas reject
  unknown fields (vault, game connect, and the phase-three rollout).
- **Internal cleanup** — the superseded legacy settings panels (~12 k lines)
  and the never-enabled TTS pipeline were removed; relative imports were
  unified to explicit `.ts`/`.tsx` extensions; ~270 unused exports and other
  dead code were deleted. Audit baselines (error redaction, message privacy,
  forms/settings surface) were migrated to the V3 implementation they now
  guard.

## Known issues

- This beta needs real-world validation on macOS, Windows, and Linux after
  the large internal cleanup. Please report anything that looks different
  from v0.4.4 — especially in Settings, voice conversation, and nightly
  errand behavior.
- Unsigned build caveats are unchanged: macOS requires right-click → Open
  (or quarantine removal) on first launch; Windows may show a SmartScreen
  unknown-publisher warning. Verify downloads against the per-platform
  `SHA256SUMS-*.txt` from the official GitHub Release.
- v0.5 desktop pet behavior remains deferred until the v0.4 line is proven
  coherent.

## Feedback

Use the GitHub **Beta Validation Report** template if you use one, or simply
report what you observed. Focus areas for this maintenance beta:

- Settings: open every section (model, chat, memory, voice, tools, window,
  integrations, autonomy) and confirm each renders and saves as in v0.4.4.
- Voice: wake word, continuous VAD conversation, and streaming TTS output.
- Nightly: an errand queued before sleep completes and surfaces in the
  morning.
- Memory: delete-all still behaves like delete-all (no resurrection after
  restart).
