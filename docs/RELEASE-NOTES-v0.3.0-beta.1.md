# Nexus v0.3.0-beta.1

> **Pre-release.** This build is published on the `beta` auto-update channel and ships unsigned. Existing stable users (v0.2.9 and earlier) are **not** auto-upgraded to betas — you have to install this one manually. Once the stable `v0.3.0` ships, beta users will auto-update onto the same stable line.

Nexus 0.3.0-beta.1 focuses on a single theme: **relationship evolution + emotional memory**. The score you already have (0–100) is now the visible surface of a deeper three-layer affective system, and every user message leaves a specific emotional fingerprint — not just a generic `+1`.

The runtime also moves forward: Electron 41 (Node 24 ABI), 93 new unit tests, a deeper main-process audit, and roughly 30 smaller fixes.

---

## For users — what you'll notice

### 1. Emotional resonance recall

The companion's sense of *which memory to bring up* now factors in current mood. When she's happy, happier memories surface more easily; when she's concerned, she may return to past moments of concern (empathy mode) — or, if you ask her to move on or if distress is sustained, she'll surface something lighter to help reframe (repair mode).

It isn't just mood-matching. A small priming buffer nudges consecutive recalls toward the same emotional neighborhood so the conversation doesn't whiplash between unrelated moods.

### 2. Relationship milestones

The existing five-level progression (stranger → acquaintance → friend → close friend → intimate) now fires a **one-shot, understated instruction** the turn you cross a threshold for the first time. The instruction tells the model to *perform* the shift (address by name, light teasing, deeper vulnerability) rather than *announce* it — no pop-up, no gamified badge, just a shift in how she speaks on that turn.

Long absences now trigger richer reunion framing: past topic gets woven back in naturally, concern from the last session prompts a gentle check-in ("did it get better?"), and extended silence at close_friend+ reads as genuine "where have you been?" rather than a generic greeting.

### 3. Relationship sub-dimensions

The flat score now rides on four named dimensions, each growing from different kinds of interaction:

- **Trust** — grows when you bring problems to her and when you acknowledge that her help worked
- **Vulnerability** — grows when you share feelings, personal history, or express sadness (first-person only — "my friend is sad" does not count)
- **Playfulness** — grows from jokes, laughter, playful teasing
- **Intellectual** — grows from deep questions, debate, mutual teaching

Each dimension has a soft cap (diminishing returns as it saturates) and a slow daily drift toward a low baseline if you stop interacting. When a dimension is notably high or low, it feeds additional guidance into her system prompt — high `trust` reminds her to honor that reliance; low `playfulness` tells her not to force humor.

The composite score is blended with the legacy daily-interaction score using `max(daily, composite)`, so this change **cannot regress** your existing relationship — it can only push it forward faster.

---

## For developers — what's under the hood

### New modules

- `src/features/memory/emotionResonance.ts` — VAD (valence/arousal) projection, three regulatory modes (reinforce/empathy/repair), priming ring buffer, intensity-gated scoring. 205 lines, no dependencies beyond existing types.
- `src/features/autonomy/relationshipDimensions.ts` — sub-dimension types, signal classification (CN + EN regex), diminishing-returns delta application, composite score, decay, prompt formatting. 180 lines.
- Shared helpers in `src/lib/common.ts`: `driftToward<T>()` for exponential decay math, `classifyByPatterns<T>()` for regex-based signal classification — both now used by emotion + relationship code paths to eliminate duplicated kernels.

### Integration points

- `buildMemoryRecallContext` accepts `currentEmotion?: EmotionState` and an optional priming buffer. The resonance boost is additive (capped at 0.15) on top of existing keyword/vector/recency/decay scoring.
- `RelationshipState.subDimensions?` is optional — pre-v0.3 stored state loads transparently. On first message after upgrade, sub-dimensions are lazily initialized from a low baseline; they grow from signals as you chat.
- `markDailyInteraction` now blends daily-streak score with `computeCompositeScore(subDimensions)` via `Math.max` so rich dimension growth never regresses behind flat streak counting.
- `detectLevelTransition` fires milestone events only on first-time upward transitions — level decay and re-reaching an already-reached level don't re-trigger.
- Milestone instructions are consumed exactly once by the chat runtime via `consumePendingMilestoneText()` before stream start.

### Electron + runtime

- Electron 36 → 41 (Node 24 ABI, macOS 12 minimum).
- Node test runner coverage up from 486 to 665 (93 new tests for the three layers, plus direct coverage for `decayEmotion` / `classifyMessageSignals` after the shared-helper refactor, plus 75 tests covering five critical untested modules: plugin message bus, encryption, MCP + plugin host, window manager, minecraft gateway).
- Main process hardening from a five-agent audit: CSP script-src tightened (`unsafe-eval` removed), vault file now written with `mode: 0o600`, child-process PID null-guard before `process.kill`, timer leaks in `mcpHost` + `realtimeVoice` + `windowManager.panelBlur` cleaned up.
- Renderer: `useChat` signature hash replaces per-turn `JSON.stringify(messages)` (O(n) → O(1)), `useMemo` dead refs pruned, `SpeechOutputSection` extracted a `TuningSlider` component (-100 lines).
- Build: `vite.config.ts` `manualChunks` tightened; `chatRuntime.trimRepeatedStreamingDelta` O(n²) overlap search capped at 200 chars.

### Bug found by the gateway test pass

`minecraftGateway.connect()` never registers a WebSocket `message` listener — `handleWsMessage` is dead code, and inbound server events silently drop. Flagged in the gateway-tests commit; will be fixed in a follow-up.

### Backward compatibility

- **localStorage**: `subDimensions` is optional on `RelationshipState`; missing field loads as `undefined` and is lazily initialized on first signal. No migration needed.
- **Prompt prefix**: emotion/relationship/sub-dimension text lives in the same per-turn region as before — no new cache-busting pattern.
- **Dependencies**: zero new npm packages. All new code uses already-installed primitives.

---

## Breaking changes

None.

## Known issues

- `minecraftGateway.handleWsMessage` is unreachable (pre-existing bug discovered during testing). The gateway still advertises its capability but silently drops server events. Fix queued for the next beta.
- One pre-existing `react-hooks/exhaustive-deps` warning in `useAppController.ts:383` remains — not introduced by this release, but now surfaces during CI.

## How to try it

1. Download the `v0.3.0-beta.1` installer for your platform from the [releases page](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.0-beta.1).
2. Unsigned build — on first launch:
   - **macOS**: `xattr -dr com.apple.quarantine /Applications/Nexus.app` (or right-click → Open).
   - **Windows**: SmartScreen "More info → Run anyway".
3. Existing `v0.2.9` install data is picked up unchanged. Your relationship score, memories, and persona files migrate as-is.
4. Auto-update: this beta stays on its own channel. Your install will jump to stable `v0.3.0` automatically when that ships.

## Feedback

Report what feels off — particularly around *regulatory mode* detection ("empathy" vs "repair" triggers) and the first-person requirement on `expressed_sadness`. Those are heuristic regexes; real conversation edge cases are what will shape the next beta.

- Bugs: [GitHub Issues](https://github.com/FanyinLiu/Nexus/issues)
- Discussion: [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)

---

Full commit log between `v0.2.9` and `v0.3.0-beta.1`: [compare](https://github.com/FanyinLiu/Nexus/compare/v0.2.9...v0.3.0-beta.1).
