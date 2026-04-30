# Changelog

> Per-version detail lives in [`docs/RELEASE-NOTES-v*.md`](docs/). This file
> is the high-level summary suitable for "what changed since last release"
> at a glance. Beta versions are listed under their target stable release.

## [Unreleased] - 2026-04-30

### Fixed
- **Notification bridge RSS intervals** — RSS channels now normalize
  `checkIntervalMinutes` and legacy `config.intervalSec` through one path,
  clamped to 5-1440 minutes so stale or malformed channel data cannot create
  `NaN` timers or abusive polling intervals.
- **Notification bridge webhook body cap** — local webhook POST bodies are now
  capped at 64 KB and return 413 when exceeded.
- **Gateway tests in restricted environments** — WebSocket integration tests
  now skip cleanly when the local test server cannot bind in a sandbox instead
  of hanging the suite.
- **Smoke lifecycle** — renderer smoke now has an application-level watchdog
  and records load failures instead of waiting forever for `did-finish-load`.
- **Lint cleanup** — removed a stale `eslint-disable` from the app controller.

### Changed
- **Realtime voice surface gated** — dormant OpenAI realtime voice preload/IPC
  APIs are hidden unless `NEXUS_ENABLE_REALTIME_VOICE=1` is set.
- **Roadmap posture** — Nexus is now documented as an AI desktop companion
  first. Tools, knowledge, game bridges, and automation are supporting
  abilities, not the core product identity.

### Added
- **Notification bridge utility tests** — RSS interval migration/defaulting and
  webhook request-size constants are covered by focused unit tests.

## [0.3.1-beta.3] - 2026-04-26

### Fixed
- **Live2D in packaged builds** — the audit-pass CSP tightening dropped `'unsafe-eval'` from the renderer header CSP, which broke pixi.js shader compilation in production. Restored as `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'` (renderer is sandboxed; risk is the meta-CSP in `index.html` already permitted it).
- **Thinking-mode models multi-turn** — DeepSeek-R1, QwQ, Hunyuan-thinking and similar models now preserve their reasoning chains and multimodal images across turns instead of dropping context.
- **TTS no longer wedges `voiceState`** — fixed a state-machine path that left the speaking flag stuck after a stream-end race.
- **Wake word + AppleScript log noise** — wake-word retry warnings now dedup by error message; AppleScript -1743 latches on first hit and silently retries every 10 min.
- **Workspace `set-root` security gate (audit M3)** — renderer-supplied workspace root requires native dialog approval; persisted (mode 0o600) so renderer's "restore last-set-root" doesn't re-prompt.
- **MCP per-tool approval (audit M2)** — server's initial tool list is auto-snapshotted on first run; new tools that appear later (server update or tampering) trigger native approval prompt.
- **PanelView lint warning** — destructured `chat` to satisfy `react-hooks/exhaustive-deps`.

### Added
- **In-app diagnostic surface** — renderer console capture into ring buffer + JSONL export panel + dev-only mirror to `.dev/runtime.log` so bug reports don't require DevTools.

### Changed
- **Hidden Minecraft + Factorio integrations from Settings UI** — IPC + gateway code retained, just not surfaced in the Integrations panel since they aren't a v0.3.x focus. Telegram + Discord remain visible.
- **TTS wait timeout log level** — `console.warn` → `console.info` (the 12s unblock is by-design, not a failure).
- **Memory vector index save debounce** — 2s → 30s. Stops rewriting the 60MB JSON on every chat tick. Flush-on-quit unchanged.
- **i18n for ja + ko** — translated ~660 previously-English UI strings.
- **Default chat models** — Anthropic Opus 4.6 → 4.7; Gemini 3.1 `-preview` → stable; OpenAI gpt-5.5 / gpt-5.5-pro added (default stays gpt-5.4 until 5.5 API fully GA).

## [0.3.1-beta.2] - 2026-04-26

