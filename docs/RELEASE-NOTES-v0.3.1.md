# Nexus v0.3.1

> **Stable.** Cumulative release on top of v0.3.0. **Emotion line** as the headline: the user-affect data layer that landed in beta.3 now feeds back into every reply through three real-time guidance shims and a Gottman repair detector. Also includes the IPC-security audit closures from beta.2-beta.4, the M1 memory-store data-loss fix, the multi-day Live2D / TTS / multimodal regression sweep, and a tightened release-gate (`prerelease-check.mjs` now runs 26 checks across 6 stages).

This release is the result of a four-month validation window: betas 1 through 5 each closed a distinct class of issue. Every change here has at least 24 hours of real-world conversation behind it.

## What changes for the user

### 🧠 The companion's tone now adapts (M1.4–M1.7)

Until v0.3.0, the user-affect timeline (Russell circumplex VAD samples, Kuppens dynamics) only fed the Sunday letter. From this release it shapes **every assistant reply** through five mutually-exclusive guidance states injected per turn:

- **Stuck-low** (chronic): when the 14-day baseline shows persistent low valence + high inertia, the companion backs off advice, leans into acknowledging, asks shorter questions, and doesn't introduce new topics. Kuppens 2015 pattern.
- **Recent-drop** (acute): when the 3-day short window has dropped sharply below the long-window baseline, the companion slows the pace, holds back premature reframing, stays present without interrogating. Trull 2008 EMA distinction.
- **Volatile**: when variability is high lately, the companion matches the room rather than steering, doesn't frame or interpret feelings.
- **Steady-warm**: when the user is steady on the warmer side, the companion matches the energy without dampening.
- **None**: stays out of the prompt entirely.

The prose explicitly forbids naming the state to the user — descriptive, not clinical.

**Gottman rupture/repair (M1.7)** detects all four Horsemen on the user side toward the companion: criticism (regex on you-always / 你总是), contempt (regex on dumb-bot / 破机器, the most-corrosive horseman), defensiveness (我没说 / 그런 뜻 아니), and stonewalling (brevity-drop heuristic). When detected, the next turn carries a soft start-up + accept-influence repair prompt. Defensiveness explicitly forbids "what I meant was…", stonewalling explicitly forbids "is everything okay?".

These all run silently — there is no badge, indicator, or rating widget. The companion just responds differently when it should.

### 🔒 Two CVEs cleared

`pixi-live2d-display@0.4.0` was pulling `gh-pages@4.0.0` as a runtime dependency by upstream packaging mistake; both had critical prototype-pollution CVEs even though `gh-pages` is never actually invoked at runtime (zero references in dist). Pinned via `npm overrides` to `gh-pages@^6.3.0`. `npm audit --omit=dev` now reports 0 vulnerabilities.

### 🛡️ IPC + security audit closures

Six of seven HIGH and all MEDIUM items from the 2026-04-24 audit are now fixed:

- **H2** MCP arbitrary spawn — per-tool approval gate (`mcpHost.js`)
- **H3** notification SSRF — `checkUrlSafety` on every channel
- **H5** chat baseUrl SSRF — `checkChatBaseUrlSafety`
- **H6** runtime-state schema — `sanitizeBySchema`
- **H7** chat stream `done:true` — try/catch/finally always emits terminal frame
- **H8** doctor:probe-local-services pinned to loopback
- **M1** vector index disk thrash — append-only log + 10-min compaction (~30× less write volume)
- **M2** MCP per-tool approval — `snapshotInitialTools` + `promptMcpToolApproval`
- **M3** workspace:set-root dialog — `workspaceApprovals.js` + dialog gate
- **M5** ipcRegistry blind 1.5s timer removed
- **L3/L4/L6** miscellaneous polish

**H4 (vault opaque-handle refactor)** is documented as deferred to v1.0; the partial mitigation (3/60s rate-limit cap + audit log + WeakMap-per-sender) is on stable now.

### 🐛 Major bug fixes

