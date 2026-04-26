# Nexus v0.3.1-beta.3

> **Pre-release.** Bug-fix patch on top of v0.3.1-beta.2 — no new user-facing features, just lifecycle / compatibility / diagnostic fixes that landed during a single afternoon of audit + repair. Beta channel because two of these (CSP and TTS-state safety net) change runtime behaviour we want validated against real desktops before promoting to stable v0.3.1.

## Why this exists

Real-world bug reports from a thinking-mode model session uncovered four independent issues that all wedge or silently break the same flow (assistant reply → TTS → next message). Predictive scanning after the obvious ones were fixed turned up two more in adjacent code paths. This release lands all of them plus an in-app diagnostic surface so future bug reports don't require DevTools.

## What this fixes

### Live2D no longer broken in packaged builds (P0)

`electron/rendererServer.js` was setting an HTTP `Content-Security-Policy` header that allowed `'wasm-unsafe-eval'` but not `'unsafe-eval'`. The Live2D Cubism SDK relies on pixi.js's runtime shader compilation, which needs `'unsafe-eval'`. The dev `index.html` `<meta>` CSP already granted this — which is exactly why the regression escaped local testing: every contributor running `npm run electron:dev` hit the dev path, not the packaged path. dmg/exe users opened the app to an empty pet.

The full audit-hardened CSP header (frame-ancestors, object-src, strict img/font/connect/media sources, X-Frame-Options DENY, X-Content-Type-Options nosniff, contextIsolation, sandbox, IPC trust gates) all stay intact — the relaxation is restricted to script-src.

### Thinking-mode models (DeepSeek-R1, QwQ, Hunyuan-thinking, Qwen-thinking)

Four-step fix that closes the upstream "The reasoning_content in the thinking mode must be passed back to the API" rejection:

- `electron/chatRuntime.js` learned to extract `reasoning_content` from both response and SSE delta.
- `electron/ipc/chatIpc.js` returns and emits the trace; the preload bridge forwards it as an optional third argument to `onDelta`.
- `src/types/chat.ts` extended `ChatMessage`, `ChatCompletionRequest.messages`, and `ChatCompletionResponse` with optional `reasoning_content`.
- Every transform site that compresses ChatMessage into LLM payload now preserves the trace: `compactMessagesForRequest` (all three branches), `runToolCallLoop` continuation, `agentLoop` history push.

For users whose existing chat history was written before this support landed, `stripStaleLastAssistantWithoutReasoning()` quietly drops the orphaned assistant turn so the next request goes through; the conversation self-heals from the next assistant turn onward.

### TTS lifecycle wedge (voiceState stuck on "speaking")

Three independent paths got hardened so any single TTS hiccup no longer wedges the mic-button + chat-busy guard:

- `streamingSpeechOutput.finish()` now fires `options.onEnd` on the early-return path (controller finalized before any text arrived). Without this, callers awaiting `tts:completed` got nothing — the previous behaviour was an oversight relative to the other settle paths.
- `assistantReply` catch block now finalizes the streaming TTS controller. Mid-turn errors no longer leave it in `finishRequested=false` forever.
- `useVoice` adds a 90-second SPEAKING-state safety net: if voiceState sits at `speaking` with no event clearing it for 90s, the bus is forced through `tts:completed`. 90s exceeds any realistic single TTS reply length, and multi-segment replies refresh the SPEAKING transition each segment so they don't trip this. A `console.warn` fires when the safety net engages so the underlying lifecycle bug stays visible.

### Multimodal images + agent reasoning preserved across turns (predictive scan)

- Time-prefix injection in `toRequestMessages` previously coerced multimodal `ChatMessageContent` arrays into `"[object Object],[object Object]"` via template-string concatenation, dropping both prompt and attached images on every follow-up turn. Array content now gets the reminder spliced in as a leading text part.
- `agentLoop` push to history now forwards `reasoning_content`, matching the fix already landed for `runToolCallLoop`. Without this, agent-mode + thinking-model conversations either tripped the upstream API rejection or had `stripStaleLastAssistantWithoutReasoning` silently delete the agent's previous step.

### In-app diagnostics now actually capture lifecycle events

The DiagnosticsPanel "Copy to clipboard" button (Settings → Console) was always present but the existing logger ring buffer only saw entries from the one module that imported `createLogger`. Two layers added:

- `installConsoleCapture()` monkey-patches `console.*` once at boot so every `[TTS]` / `[VoiceBus]` / `[Chat]` lifecycle log lands in the ring. Original console behaviour is preserved.
- In dev builds, the main process now tails every renderer console message into `<projectRoot>/.dev/runtime.log` as JSONL, truncated at startup. A remote helper (or `tail -F`) can watch the lifecycle live without anyone opening DevTools. Disabled in packaged builds — the in-app ring covers user-side bug reports.

## Backward compatibility

Zero. No data formats, persona schemas, settings shapes, or IPC method signatures changed. New optional `reasoning_content` field flows through types and storage transparently — old histories load fine, and the stripStale guard handles them.

## Auto-update

Pre-release on the GitHub Releases page. Stable v0.3.0 users **do not** auto-update to it. Anyone on v0.3.1-beta.1 or beta.2 will auto-upgrade on next launch (semver, same 0.3.1 track).

## How to try it

1. Download from the [v0.3.1-beta.3 release page](https://github.com/FanyinLiu/Nexus/releases/tag/v0.3.1-beta.3).
2. Unsigned build, same as previous betas:
   - **macOS**: `xattr -dr com.apple.quarantine /Applications/Nexus.app`
   - **Windows**: SmartScreen "More info → Run anyway"
3. Existing v0.3.x install data is picked up unchanged.

## What we want validated before stable v0.3.1

- ✅ Packaged build shows the Live2D pet (this is the P0 — please open the app and confirm)
- ✅ Thinking-mode models (DeepSeek-R1, Hunyuan-thinking, QwQ, Qwen-thinking) accept multi-turn conversations
- ✅ TTS playback completes and voiceState returns to idle; mic button re-enables on next turn
- ✅ Multi-image conversations preserve attached images across turns
- ✅ Agent mode + thinking model run a full multi-step task without losing context

If any of these regress, file an issue against `v0.3.1-beta.3` and we hold the stable promotion.

---

Full commit log between `v0.3.1-beta.2` and `v0.3.1-beta.3`: [compare](https://github.com/FanyinLiu/Nexus/compare/v0.3.1-beta.2...v0.3.1-beta.3).
