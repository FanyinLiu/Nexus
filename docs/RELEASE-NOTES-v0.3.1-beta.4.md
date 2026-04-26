# Nexus v0.3.1-beta.4

> **Pre-release.** Audit + polish patch on top of v0.3.1-beta.3 — closes a memory data-loss race and a string of MEDIUM / LOW audit items, ships two new Settings panels (About + Help; Weekly Recap), Japanese / Korean i18n parity, and one round of error-message humanization. No breaking changes.

## What's in this release

### 🔴 Memory store: compaction race (data-loss class) — FIXED

The vector-memory store introduced in beta.3 used an append-only log that was periodically compacted into a snapshot. The compaction step drained pending log writes, snapshotted in-memory state, then unlinked the log — but any concurrent `upsertEntry` whose append landed between drain and unlink wrote a line that the snapshot did not capture and the unlink then erased. In-memory state stayed correct, but a crash inside that window dropped the mutation for good — directly violating the "she remembers me" promise the memory store backs.

Fix: compaction now atomically renames the active log to `<log>.compacting` before snapshotting. Concurrent appends after the rename open a fresh log file at the original path and survive cleanup. Recovery on next load replays the orphan `.compacting` log first (idempotent re-apply against the new snapshot), then the active log. A failed snapshot renames `.compacting` back so mutations are never stranded across a restart.

### 🟡 wake-word retry log: dedup latch fixed

The retry-loop log dedup added in `wakewordIntegration.ts` was ineffective — the latch cleared on every `'starting'` / `'checking'` edge, which the runtime cycles through every ~5s when the mic is unavailable, so the same `Wake word listener error: Requested device not found` was still spamming the log. Now only steady-state non-error phases (`listening` / `paused` / `cooldown` / `disabled`) clear the latch; transient retry phases keep it.

### 🛡️ Audit closures (M2 / M3 / M5 / M8 + L3 / L4 / L6)

Continuing from the beta.2 IPC-hardening sweep:

- **M2** — MCP per-tool approval gate (`mcpApprovals.js` + `mcpHost.js`). User-confirm dialog for each previously-unseen tool the model wants to call; persisted hash so legitimate tools are silent on subsequent runs.
- **M3** — `workspace:set-root` approval gate (`workspaceApprovals.js`). Same pattern as MCP: any new directory the renderer asks to mount as workspace root requires a native dialog before main reads/writes inside it.
- **M5** — `ipcRegistry` deferred-module load now kicks off immediately (`void loadDeferredModules()`) instead of waiting on a 1.5s timer.
- **M8** — Type-unsafe renderer-visible payloads tightened.
- **L3** — Plugin auto-start serial → parallel (`Promise.all`, errors isolated per plugin).
- **L4** — `auditLog` per-write `statSync` removed; size now tracked in memory with init from a single `stat` at startup.
- **L6** — Chat stream id moved to `crypto.randomUUID` with fallback to the legacy `Date.now() + Math.random()` pattern.

H4 (vault opaque-handle architecture) deferred to v1.0 — the 3/60s rate-limit cap from beta.2 already pushes pure enumeration out of any realistic attack window, and the full refactor touches every keyholder in the codebase.

### ✨ New Settings surface

- **About + Help panel** — version string, FAQ, credits. The pet's voice does the answering ("about how I came to be / how to use me well").
- **Weekly Recap panel** — local-only "this week with her" snapshot: significance-weighted memory highlights + relationship trend + voice-state hours. Reads from existing stores, no new persistence.

### 🌐 i18n parity

~660 untranslated UI strings now have Japanese and Korean translations. Placeholders aligned across all 5 locales — no `{name}` mismatches.

### 💬 Humanized errors

`src/lib/humanizeError.ts` translates raw runtime errors (ENOENT, ECONNREFUSED, 401, 403, 404, timeouts, …) into companion-voice messages instead of leaking stack traces to the chat surface. Covered by `tests/humanize-error.test.ts`.

### Misc polish

- `wakewordIntegration` AppleScript permission denial now latched (10-min retry instead of every-tick log spam after the user denies).
- `tts` log noise downgraded (segment-level events at `debug`, request-level at `info`).
- `PanelView.tsx` `useEffect` dep array fixed — final eslint warning on the codebase resolved.
- Onboarding step descriptions warmer across 5 locales.
- Minecraft + Factorio integrations hidden from Settings UI (kept in registry, just not surfaced).

## Backward compatibility

Zero. All data on disk migrates transparently. The new compaction layout is forward/backward compatible with the v0.3.1-beta.3 store (`.compacting` files from older builds simply don't exist on first run).

## Auto-update

Pre-release on the GitHub Releases page. Stable v0.3.0 users **do not** auto-update to it. Anyone on v0.3.1-beta.[1-3] will auto-upgrade on next launch (semver, same 0.3.1 track).

## How to try it

1. Download from the [v0.3.1-beta.4 release page](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.1-beta.4).
2. Unsigned build, same as previous betas:
   - **macOS**: `xattr -dr com.apple.quarantine /Applications/Nexus.app`
   - **Windows**: SmartScreen "More info → Run anyway"
3. Existing v0.3.x install data is picked up unchanged.

## What we want validated before stable v0.3.1

- ✅ Memory store: long sessions don't lose recent memories on a crash mid-compaction (hard to verify directly; smoke-test by running ~hour of conversation, force-quitting, restarting, and confirming recent topics are still recalled).
- ✅ Settings → About / Weekly Recap panels render correctly in all 5 locales.
- ✅ MCP per-tool approval prompts when the model first calls a new tool from an approved server.
- ✅ Workspace root change prompts when set to a never-before-approved directory.
- ✅ Wake-word log no longer spams when mic is missing.

If any of these regress, file an issue against `v0.3.1-beta.4` and we hold the stable promotion.

---

Full commit log between `v0.3.1-beta.3` and `v0.3.1-beta.4`: [compare](https://github.com/FanyinLiu/Nexus/compare/v0.3.1-beta.3...v0.3.1-beta.4).
