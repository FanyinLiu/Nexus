# Changelog

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
