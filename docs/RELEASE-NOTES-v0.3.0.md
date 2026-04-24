# Nexus v0.3.0

> **Stable.** This is the first non-prerelease build since `v0.2.9`. Both stable and beta users will auto-update on next launch (semver-aware: `0.3.0 > 0.3.0-beta.2 > 0.2.9`).

`v0.3.0` is a **narrative-companion release**. The headline is that the relationship is now something Nexus *remembers, holds shape on, and brings back to you*. Six months of incremental beta work and one focused stable polish pass land together as a single coherent build.

Cumulative changelog from `v0.2.9`: 100+ commits, ~12,000 LOC delta, **+361 unit tests** (485 → 846).

---

## For users — what you'll feel

### 1. The companion remembers, and shows it

Three closely-related changes form a "memory does work" story:

- **Significance-weighted recall.** Memories formed under high emotional load (high arousal, extreme valence, sustained concern) resurface up to 40% more readily than calm-equivalent memories. Decay curves and pinned-tier semantics unchanged — this is a ranking multiplier on top.
- **Reflection store.** During the dream cycle, Nexus generates 1–3 short observations about you ("user codes late at night," "user gets quiet on Mondays"). They're stored in a new `reflection` memory tier (capped at 20, deduped by topic). Autonomy reads them when deciding how to behave.
- **Callback moments.** Following the dream cycle, 0–2 high-value memories get queued for "next conversation or two" surfacing. The next chat turn passes them as a soft hint to the LLM, asking it to gently weave one in if natural — and emit a `[recall:<id>]` tag inline so the chat layer knows.

### 2. The relationship has shape

The 0–100 score you see is now the visible surface of a deeper three-layer affective system:

- **Emotional resonance recall.** Sense of *which memory to bring up* now factors in current mood — happy mood surfaces happier memories more easily; concerned mood may return to past concerns (empathy) or, if you ask her to move on, to lighter ones (repair).
- **Five level milestones with first-time fire.** Crossing stranger → acquaintance → friend → close friend → intimate fires a one-shot, understated instruction that turn — the model *performs* the shift (address by name, light teasing, deeper vulnerability) rather than announcing it.
- **Four named sub-dimensions.** `trust` grows when you bring problems and acknowledge help worked. `vulnerability` from sharing feelings (first-person only). `playfulness` from jokes and teasing. `intellectual` from deep questions and debate. Each has soft cap and slow daily drift; high/low values feed additional system-prompt guidance.
- **Reunion framing.** Long absences trigger richer welcome — past topic woven back in, prior concern prompts a check-in, extended silence at close-friend+ reads as genuine "where have you been?".
- **Anniversary milestones.** day-30 / day-100 / day-365 fire as one-shot prompt hints — explicit permission to mention the moment once, gently, with permission to skip if not natural.

### 3. The relationship has *type* (new in stable)

A new onboarding question — "what kind of relationship is this?" — and matching settings option, with four choices:

- **Open-ended** (default, neutral)
- **Friend** — equal, easy, jokes welcome
- **Mentor** — steady, clear, willing to give direction
- **Quiet companion** — speak less, leave room

Each biases the system prompt with a single line so the model adjusts tone without overriding your `SOUL.md`. Editable in Settings → Chat at any time.

### 4. "Thinking of you" notification (new in stable)

When you've gone silent for 4+ hours (configurable), Nexus fires an OS-level notification with phrasing matched to your relationship type. Friend mode: "回来看看，我攒了点想聊的." Mentor mode: "回来时我可以帮你一起理一理." Quiet companion: "我在。回来时我都在." Quiet hours 23:00–08:00 hard-gated; click → focus the panel. Toggle in Settings → Autonomy.

### 5. Alive in the corner

The autonomy V2 decision engine gained a fourth action: **`idle_motion`**. After 3+ minutes of idle, the engine may fire a silent Live2D gesture — a stretch, a yawn, a head-tilt — with no chat bubble, no TTS. Just visibly being there. The engine itself runs at a **dynamic cadence** now: faster when mood is high-arousal and the relationship is close, slower when sleeping/drowsy or post long idle.

### 6. First impressions feel less generic

On the **2nd or 3rd assistant reply ever**, a system-prompt addendum nudges the LLM to end its reply with one short curious question rooted in a concrete persona / about-you detail. Not "what hobbies do you have?" — more "you mentioned rainy Sundays in your hometown — what did those smell like?".

### 7. Smooth time-of-day backdrop (new in stable)

The day / dusk / night scene art now blends across **2-hour transition windows** (5–7 dawn, 16–18 evening, 19–21 night). All three variants paint at smoothstep-weighted opacities, so dawn shows night and day mixed; sunset shows day and dusk mixed. Sunlight tint became visibly bolder too — dawn picks up warm pink, golden hour deep amber, deep night cool desaturated blue. The flat hour-boundary cut is gone.

### 8. Liquid Glass UI re-skin

The bubble + composer aesthetic shifted to an iOS-26-style violet accent: user messages in soft purple gradient, primary buttons in matching gradient, links and scrollbar thumbs in violet. **Surfaces stay neutral dark** — the violet is an accent only.