- **🔴 Memory compaction race** (M1 data-loss class): the vector-memory append-only log compaction step could erase a concurrent write within the drain → snapshot → unlink window. Fixed via a rename-then-snapshot pattern; orphan log replays on next load.
- **🔴 Live2D in packaged builds**: pixi.js's shader path needs `'unsafe-eval'` in the renderer CSP, which only the dev `<meta>` granted before — dmg / exe builds rendered nothing. CSP now correct in `electron/rendererServer.js`.
- **✅ Thinking-mode models**: DeepSeek-R1 / QwQ / Hunyuan-thinking / Qwen-thinking work across multi-turn conversations. `reasoning_content` flows through chat / tool-call loop / agent loop; old chat histories self-heal on next turn.
- **✅ TTS lifecycle**: three-layer safety net so voiceState never wedges on `speaking` (forgotten onEnd path closed; catch-block controller cleanup; 90 s last-resort timeout).
- **✅ Multimodal turns**: attached images survive every follow-up turn (template-string coercion bug fixed in time-prefix injection).
- **✅ Voice barge-in mood**: `tts:interrupted` now resets pet mood to `idle` (parity with `tts:completed` / `tts:error`); previously a barge-in left the avatar stuck on the SPEAKING mood.
- **✅ Mic-stream leak**: a `MediaRecorder` constructor failure with an unsupported mimeType used to keep the active mic permission held. Now releases stream tracks before re-throwing.
- **✅ Errand scheduler race**: a 60s+-running errand could leak into the next 5-min tick and start a *different* queued errand in parallel against the same stale runner state, bypassing the nightly cap. Fixed with a module-level lock + re-read.
- **✅ Lorebook stale closure**: rapid edits across two rows would drop the first edit; now uses functional setState.
- **✅ Notification-channel race**: same closure-capture-during-await pattern that the lorebook fix addresses.
- **✅ Bracket scheduler**: same read-state-await-write race as errand; same fix.
- **✅ ContextScheduler StrictMode**: `setTasks` updater no longer dispatches actions inside the updater (would double-fire under StrictMode).
- **✅ MemoryDream StrictMode**: `setMemories` updater no longer calls `archiveMemories` (a side effect that writes to localStorage) — would have double-archived under StrictMode.
- **✅ Yearbook + letter $&-corruption**: `String.replace(pattern, replacement)` interprets `$&` / `$$` / `$'` / `$\`` in the replacement string, silently corrupting user-typed memory content / letter excerpts. All three sites switched to function-form replacement (4 instances total across fillTemplate / openArcDelivery / yearbookRender / onThisDayPrompt).
- **✅ Polynomial regex backtracking**: en-US contempt rupture-detection pattern simplified from `\s*[,.\s]*\s*` to `[\s,.]{0,4}`.
- **✅ Telemetry data loss**: `VALID_KINDS` set in guidanceTelemetry was missing two of the eight `GuidanceKind` values; defensiveness + stonewalling fires were silently dropped on reload.

### ✨ Quality-of-life

- **About + Help panel**: version string, FAQ, credits in the companion's voice ("about how I came to be / how to use me well")
- **Weekly Recap panel**: local-only "this week with her" snapshot — significance-weighted memory highlights + relationship trend + voice-state hours
- **Humanized errors**: `src/lib/humanizeError.ts` translates ENOENT / ECONNREFUSED / 401 / 403 / 404 / timeouts into companion-voice messages instead of leaking stack traces to chat
- **In-app diagnostics**: Settings → Console → Diagnostics now captures voice / TTS / chat lifecycle into a ring buffer; "Copy to clipboard" gives full context for bug reports
- **5-locale i18n parity**: ~660 previously-untranslated strings now have Japanese + Korean translations; placeholders aligned across all 5 locales

### 🧹 UI streamlining