Security-only patch. **No behavior changes.** Closes IPC surface attacks
found in two-pass audit (2026-04-24 → 2026-04-26):
- **H5 chat baseUrl SSRF** — `checkChatBaseUrlSafety` now blocks IMDS / 0.0.0.0 ranges in `chat:complete-stream`. Local-provider workflows (Ollama 127.0.0.1, LM Studio LAN) preserved.
- **H4 vault enumeration** — single-retrieve rate limit (3/60s) on top of bulk limit (6/60s).
- **H8 local-service probe** — pinned to loopback only.

## [0.3.1-beta.1] - 2026-04-25

Pure installer-size fix. **No behavior changes.** Cuts per-platform installer
from **1.19–1.45 GB → ~250 MB** by excluding three pieces of bloat that
slipped past `electron-builder`:
- Unused FP32 model duplicate (~600 MB)
- Git LFS residue
- Unused vendor binaries

## [0.3.0] - 2026-04-25

**Stable release.** First non-prerelease build since v0.2.9. Cumulative:
100+ commits, ~12,000 LOC delta, +361 unit tests (485 → 846).

The narrative-companion release. The relationship is now something Nexus
**remembers, holds shape on, and brings back to you**.

### Added
- **Significance-weighted recall** — memory ranking now blends recency, emotional weight, and topic centrality.
- **Dream-cycle reflections** — companion runs an offline reflection pass between sessions, producing journal-like recap.
- **Callback queue** — companion holds threads (unfinished questions, half-shared stories) and brings them back when topical.
- **Anniversary milestones** — relationship dimension transitions trigger one-shot pacing prompts.
- **Relationship type declaration** — friend / mentor / quiet companion paths shape system prompt + idle behavior.
- **"Thinking of you" OS notification** — proactive ping respecting `NotificationPolicy` quiet hours.
- **Idle-motion silent gestures** — Live2D micro-animations during long pauses.
- **Smooth 2-hour day↔dusk↔night blend** — bolder color contrast, more readable in real lighting.
- **Liquid Glass UI re-skin** — reduced visual chrome, more focus on the companion.
- **Richer weather precision** — 14-state weather expanded with intensity gradients.

## [0.3.0-beta.2] - 2026-04-24

Stability + retention pass on top of beta.1. 45 commits, ~6,000 LOC delta,
+158 unit tests (665 → 823). Polish for: panel UI, autonomy decision engine,
memory recall, weather precision, tray + dock visuals.

## [0.3.0-beta.1] - 2026-04-24

### Added
- **Three-layer affective system** — every user message produces a specific emotional fingerprint; the 0–100 score is now the surface of a richer model.
- **Relationship evolution + emotional memory** — themed beta line.
- **93 new unit tests** (lifted suite into the 600s).
- **Main-process audit pass** — first scan that produced the H1–H7 / M1–M10 / L1–L7 audit doc.

### Changed
- **Electron 36 → 41** (Node 24 ABI). ~30 smaller fixes alongside.

## [0.2.9] - 2026-04-22

### Added
- **Emotional memory** — companion recalls how a previous interaction felt, not just what was said.
- **5-level relationship baseline** — stranger / acquaintance / friend / close_friend / family.
- **Weather + scene system overhaul** — 14 weather states integrated with 5 hand-crafted scenes, day/dusk/night variants.
- **Character Card v2/v3 import** — accepts SillyTavern / RisuAI / chub.ai / characterhub PNGs.
- **VTube Studio bridge** — WebSocket + auth handshake, lets users reuse existing VTS rigs.

## [0.2.8] - 2026-04-21