The chat panel toolbar got cleaned up: weather chip flush left, three buttons on the right, redundant connection-status sentence and online-dot removed. Empty-chat welcome top-aligns with a time-aware bouncing emoji (☀️/⛅/🌇/🌙) and a gently pulsing ✨.

### 9. Tray + dock icons

Brand-new line-art portrait — anime profile with headphones inside an orbit ring. Tray template (macOS menu bar) is rendered as a thick black-line silhouette using a two-stage dilate-then-downsample pipeline so it reads at 22px without smudging. Dock + Windows installer use the colored "Variant G" version: peach→violet linear gradient with cream line work and a macOS-style squircle mask.

### 10. Weather is materially more precise

Old summary collapsed to one daily code per day ("today: scattered showers"). New summary pulls **richer current fields** (humidity, feels-like temperature, current precipitation in mm), **12-hour hourly forecast** for intra-day shifts ("rain starting around 6 PM, ~70% chance"), and adds **day-after-tomorrow** forecast. All from open-meteo's free API — no key required.

### 11. Other

- Inline LLM expression tags expanded to support `[motion:wave|nod|shake|tilt|point]` (drives Live2D motion groups, not just expressions). Documented in 5 locales.
- Lorebook semantic recall can opt into a **query-rewrite fallback** — when the literal pass returns no hits, a cheap LLM rewrites the user message into 2–3 alternative phrasings and re-runs the search. Off by default.
- Diagnostics: structured logger with JSONL export, an emotion + relationship state-timeline panel, and a 30-day cost-history bar chart with per-source / per-model breakdowns.
- Subagent UX: cancel button + history panel for the last 25 terminal tasks.
- Voice pipeline: 10+ stability fixes (timing races, leak cleanup, restart-count resets) — fewer "stuck listening" / "ghost session" reports.
- 7 high-severity security fixes from a multi-agent main-process audit.
- UI language picker on the Welcome step + 5-locale first-meeting greeting after onboarding.
- Window size + position now persist across launches (writes to `userData/window-bounds.json` on resize/move). Off-screen bounds fall back to defaults.
- Image attachment in composer auto-hides when configured chat model lacks vision (no more silent-fail paste flows).

---

## For developers — what's under the hood

### New modules
- `src/features/memory/callbackStore.ts`, `reflectionGenerator.ts` — pending-callback queue + dream-cycle reflection generation.
- `src/features/autonomy/relationshipDimensions.ts`, `milestones.ts` — sub-dimension growth + anniversary detection.
- `src/features/memory/emotionResonance.ts` — VAD projection, three regulatory modes, priming buffer.
- `src/features/proactive/awayScheduler.ts`, `awayNotificationCopy.ts` — pure decision function + 5-locale × 4-bucket phrasing.
- `src/hooks/useAwayNotificationScheduler.ts` — coarse-cadence (5min) renderer scheduler.
- `electron/services/proactiveNotification.js` — main-process Notification wrapper, click → focus panel.
- `electron/services/asyncLock.js` — shared mutex (extracted from keyVault + mcpApprovals).
- `electron/services/windowBoundsStore.js` — debounced bounds persistence.
- `src/lib/modelCapabilities.ts` — vision-capable model id detection.
- `src/lib/relationshipTypes.ts` — shared `RELATIONSHIP_OPTIONS` for onboarding + settings.
- `src/components/settingsFields.tsx` — `<ToggleField>` / `<NumberField>` / `<TextField>` / `<TextareaField>` removing ~145 inline handler closures across SettingsSections.

### Decision engine V2 additions
- `DecisionResult.kind = 'idle_motion'` — silent gesture, bypasses persona guardrail.
- `computeConsiderationCadence(level, signals)` — replaces fixed `ticksBetweenConsiderations` with phase / energy / curiosity / idle / relationship-scaled multiplier; clamped to `[2, 3*base]`.
- `responseContractIdleMotion` per-locale prompt copy gated by `allowIdleMotion` hint.

### Tag protocol expansion
`extractPerformanceTags` (formerly `extractExpressionOverrides`) parses four keys:
- `[expr:X]` — one-shot Live2D expression
- `[motion:X]` — Live2D motion group via `gestures` map
- `[tts:X]` — collected and dropped (placeholder for future emotion-TTS adapter)
- `[recall:<memId>]` — memory id; assistantReply consumes from callback queue when emitted

### Storage / type changes
- `MemoryItem` gains `significance?`, `reflectionTopic?`, `reflectionConfidence?`. New `reflection` memory tier.
- `RelationshipState` gains `subDimensions?`, `firedMilestoneKeys?`. Optional fields → pre-v0.3 stored state migrates transparently.
- `WeatherLookupResponse` gains `currentApparentTemperature`, `currentHumidity`, `currentPrecipitationMm`, `currentIsDay`, `dayAfterSummary`, `upcomingHourly`.
- `IdentitySettings` gains `companionRelationshipType: 'open_ended' | 'friend' | 'mentor' | 'quiet_companion'`. Default `'open_ended'` is no-op so existing prompt prefixes stay byte-stable for cache.
- `PresenceSettings` gains `proactiveAwayNotificationsEnabled` (default true) + `proactiveAwayNotificationThresholdMinutes` (default 240).