The Letters / Future capsules / Errands / Open threads / Mood map sections that landed during the v0.3.1 betas have been **pulled from the settings drawer** for this stable. The underlying schedulers and data layers continue to run — Sunday letters still generate weekly, capsules still deliver on schedule, errands still execute their queue, multi-day arcs still ping at day 3 / 5, the user-affect timeline keeps feeding the per-turn guidance — but the explicit UI surfaces are gone for now. Re-mounting any of them is a one-line diff in `SettingsDrawer.tsx`.

This is intentional: the companion's emotional adaptation is meant to be *felt*, not configured.

### 🔧 Internal infrastructure (not user-facing)

- **Property-based testing**: 22 fast-check properties covering 8 pure-function modules (affectGuidance / ruptureDetection / coregulation / yearbookAggregator / etc.). Found one real bug (the `$&` template-replace issue above).
- **Performance benchmarks**: 16-task tinybench suite. Found one real perf bug (the silent self-summarisation analyzer was 877 ms; now 1.15 ms after adding sample sort + binary search — a **750× speedup**).
- **Mutation testing**: Stryker pass over 12 modules; overall 60.45% mutation score, beta.5 core modules all ≥ 73%.
- **Live memory profile**: 90 s baseline + stress + settle. No leaks observed (RSS stable at ~249 MB through 30× drawer toggle + idle).
- **Static-bug audit (4 rounds, 30+ items fixed)**: cross-cutting agent passes flagged storage validation gaps, async race conditions, switch exhaustiveness, NaN guards, dynamic-import error handling, and stale-closure bugs across the chat / memory / voice / lorebook / autonomy paths.

### 🗒 Pre-release gate (`prerelease-check.mjs`)

The release-tag gate has been expanded from 8 checks to 26 across 6 stages:

- **A**. Process / version (tag shape, package.json sync, git state, CI green)
- **B**. Code quality (verify:release, smoke, coverage, bundle ceiling, benchmarks)
- **C**. Security (npm audit, Electron webPreferences, version floors, secrets scan, CSP)
- **D**. Asset integrity (5-locale presence, sherpa models, dist artefacts)
- **E**. Docs + compliance (release notes, README sync × 5 locales, license scan, AI-Act disclosure)
- **F**. Privacy + governance (telemetry-host scan, audit deferrals, unsigned-build caveats)

Beta tags get a subset; stable tags must clear all 6 stages. See `docs/RELEASING.md` for the full list.

## Storage migration

On first launch after this update, `pruneLegacyStorageKeys()` removes four orphan keys from your `localStorage` (`nexus:scheduled-jobs`, `nexus:session-store`, `nexus:skills`, `nexus:agent-memory`). They were unused since the 2026-04-16 dead-tree prune; the sweep is idempotent and silently no-ops if the keys are absent. No user-visible data is affected.

## 📥 Download

**https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.1**

## 🔄 Auto-update

- v0.3.0 stable users → auto-upgrade on next launch via `electron-updater`.
- v0.3.1-beta.\[1-5\] users → also auto-upgrade (semver compare is happy with `0.3.1` > `0.3.1-beta.5`).

## ⚠️ Unsigned build (known limitation)

This stable is unsigned, like v0.3.0:

- **macOS**: `xattr -dr com.apple.quarantine /Applications/Nexus.app` after install
- **Windows**: SmartScreen → "More info" → "Run anyway"

Code-signing infrastructure (Apple notarytool + Azure Trusted Signing) is on the v0.4 line.

## 🙏 Thanks

Built on:

- **Russell (1980)** — circumplex valence × arousal
- **Kuppens et al. (2015)** — affect dynamics: inertia + variability  
- **Trull et al. (2008)** — EMA trait-level vs. state-level affect
- **Mikulincer & Shaver (2007)** — secure-attachment co-regulation
- **Welivita & Pu (2020)** — empathy-intent taxonomy
- **Gottman** — Four Horsemen of relationship breakdown + soft start-up + accept influence

Full beta notes for context: [`v0.3.1-beta.4`](RELEASE-NOTES-v0.3.1-beta.4.md), [`v0.3.1-beta.5`](RELEASE-NOTES-v0.3.1-beta.5.md).