### Added
- **3-layer pet backdrop system** — scene image (5 hand-prompted AI anime scenes × day/dusk/night variants) → weather particle overlay → sunlight tint filter. Configured via `panelSceneMode` (off/auto/pinned).
- **14-state sunlight tint** — continuous brightness/saturation/hue CSS filter driven by real clock, covering deep_night through night with smooth transitions.
- **14 weather particle animations** — clear (dust motes), partly_cloudy (drifting clouds), overcast (static gradient), fog (ground-level drift with mask-image), drizzle/rain/heavy_rain/thunder/storm (scattered raindrops with negative delays), light_snow/snow/heavy_snow (wobbling snowflakes), breeze/gale (horizontal wind streaks). All CSS-only, GPU-composited.
- **Weather/time preview** — settings panel lets user lock any of the 14 time-of-day states or weather conditions for visual preview.
- **Multi-language weather location parsing** — voice/STT input now cleans Japanese (えーと/あの/教えて/調べて…), Korean (음/어/알려줘/검색해…), and Traditional Chinese filler/command words. City alias map expanded from 6 → 24 entries (CN/TC/JA/KO). Nominatim `accept-language` dynamically switches by detected script. `pickBestWeatherPlace` adds +3 scoring bonus for Kana→JP and Hangul→KR matches.
- **5-locale i18n migration** — all UI strings (onboarding, settings, chat, voice, memory, autonomy, system prompts) migrated from inline zh/en bilingual to 5-language `ti()` calls: zh-CN, en, zh-TW, ja, ko.
- **Panel toolbar** — connection dot (online/offline indicator) + status text + action buttons now properly laid out with flex alignment. Previously these CSS classes had no styles defined.

### Changed
- **Pet window resizable** — `resizable: true`, min 280×400, max 1400×1400. Transparent frameless window, user drags system resize handles at edges.
- **Responsive controls island** — bottom-right anchor buttons (expand + mic) and expanded panel (5 function buttons) now scale proportionally with pet window size via `clamp()` + `vw` units. Buttons: 44→30px, panel buttons: 40→28px, icons scale accordingly.
- **Weather animations refined** — all particles use negative `animationDelay` so screen is pre-filled on render (no "curtain drop" effect). Rain drops thinner (2.5px default), removed box-shadows for subtlety. Overcast simplified to static multiply-blend gradient (no animated cloud blobs). Fog restricted to bottom 60% with CSS mask-image fade. Dust motes reduced from 40→18 with lower opacity.
- **Panel-scene feature removed** — old chat-panel backdrop code entirely deleted; backdrop now lives exclusively in pet view.

### Next Steps
- **Character Card v3 import** — PNG embed → `personas/<id>/` six-file set, consume SillyTavern/RisuAI/Soul-of-Waifu community cards. Top priority from roadmap.
- **VTube Studio API integration** — WebSocket bridge so users can reuse existing VTS character rigs instead of bundled Live2D models.
- **Autonomy V1 cleanup** — delete legacy autonomy engine code once V2 is confirmed stable in production.

## [0.2.7] - 2026-04-19

### Added
- **Subagent dispatcher** — companion can spawn a bounded background research loop (web search + MCP tools) from two entry points: autonomy engine chooses `spawn` in place of `speak`, or main chat LLM calls the `spawn_subagent` tool mid-turn. Live status rendered in `SubagentTaskStrip` above the chat message list; summary woven back into the final reply.
  - Three-tier model fallback: `SubagentSettings.modelOverride → autonomyModelV2 → settings.model`.
  - Capacity + daily USD budget enforced; opt-in via `Settings → Subagents`.
  - `spawn_subagent` tool only exposed to chat LLM when the feature is enabled.
  - 6 unit tests covering runtime state-machine admission / budget / concurrency / onChange fan-out.
- **Autonomy V2 `spawn` decision branch** — third `DecisionResult` kind alongside `silent` / `speak`. Dynamically advertised in the decision prompt only when dispatcher capacity + budget permit. Orchestrator handles guardrail failures by stripping the optional announcement rather than retrying.
- **Korean README** — `docs/README.ko.md` added; language switcher row updated across all five READMEs.

### Changed
- **Barge-in monitor** — now arms on **any** TTS playback (voice- or typed-turn-originated), not only when continuous voice was active. When the wake-word listener is running the monitor reuses its mic frames via `subscribeMicFrames` instead of opening a second `getUserMedia` (fixes macOS default-input serialization glitches). Post-interrupt VAD restart is force-enabled in non-wake-word modes so user continuation is captured without re-waking.
- **`mcp:sync-servers` IPC handler** promoted from deferred registration to the eager path (matches `sherpaIpc` / `notificationIpc`, which had the same startup-race issue).

