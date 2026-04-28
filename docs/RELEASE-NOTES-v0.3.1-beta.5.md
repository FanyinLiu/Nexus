# Nexus v0.3.1-beta.5

> **Pre-release.** Emotion-as-main-line release on top of beta.4. The user-affect data layer (M1.1) finally feeds back into every reply and into two new keepsake exports — Sunday-letter HTML and a 12-month yearbook. Adds a multi-day "open threads" ritual, a Gottman rupture/repair detector, a silent self-summarisation loop that closes M1.4–M1.7, and a 700-LOC dead-tree prune. No breaking changes; localStorage migration is automatic.

## What's in this release

### 🧠 Emotion now shapes every reply (M1.4–M1.7)

Until this release, the user-affect timeline + dynamics layer that landed in beta.3's M1.1 was only consumed by the Sunday letter. From this release, every assistant reply gets a per-turn shim that injects a small system-prompt fragment based on the user's recent affect.

- **M1.4 — Affect-aware reply shaping.** A 14-day snapshot establishes baseline + variability + inertia (Russell 1980 + Kuppens 2015). Three guidance states fire mutually-exclusively: *stuck-low* (chronic; back off advice, lean acknowledging, no new topics), *volatile* (mood swings; match the room, stay grounded), *steady-warm* (steady; match without dampening). Each prose explicitly forbids naming the state to the user — descriptive, not clinical.
- **M1.5 — Recent-drop detector.** A 3-day short window compared against the 14-day baseline catches acute events ("something landed today"). Fires when recent valence dropped ≥0.2 below baseline. Trull 2008 EMA distinction between trait-level and state-level affect.
- **M1.6 — Co-regulation signal.** Joins the user's affect timeline against the companion's emotion timeline. Computes counter-balance (mean companion warmth on user-low days minus on user-not-low days) + Pearson valence×warmth correlation. Surfaces under the mood map as a single line: *co-regulating* (Mikulincer & Shaver secure-attachment shape), *mirroring* (co-rumination risk), or *flat*.
- **M1.7 — Gottman rupture/repair.** All four Horsemen now detected: criticism + contempt (single-message regex, 5-locale), defensiveness (single-message regex, "I never said / 我没说 / 誤解 / 그런 뜻 아니"), and stonewalling (brevity-drop heuristic — latest reply ≤10 chars after prior 3 user messages each ≥40 chars). On fire, the next turn gets a soft-start-up + accept-influence repair posture in the prompt; defensiveness explicitly forbids "what I meant was…", stonewalling explicitly forbids "is everything okay?". All conservative — false positives are worse than misses.
- **Silent self-summarisation.** Every guidance fire records `{kind, ts, beforeValence}` to a capped local log — no UI, no rating widget, no user-facing feedback (per the silent-emotion principle). A weekly background analyzer joins the log against the user-affect timeline and emits a per-kind valence-delta report (mean valence in the 24h after fire vs the 24h before, paired across fires). The report sits silently in localStorage for future threshold tuning to consume. Adaptation stays invisible to the user.

### 📓 Two new keepsake artifacts (M2.2 / M2.3 / M2.4)

The "narrative artifact" thesis ships its first downloadable forms.

- **M2.2 — Mood map panel.** A 30-day SVG of daily-binned valence + arousal under Settings → Console, alongside the Kuppens snapshot stats and the M1.6 co-regulation line.
- **M2.4 — Sunday-letter export.** Each saved Sunday letter now has a "Save" button that produces a self-contained HTML file (serif body, narrow column, calm header, CJK + Latin font stacks, `@media print` hides the footer for clean Cmd+P → PDF). All styling inlined, works offline, no external assets.
- **M2.3 — 12-month yearbook export.** A "Export 12-month yearbook" button on the mood map panel produces a single longer HTML document covering the past 365 days: title page → year-wide affect snapshot → co-regulation summary → 12 monthly mini mood-maps with inline SVG → relationship milestones (chronological level-ups) → memory highlights (top 8 by importance × recall × emotional-significance score) → chronological letter excerpts → closing note from her. 5-locale, same calm typography as the single-letter export.

### 🧵 Multi-day open threads (M3)