### Refactors during the v0.3.0 polish pass
- `src/types/i18n.ts` 1842 → 588 lines (4 biggest namespaces extracted to `src/types/i18nKeys/`).
- `chatOutputTransforms.ts`: regex compile cache via WeakMap on rule object — was recompiling every chat turn.
- `keyVault.js` + `mcpApprovals.js`: identical mutex impls deduped behind `createAsyncLock()`.
- `windowBoundsStore.js`: `fs.writeFileSync` → async `fsp.writeFile` (no more main-thread block on each window resize).
- `useAwayNotificationScheduler.ts`: single ref + one effect (was three single-statement effects).
- `PanelView` pendingImage clear-effect: deps tightened from `chat` to `[visionEnabled, chat.pendingImage, chat.setPendingImage]`.
- `ActivePlanStrip` + `SubagentTaskStrip`: 23 inline style blocks moved to App.css.

### Build size trim
electron-builder `files` now excludes:
- `**/*.map` (source maps)
- `onnxruntime-web/dist/ort-wasm-simd-threaded.{asyncify,jspi}.*` (alternative ABIs, unused)
- `onnxruntime-web/dist/ort.{webgl,webgpu,training}.*` (alternative backends, unused)

Estimated dmg/exe shrink: 30–60 MB.

### Tests
485 (pre-v0.3.0) → 846 (this release). New coverage: significance computation, callback selection, reflection generation, anniversary milestones, performance-tag parser (motion/recall variants), dynamic cadence, lorebook query rewrite, callback-store CRUD, idle_motion parser/gating, away-notification decision (8 branches), copy interpolation per locale, time-of-day blend (sum-to-1 / pure-band / mix windows / smoothstep midpoint), vision model capability matrix, relationship-type prompt bias.

---

## Backward compatibility

- localStorage: every new field on `MemoryItem` / `RelationshipState` / `WeatherLookupResponse` / `IdentitySettings` / `PresenceSettings` is optional. Pre-v0.3.0 state loads unchanged.
- Auto-update: stable channel. Beta users on `0.3.0-beta.{1,2}` and stable users on `≤ 0.2.9` will both auto-update on next launch.
- Persona files (SOUL.md / lorebook): unchanged schema.
- `companionRelationshipType: 'open_ended'` is a no-op — existing installs get zero prompt-prefix change so the prompt cache remains valid.

## Breaking changes

None.

## Known issues

- `lorebookRewriteQueryEnabled` setting exists but no Settings UI toggle — enable via DevTools localStorage hack until the next round.
- Idle motion runs only on per-model gestures. Built-in `mao` model maps all five public gestures (wave/nod/shake/tilt/point) to its single `TapBody` group; imported models with richer libraries can declare per-gesture groups.
- One pre-existing `react-hooks/exhaustive-deps` warning in `useAppController.ts:386` remains.

## How to install / try it

1. Download the `v0.3.0` installer from the [releases page](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.0).
2. Unsigned build — on first launch:
   - **macOS**: `xattr -dr com.apple.quarantine /Applications/Nexus.app`
   - **Windows**: SmartScreen "More info → Run anyway"
3. Existing v0.3.0-beta.{1,2} install data is picked up unchanged.
4. Existing v0.2.9 install data is picked up unchanged — new fields lazily initialize on first chat turn.

## What's next — v0.4 plan

The strategic positioning for v0.4 is **narrative composition**: not building new primitives but composing the ones we already have into rituals.

**Sprint 1 (in progress)**:
- ✅ #3 Relationship-type declaration + "thinking of you" notification (shipped this release)
- ⏭ #1 Morning–evening bracket — Stoic-inspired daily rhythm; light morning question + evening callback. Reuses callback queue + autonomy V2. Maximum narrative leverage.
- ⏭ #2 Sunday letter — weekly persona-written letter summarizing the week's conversations, exportable as text/PDF. Turns "the week" into a keepsake artifact.

**Backlog candidates**:
- Listen Mode — switch to expression+motion only, no text, post-session reflection.
- Multi-day Arc — internal 5-day arc thread (e.g. "learn more about your work").
- Future-self time capsule — write to your future self; persona delivers months later.
- Ambient mode + whisper UI — low-attention idle surface for long no-interaction windows.

## Feedback

Particularly interested in:
- Does the **callback** moment ("did you ever pick a gift?") fire when it should? Too often / too rare?
- Does the new **idle motion** read as "alive" or as "twitchy"?
- Does the **time-of-day blend** read smoothly on your monitor, or do you still see hour-edge flicker?
- **Relationship type**: does picking "mentor" or "quiet companion" actually feel different in real conversation?

- Bugs: [GitHub Issues](https://github.com/FanyinLiu/Nexus/issues)
- Discussion: [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)

---

Full commit log between `v0.2.9` and `v0.3.0`: [compare](https://github.com/FanyinLiu/Nexus/compare/v0.2.9...v0.3.0).