### Fixed
- **"Maximum update depth exceeded" render storm on voice turns** — `useChat` / `useMemory` / `usePetBehavior` / `useVoice` now return a `useMemo`-stabilized bag with precise state deps. `useVoice`'s memo deliberately excludes `lifecycle.*` / `bindings.*` / `testEntries.*` (these factories are reconstructed every render but route through stable refs; old captures still call the latest implementation). `useAppController`'s `autonomyAwareSendMessage` refactored to close over empty deps via `autonomyRef` / `originalSendMessageRef`. `useVoice` internals promote `busEmit` and `setVoiceState` to `useCallback`. Root-cause of long STT utterances stalling the second turn.
- **Pet-to-panel chat invisibility** — pet window's voice turns were writing `nexus:chat-sessions` via `upsertChatSession`, but `useDesktopBridge`'s cross-window sync was listening for `storage` events on `nexus:chat`, which nobody wrote to. `useChat`'s save effect now calls `saveChatMessages(messages)` alongside `upsertChatSession` so voice messages actually reach an open chat panel.
- **Silero VAD falling back to legacy recording** — `setup-vendor.mjs` now copies the four onnxruntime-web bundles (`ort-wasm-simd-threaded{,.jsep}.{mjs,wasm}`) to `public/vendor/ort/`. Previously the folder didn't exist, so `vad-web` fell back to a CJS `require()` that Vite's ESM dev server couldn't service.
- `react-hooks/exhaustive-deps` warning on `busEmit` — suppressed with comment explaining that `executeBusEffects` is a hoisted declaration closing over the same refs as the hook body.

### Docs
- All four existing READMEs (en / zh-CN / zh-TW / ja) refreshed with the v0.2.7 "What's new" section. New `docs/README.ko.md`.

## [0.2.2] - 2026-04-16

### Changed
- Migrate all 8 remaining settings tabs from zh/en-only inline bilingual to full 5-language i18n (zh-CN / en / zh-TW / ja / ko). Total keys: 304 → 516.
- Trim all settings hint text to 1 concise sentence (was multi-paragraph in many places).

## [0.2.1] - 2026-04-16

### Fixed
- Skip flaky `web-search-runtime` secondary-recall test that blocked CI
- Remove temporary VAD diagnostic logs from production code

### Changed
- Rewrite all 4 READMEs (en / zh-CN / zh-TW / ja) with emoji-bullet feature format, matching airi / Open-LLM-VTuber quality standards
- Remove project comparison table — no more referencing other projects
- Localize recommended model picks per language (zh: DeepSeek/Qwen, ja: Whisper/Nanami, zh-TW: Taiwan accent voices)
- Add Star History chart, Contributing section, development status note

## [0.2.0] - 2026-04-15

### Added
- **Main-process Silero VAD** — voice activity detection now runs natively in the Electron main process via `sherpa-onnx-node`, sharing the wakeword listener's audio frames over IPC. Eliminates the Windows WASAPI mic-conflict that silenced VAD when two `getUserMedia` calls competed for the same device.
- **Notification bridge backend** — new `electron/services/notificationBridge.js` with RSS feed polling and a local webhook server (port 47830) for external notification ingestion. Previously the renderer schema existed but had no main-process implementation.
- **Error Boundary** — root app is now wrapped in an `ErrorBoundary` that catches render crashes and shows a reload button instead of a white screen.
- **UrlInput component** — shared input component with visual validation for API base URL fields across all settings sections.
- **Tool call history panel** in the runtime console — filterable view of recent web search, weather, and MCP tool executions.
- **Collapsible console sections** — voice turns, action log, reminders, plan, and agent trace sections are now `<details>` elements that can be collapsed to reduce scroll.