A new manual ritual for things that don't resolve in one sitting. The user opens a thread ("manager 1:1 friday", "talking to mom about the move"); the companion follows up at preset milestones (default day 3 + day 5) with one OS notification per milestone; on day 7 with no resolution the thread auto-drops gracefully. Each follow-up uses milestone-specific 5-locale prose ("still on your mind?" vs "has it landed?"). Manual approval contract — the runner never opens an arc on its own. Settings → Open threads exposes create / close (with optional closing note) / let-go.

### 🔌 Settings drawer wiring

Errands and Future-self time capsules — both shipped in earlier sprints with working schedulers — never had their UI panels mounted in the settings drawer until this release. Both panels now appear under Letters, with their own section IDs and 5-locale labels + descriptions. Klein's "为啥要跳过啊" feedback honoured.

### 🧹 Cleanup pass (-700 LOC)

Three orphan modules pruned plus four orphan storage keys with a one-shot localStorage sweep so existing user storage is cleaned up automatically:

- `src/features/encryption/` (135 LOC, 5 files) — replaced long ago by the vault IPC; unused since v1.0 initial release.
- `src/features/harness/` (560 LOC, 7 files) — an evaluation-loop spike that never connected to anything.
- `src/hooks/useHearingSnapshot.ts` (13 LOC) — HearingRuntime is consumed via direct subscription elsewhere; the wrapper had no callers.
- 4 storage-key constants (`SCHEDULED_JOBS / SESSION_STORE / SKILLS / AGENT_MEMORY`) left behind by the 2026-04-16 dead-tree prune. New `pruneLegacyStorageKeys()` runs on app startup, idempotent, silently swallows failures so the chat path can never break on cleanup.

### 🐛 Bug fixes

- **Settings drawer renders again.** A `Record<SettingsSectionId, ...>` table in `settingsDrawerMetadata.ts` was missing the new capsule/errands/arcs entries, and `LettersSection` + `MoodMapPanel` were calling `saveTextFileWithFallback` without the required `title` field. `tsc --noEmit` did not catch these; `tsc -b` (what `npm run build` runs) does. Now part of the per-commit verify gate. The user-visible symptom was settings sections collapsing — characters / panels disappearing — until the renderer recovered.
- **Hooks barrel cleaned up.** `src/hooks/index.ts` was still re-exporting the deleted `useHearingSnapshot.ts`; Vite would have failed module resolution at runtime. Removed.

### Misc

- 1107 unit tests pass, up from 999 at start-of-sprint after a +60-test net gain across the new affect-guidance / rupture-detection / coregulation / yearbook / guidance-analysis modules and pure-function-only test convention.
- `npm run build` is now mandatory in the pre-commit verify gate alongside `tsc --noEmit + lint + test`.

## Storage migration

On first launch after this update, `pruneLegacyStorageKeys()` removes four orphan keys from your localStorage (`nexus:scheduled-jobs`, `nexus:session-store`, `nexus:skills`, `nexus:agent-memory`). They were unused since the 2026-04-16 dead-tree prune; the sweep is idempotent and silently no-ops if the keys are already absent. No user-visible data is affected.

## Validation focus

Things to exercise during the validation window:

- Open threads — create a thread, confirm the OS notification fires on day 3 / day 5, drop or close it before day 7, verify auto-drop after day 7.
- Letter export + yearbook export — verify HTML opens cleanly in browser and prints to PDF without footer/scaffold.
- Mood map — confirm both lines render, snapshot stats show, co-regulation line appears once you have ≥3 days of overlapping user-affect + companion-emotion samples.
- Settings drawer — every section reachable, no sections collapsing.
- The reply-shaping (M1.4–M1.7) effects are deliberately *invisible* — there's no badge or notice, but heavy users may notice the companion's tone shift during a low stretch or after a sharp drop. That's the point.

## Acknowledgements

Built across one focused session against Klein's "感情加强" mandate. Grounded in:

- Russell 1980 — circumplex valence × arousal
- Kuppens et al. 2015 — affect dynamics: inertia + variability
- Trull et al. 2008 — EMA trait-level vs state-level affect
- Mikulincer & Shaver 2007 — secure-attachment co-regulation
- Welivita & Pu 2020 — empathy intent taxonomy
- Gottman — Four Horsemen of relationship breakdown + soft start-up + accept influence