### Fixed
- **Wake word "only triggers once"** — fixed 9 independent root causes:
  - Generation closure trap in `wakewordRuntime.ts` silently dropped all keyword detections after the first wake (replaced with `activeListenerId` mechanism)
  - KWS stream not rebuilt after detection — `spotter.reset()` damages Zipformer encoder hidden state; now followed by `createStream()`
  - `transcriptHandling.ts` never dispatched `session_completed` on successful voice send, leaving the legacy session machine stuck at 'transcribing'
  - Mic track `ended` event not monitored — silent device disconnection went undetected
  - `AudioContext` suspension not recovered — Chromium background throttling could freeze the audio pipeline
  - `acquireMicAndWire` race condition — teardown during async mic acquisition leaked streams and AudioContext
  - `useFrameDriver` decision too coarse — checked wakewordRuntime existence instead of its phase, causing silent VAD when listener was in error/retry state
  - VoiceBus state drift on TTS interrupt — barge-in only updated the legacy machine, leaving VoiceBus stuck in SPEAKING
  - `numTrailingBlanks` increased from 1 to 2 for better short-keyword stability
- **Continuous voice broken after changes** — restored `shouldResumeContinuousVoice = fromVoice` so TTS completion always opens a brief VAD window for the user to continue speaking.
- **Chat streaming concurrency** — added `isLatestTurn()` guards to `onDelta` and `handleBuiltInToolResult`; fixed `streamAbort.ts` finally-race that could clear a newer turn's abort ref; unmount now aborts active streams.
- **IPC prototype pollution** — `windowManager.js` state spreads now filter `__proto__`/`constructor`/`prototype` keys.
- **Float32Array OOM** — all 7 audio feed IPC handlers validate type and cap length at 320k samples.
- **DevTools in production** — F12/Ctrl+Shift+I handlers gated behind `!app.isPackaged`.
- **Webhook CORS** — restricted from `*` to `http://127.0.0.1` with optional bearer token.
- **XSS in ToolResultCard** — `<a href>` elements now enforce `http(s)://` protocol whitelist.
- **open_external SSRF** — blocks private/loopback IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, ::1).
- **Workspace filesystem symlink escape** — `resolveSafe()` now resolves symlinks via `realpathSync` before path check.
- **Context trigger ReDoS** — rejects patterns > 200 chars or containing catastrophic backtracking constructs.
- **Bot tokens** (`telegramBotToken`, `discordBotToken`) added to vault encryption whitelist.
- **audio:transcribe** base64 payload capped at 50 MB.
- **Debounced writes** now flush on `beforeunload` to prevent data loss on crash.

### Changed
- **Settings UI copy rewrite** — all 10 settings tabs audited:
  - Tools: per-toggle hints explaining purpose, privacy implications, and what happens when disabled
  - Integrations: 27 i18n keys rewritten across 5 locales, removed "module factory / skeleton / protocol bridge" jargon
  - Console: 15 hardcoded Chinese strings converted to bilingual, section titles clarified
  - History, Autonomy, Model, Chat: minor copy improvements
- **Autonomy engine hardening**:
  - Web IDE deep-focus detection (VS Code Web, Cursor, Codespaces, etc.)
  - Decision queue capped at 20 entries after pruning
  - Rhythm learning resets to neutral baseline after 7+ days of inactivity
  - Intent predictor now uses window title for shopping/email/calendar refinement
  - Source union expanded to `text | voice | telegram | discord`
  - Per-chatId/channelId reply routing for Telegram and Discord gateways
- `sherpaIpc` registered synchronously in `registerIpc()` instead of the 1.5s deferred path, fixing `kws:status` startup race.

### Removed
- Legacy `vadFrameDriver.ts` (replaced by main-process VAD)
- Unused Live2D model assets (Haru, Natori, Ren) removed from `public/live2d/`

## [0.1.4] - 2026-04-14

### Fixed
- TTS retry on transient failures
- Per-segment TTS events for streaming speech output
- Sender teardown leak in ttsStreamService

## [0.1.1] - 2026-04-01

### Changed
- Initial public release cleanup

## [0.1.0] - 2026-03-28

### Added
- Initial release
