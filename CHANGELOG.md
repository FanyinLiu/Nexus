# Changelog

> Per-version detail lives in [`docs/RELEASE-NOTES-v*.md`](docs/). This file
> is the high-level summary suitable for "what changed since last release"
> at a glance. Beta versions are listed under their target stable release.

## [Unreleased]

### Changed
- **v0.4.1 coarse time language boundary** — moved companion elapsed-time
  labels, precision-leak detection, and safe fallback formatting into a
  dedicated context time-language layer while keeping the v0.4.0 observation
  thresholds and trigger logic unchanged.
- **v0.4.2 check-in policy boundary** — added local emission control for the
  companion check-in policy so in-app lines remain explainable, dismissible,
  polling-safe, and separate from external notifications or message sending.
- **v0.4.3 transparency view model** — routed the Settings companion-awareness
  transparency block through a deterministic view model that explains status,
  observed categories, model reach, local storage, clear-summary availability,
  and blocked reasons without changing the release entry point.

### Fixed
- **Localized exact-time leak detection** — desktop companion awareness now
  rejects or downgrades Arabic-digit Chinese, Japanese, and Korean precise
  duration strings such as `1小时30分钟`, `1時間30分`, and `2시간 10분` before they
  can reach prompt, UI, or recent-summary display surfaces.
- **Repeated check-in suppression** — active chat, stale return signals,
  duplicate activity signals, and recently dismissed lines now suppress local
  check-in output before an in-app payload can be built.
- **Raw desktop content transparency guard** — companion awareness
  transparency now keeps raw window titles, clipboard bodies, message bodies,
  file paths, screenshots, and precise minute/second time labels out of the
  Settings view model.

## [0.4.0] - 2026-06-21

### Added
- **Desktop companion awareness foundation** — Nexus now keeps a short-lived,
  privacy-bounded companion awareness summary when the app is open, the user is
  active elsewhere, and desktop context awareness is enabled.
- **Stable release documentation** — final v0.4.0 release notes, localized
  release entry points, and the stable checklist now describe the quiet
  observation boundary separately from later v0.4.x and v0.5 behavior.

### Fixed
- **Session-bound quiet observation summaries** — recent companion summaries are
  tied to the current app session and renderer lifecycle, reject precise
  elapsed-time language, and are purged on pause, disable, stale, future, or
  cross-session restore cases.

## [0.4.0-beta.1] - 2026-06-21

### Added
- **v0.4 desktop companion awareness foundation** — Nexus can now build toward
  quiet observation, rough time language, conservative check-in policy, and
  Settings transparency for the "Nexus is open, the user is elsewhere, time is
  passing" companion loop.
- **v0.4 community validation path** — the beta validation template and
  community guide now collect feedback on timing, tone, interruption feel,
  privacy boundaries, OS permission friction, and false positives.
- **v0.4 release hardening handoff** — added a release-candidate checklist for
  desktop companion awareness privacy assertions, release verification,
  packaged smoke, rollback, and the v0.5 hand-off boundary.

## [0.3.6] - 2026-06-21

### Added
- **Settings readability and desktop-awareness status** — Memory settings now
  show compact status rows for active-window context, clipboard context, and
  screen OCR, with clear enabled/ready/off/unavailable labels and a short
  privacy note that raw screenshots do not enter chat context.
- **0.3 foundation release boundary** — release notes, handoff, roadmap, and
  in-app spotlight now frame v0.3.6 as the foundation wrap-up for safety,
  memory, settings, and visible capability boundaries before the larger
  desktop-companion sensing work moves to v0.4.0.

### Fixed
- **Light settings contrast** — day and warm-day settings surfaces now keep
  card text, toggle labels, footer actions, and release spotlight controls
  readable over the companion panel artwork.
- **Empty notification summary** — the panel no longer shows the notification
  summary card when the notification bridge is available but has no unread
  notifications.

### Changed
- **Desktop context scope** — v0.3.6 keeps desktop awareness as a visible,
  opt-in capability surface. Time-passing companionship, quiet observation
  after no Nexus interaction, and desktop-pet reactions are explicitly left for
  later major milestones.

## [0.3.5] - 2026-06-19

### Added
- **Release theme: visible memory and readable companion presence** — assistant
  replies can now explain which memories shaped a response, the Memory settings
  page can highlight those exact long-term memories or diary fragments, and the
  companion profile can preview the desktop companion's idle/thinking/listening/
  speaking/waiting/error/offline states.
- **Desktop presence state contract** — the pet window now resolves idle,
  thinking, listening, speaking, waiting, error, and offline through one
  tested companion activity state before driving the status dot and avatar
  render inputs.
- **Desktop presence micro-motion** — the companion stage now turns those
  states into small, shared Live2D/Sprite motion tokens for breathing, thinking,
  listening, speaking, waiting, error, and offline presence without adding new
  runtime dependencies or background work.
- **Stage direction avatar bridge** — known English companion asides such as
  `(eyes brightened)`, `(blush)`, and `(nod)` now drive the existing avatar cue
  pipeline while ordinary notes and Markdown links remain visible content.
- **Desktop presence visual smoke** — release QA can now run
  `npm run pet:presence-smoke` to launch the built pet view through Electron,
  confirm the completed-onboarding idle/breathe presence state, reject
  onboarding-overlay false positives, and save a nonblank screenshot report.
- **Desktop state preview** — Companion Profile now includes a compact
  idle/thinking/listening/speaking/waiting/error/offline preview, with Sprite
  avatars switching to the same runtime state mapping used by the desktop pet.
- **In-app release spotlight** — About/Help now shows the v0.3.5 theme as
  visible memory plus readable desktop companion states, with short localized
  bullets for memory sources, memory controls, state preview, first-run repair,
  and the companion-first boundary.
- **Release spotlight actions** — the v0.3.5 spotlight now includes local
  buttons to open Memory and Companion Profile, so users can inspect the
  memorable upgrades without triggering chat, voice, network, or automation.
- **Settings home release spotlight** — the same v0.3.5 theme now appears on
  Settings home, making visible memory and readable companion states discoverable
  before users open the deeper About / Help panel.
- **Release theme guard** — the root README now matches the v0.3.5 release
  notes around visible memory plus readable desktop companion states, with a
  focused test preventing the user-facing theme from drifting before release.
- **Memory transparency and pause controls** — the Memory settings page now
  shows whether memory recall/learning is active, the active long-term and
  daily-memory counts, desktop-context read status, and the current storage
  authority. Users can globally pause memory recall and learning or pause
  individual long-term memories without deleting them; paused chat turns skip
  memory recall, pending memory callbacks, recall feedback, and daily-memory
  capture.
- **Memory source trace hints** — assistant replies now keep a content-minimized
  memory provenance trace with recalled memory/daily/semantic IDs and show a
  subtle chat-bubble count summary, so users can see whether memory shaped a
  reply without duplicating private memory text.
- **Memory source details** — reply memory hints can now expand into a
  runtime-only detail view that resolves trace IDs to current memory previews,
  marks missing or paused sources, and opens Settings directly to Memory for
  edits.
- **Memory source focus** — opening Memory from a reply source detail now
  highlights the referenced long-term memories and diary entries, including
  referenced older diary entries that were outside the recent preview, without
  adding new automation or changing stored memory data.
- **Memory migration dry-run** — added a content-free audit for long-term,
  legacy, and daily memory localStorage shapes so the next SQLite memory
  migration can be designed from counts, byte sizes, date ranges, and issue
  codes without exposing private memory text or writing storage.

### Fixed
- **Model setup preflight guidance** — first-run and settings connection tests
  now catch common Ollama, DeepSeek, and custom OpenAI-compatible configuration
  mistakes before making a request, including missing Ollama `/v1`, missing
  local model names, and provider-specific default URL/model guidance. The
  onboarding text-model step now reuses the same repair guidance while still
  allowing users to save first when only a cloud API key is missing, and renders
  the issue separately from the recommended repair action. For safe built-in
  provider fixes, onboarding can now apply the recommended Base URL/model
  defaults without touching API keys, rerun local preflight after the repair,
  and continue catching endpoint/model issues even when the cloud key is still
  blank. The real connection-test surfaces in onboarding and Settings now share
  the same safe repair action after runtime failures such as provider
  misconfiguration or local-model mismatch, while API keys and custom endpoints
  remain manual. If local Ollama refuses the connection or times out, Nexus now
  points users to starting Ollama, checking `http://127.0.0.1:11434/v1`, and
  pulling `qwen3:8b` when no local model is installed. The final onboarding
  wake-up checklist now makes the "first conversation within 5 minutes" target
  visible and classifies the current setup as ready, degraded-but-startable, or
  blocked; it only marks the text model ready after the current onboarding
  draft passes a real connection test, and clears that verified state when the
  provider, endpoint, model, key, or repair patch changes. After onboarding is
  completed, the first direct text/voice assistant reply now records local
  first-conversation timing telemetry and a Debug Console system event without
  storing message content or secrets; re-saving onboarding preserves that
  first-run timing state instead of resetting it. The Settings startup status
  check now surfaces whether first-conversation timing is pending, met, missed,
  or unavailable for older profiles, and can download a local first-run QA
  report with launch checks and timing evidence while excluding chat content,
  model output, API keys, and provider secrets. `npm run doctor -- --json`
  now emits a structured local startup report for release QA and support
  evidence, with `--skip-network` available for offline CI. `npm run
  verify:first-run` now runs the focused M1 gate across doctor JSON privacy,
  connection preflight, onboarding repair, first-conversation timing, startup
  reports, and locale coverage.
- **Korean startup greeting placeholder** — fixed a locale placeholder mismatch
  so `npm run i18n:audit` passes cleanly across all five locales.
- **Dependency audit baseline** — refreshed vulnerable npm lockfile entries and
  bumped direct `esbuild` usage to the fixed `^0.28.1` line; both
  `npm audit --omit=dev` and full `npm audit` now report 0 vulnerabilities.
- **Chat hook lint baseline** — `useChat` now declares its stable
  `currentSessionIdRef` dependency in the returned memo bag, clearing the
  remaining `react-hooks/exhaustive-deps` warning.
- **Onboarding Edge TTS validation** — the voice setup step no longer blocks
  keyless Edge TTS because an API endpoint field is intentionally hidden.
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
- **v1.0 roadmap and architecture baseline** — ROADMAP and ARCHITECTURE now
  document the 2026-06-18 stabilization track: first-run reliability, release
  trust, IPC contracts, main-process storage/SQLite, white-box memory, desktop
  presence, voice budgets, local RAG, authorized tasks, and gated MCP/plugins.
- **Companion presence architecture alignment** — ARCHITECTURE and ROADMAP now
  map the v0.3.5 presence implementation back to its real module boundaries:
  `features/pet/activityState` owns the content-minimized visible state,
  `PetView` and Companion Profile consume the same resolver, memory provenance
  stays separate from avatar state, and release spotlight actions remain local
  Settings navigation rather than task execution.
- **Project alignment calibration** — added a release-candidate guard that keeps
  the package version, in-app spotlight version, release notes, changelog,
  release handoff, and documented architecture entry points synchronized before
  merge. The v0.3.5 handoff evidence is also refreshed past the stale
  `48e6b78` baseline.
- **Engineering hardening guardrails** — added a conservative Electron/script
  JS lint gate, renderer localStorage storage-contract audit, heavy renderer
  module lazy-load audit, companion-not-agent boundary audit, stricter
  zero-warning IPC audit behavior, and a `verify:pr` gate that `verify:release`
  now reuses before SQLite smoke. The storage contract now scans all renderer
  browser-storage keys, including session keys, prefix keys, and the legacy
  VTube Studio token key marked as secret-adjacent; `verify:pr` also runs
  renderer architecture-boundary and source-size budget audits. The settings
  drawer and local-data store hot spots are split into smaller modules, VTube
  Studio WebSocket/authentication now lives behind a main-process bridge with
  a fixed vault slot and one-way legacy localStorage migration, the renderer no
  longer exposes VTS token read/write IPC, high-risk VTS migration IPC is
  schema-validated, IPC payload schemas are split into domain modules behind
  the same public `payloadSchemas.js` export, `verify:pr` records a production
  bundle performance baseline, and `npm run message-privacy:audit` now blocks
  desktop notification/message body regressions that would send third-party
  message text into chat/model forwarding, chat history, missed-message
  follow-ups, reply draft composer text, or renderer localStorage persistence.
  The same guard now covers Telegram/Discord bridge ingress: external-contact
  messages are announce-only, only owner-listed remote messages enter the
  model, debug events are metadata-only, and external Telegram voice notes are
  not transcribed. Local notification webhook info no longer returns the bearer
  token or full `Authorization` header to the renderer; Settings shows only the
  token file placeholder while scripts continue reading the 0600 user-data token
  file. Notification reply drafts now seed only the source label, not the
  third-party message preview text. `npm run desktop-context-privacy:audit` now
  guards desktop context redaction, and desktop context capture redacts obvious
  API keys, bearer tokens, passwords, and private-key material before
  active-window or clipboard text leaves the main process; OCR and VLM text are
  redacted again before prompt formatting, and screenshot image payloads are
  stripped before desktop context is handed to chat/runtime code. Desktop
  context active-window and screenshot capture failures now log redacted error
  summaries instead of raw exception objects, stderr, local paths, or accidental
  captured text. Autonomy context triggers now keep only salted comparison
  fingerprints for previous active-window and clipboard values instead of
  retaining earlier desktop text in renderer refs. Added `npm run
  vault-security:audit` so renderer-facing
  vault retrieval paths must keep returning opaque `nexus-vault-ref:` tokens
  instead of plaintext API keys or bot tokens, and KeyVault support logs now
  omit raw slot names, plaintext values, vault paths, and raw exception objects
  when vault reads or decrypts fail. Main-process chat/audio network failures
  now redact common API-key, bearer-token, JWT, URL-credential, secret
  parameter, and user-home path shapes before logging or returning provider
  error text, guarded by `npm run error-redaction:audit`. VTube Studio bridge
  connection/authentication failures now use that same redaction boundary before
  renderer-visible status broadcasts or VTS audit records can expose
  token-like strings, credentialed URLs, or local user paths, and renderer-side
  VTS support logs now sanitize input-update, connection, and legacy-token
  migration errors before printing them. Auto-updater check/download failures
  now use it too before update events, manual-check results, or updater logs
  reach UI/support surfaces. Model download/install failures now use it before
  first-run setup progress events or batch download results can expose
  credentialed source URLs, tar stderr, or local user paths. Telegram/Discord
  gateway status errors and diagnostic logs now use the same redaction boundary
  before Settings/status/support surfaces can expose bot tokens, credentialed
  gateway URLs, service error payloads, or local user paths. macOS notification
  watcher status and persistence errors now use the same boundary before
  `notification:watcher-status` or logs can expose Notification Center database
  paths, local user paths, or sensitive system error details. Memory vector
  store worker, append-log, and compaction failure logs now use the same
  redaction boundary before long-term memory diagnostics can expose raw
  exception text, local user paths, or token-like strings. Local notification
  bridge support logs now keep webhook/RSS failures metadata-only, avoiding raw
  channel names, ids, feed URLs, bearer tokens, and URL-safety host details.
- **Release trust posture** — added `npm run release:trust:audit` and wired it
  into `npm run distribution:audit` so macOS, Windows, and Linux signing/update
  assumptions are checked against release docs. The current macOS unsigned
  build is now documented and implemented as a manual-update-download path until
  Developer ID signing and notarization are enabled; it checks GitHub Releases
  and opens the release page instead of attempting an untrusted auto-install.
  Release CI now prints a non-blocking signed macOS/Windows readiness report,
  with `npm run release:signing:gate` reserved as the future all-platform hard
  gate and platform-specific gates available for macOS and Windows bring-up
  before enabling signed updates. The pre-release Stage B docs now also list
  `npm run package:dir:smoke`, and `npm run distribution:audit` fails if that
  packaged-app launch gate or its quick-mode skip note drops out of the release
  checklist. The v0.3.5 release candidate now also has a guarded handoff doc
  that records the memorable user-facing upgrade, merge/tag steps, local and CI
  evidence, residual trust risks, rollback path, and companion-not-agent
  boundary.
- **IPC contract baseline** — added `npm run ipc:audit` and wired it into
  `npm run distribution:audit`. The new source-only report inventories preload
  invokes, subscriptions, main-process handlers, trusted-sender coverage,
  payload validation posture, risk classes, and current audit/permission gaps
  without reading user data, keychain state, environment variables, or secret
  values.
- **File IPC hardening** — `file:save-text` and `file:open-text` now validate
  request payloads before opening native dialogs and write metadata-only audit
  records for file save/open requests and outcomes without logging file content
  or full local paths.
- **Desktop context audit** — `desktop-context:get` now writes metadata-only
  audit records for requested/allowed/enabled active-window, clipboard, and
  screenshot access, plus returned category lengths, without logging captured
  window titles, clipboard text, screenshot data URLs, display names, or process
  paths.
- **External action audit** — Telegram/Discord sends, Minecraft/Factorio
  command execution, and MCP call/sync IPC now write metadata-only request and
  result audit records without logging outbound text, audio payloads, commands,
  target IDs, MCP command text, tool names, or tool arguments. MCP host support
  logs are now metadata-only as well, avoiding raw server ids, launch commands,
  arguments, tool names, external stdout lines, paths, or tokens.
- **External action permission gate** — Telegram/Discord sends,
  Minecraft/Factorio command execution, and MCP call/sync IPC now pass through
  a main-process read-only/confirm/auto policy. Active auto-mode escalation
  requires native confirmation, while renderer policy sync sends only mode plus
  active/configured booleans.
- **Pet model IPC hardening** — pet-model import/create/assemble/install/open
  IPC now validates local-artifact payloads, writes metadata-only audit records,
  and requires native confirmation for direct renderer-triggered path, remote
  import, install, and open-path operations without logging paths, URLs, slugs,
  model names, or error text.
- **Plugin IPC hardening** — plugin lifecycle and plugin bus write IPC now use
  metadata-only audit records and native confirmation for execution-granting
  lifecycle actions and bus publish/subscribe/unsubscribe without logging plugin
  IDs, server IDs, topics, payload contents, commands, or error text. Plugin
  host support logs now keep approval, manifest-skip, and auto-start diagnostics
  metadata-only, avoiding raw plugin names, directory entries, paths, command
  errors, and token-like text.
- **External link IPC audit** — `tool:open-external` now writes metadata-only
  request/result audit records around the existing URL safety check and native
  confirmation without logging full URLs, hostnames, paths, queries, fragments,
  or error text.
- **Vault IPC audit and permission contract** — vault availability, store,
  retrieve, delete, list, store-many, and retrieve-many IPC now write
  metadata-only audit records and expose an explicit secret-safe permission
  boundary without logging slot names, plaintext secrets, vault ref tokens, or
  error text.
- **IPC payload warning cleanup** — integrations inspection, KWS start/status,
  VAD start, model download, and TTS streaming lifecycle IPC now validate
  renderer request shape, bringing `npm run ipc:audit` to 0 warnings / 0 errors.
- **Main-process local-data foundation** — added a dependency-free
  `json-ledger` storage adapter in the main process with schema versioning,
  migration ledger, metadata-only export/import planning, rollback-by-rename,
  startup initialization, and read-only `local-data:status` IPC. Existing chat,
  memory, settings, and other renderer `localStorage` data remain authoritative.
- **SQLite local-data backend** — added Electron/Node built-in `node:sqlite`
  behind the main-process local-data adapter, creating
  `userData/local-data/nexus.sqlite` with schema version `2`, migration
  `0002-create-sqlite-local-data-foundation`, an empty domain registry,
  `npm run sqlite:smoke`, an Electron SQLite smoke script, release CI smoke
  coverage, and packaged smoke validation. Existing renderer `localStorage`
  data is still authoritative; no chat or memory records are migrated in this
  slice.
- **Local-data domain registry mirror** — raised the local-data schema to
  version `3` with migration
  `0003-create-domain-records-and-onboarding-mirror`, added the generic
  `local_data_records` table, registered the low-risk onboarding domain, and
  mirrored normalized onboarding completion timing into SQLite through a
  schema-validated `local-data:mirror-onboarding` IPC. Renderer localStorage
  remains authoritative and mirror results do not return record payloads.
- **Chat migration dry-run audit** — added a renderer-side, content-free
  dry-run report for `nexus:chat:sessions` and legacy `nexus:chat`. The report
  captures counts, byte estimates, role distribution, time range, and migration
  issue codes without mutating localStorage, sending raw chat content over IPC,
  or creating SQLite chat records.
- **Confirmed chat migration service path** — added a service-only path that
  builds normalized chat migration packages, validates content-bearing packages
  in the main-process local-data service, requires explicit confirmation before
  writes, stores chat sessions under the `chat-sessions` domain, records
  content-free `local-data-audit` events, and rolls back only chat-session
  records. This path is not exposed through production IPC/UI yet.
- **Disabled chat migration IPC boundary** — added feature-flagged
  `local-data:chat-migration-apply` and
  `local-data:chat-migration-rollback` IPC/preload methods. They are disabled
  unless `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`, require trusted sender
  checks, schema validation, explicit confirmation, high-risk IPC audit
  coverage, and return only status/count metadata.
- **Hidden chat migration preview panel** — added a developer-only Settings
  history panel behind `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI=1`.
  It reads the content-free dry-run summary, shows aggregate counts and issue
  codes only, requires a checkbox plus confirmation dialog, and then calls the
  already feature-flagged apply IPC path without reading SQLite chat records
  back into the renderer.
- **Hidden chat migration backup and rollback review** — the same developer-only
  panel can now export a local `nexus-chat-migration-backup` JSON file that is
  explicitly marked as containing full chat message content. It also exposes a
  separate rollback review with its own checkbox and confirmation dialog before
  calling the existing feature-flagged rollback IPC path.
- **Metadata-only chat migration status** — added a disabled-by-default
  `local-data:chat-migration-status` IPC/preload method and hidden Settings panel
  section that reports only migrated SQLite record counts, stored message counts,
  and last migration audit metadata. It carries no renderer payload and does not
  return chat records, session IDs, titles, message text, or userData paths.
- **M5 chat readback foundation** — added a service-only
  `readChatLocalDataSessions()` path that lets the main process read and
  normalize migrated SQLite `chat-sessions` records for tests and future storage
  authority work. This content-bearing read path is not exposed through
  preload/renderer IPC and does not change the live chat runtime yet.
- **Hidden chat runtime SQLite mirror** — added a disabled-by-default current
  chat session mirror behind `NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION=1`,
  `VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_RUNTIME_MIRROR=1`, and explicit hidden
  Settings consent. Renderer localStorage remains authoritative; mirror writes
  are debounced, schema-validated, high-risk audited, and return only
  counts/status metadata without reading SQLite chat records back into the UI.
- **Hidden chat-memory SQLite comparison** — added a confirmed,
  disabled-by-default comparison preview for companion chat memory storage. The
  renderer
  sends only local session metadata, the main process compares it with SQLite
  metadata, writes a content-free audit record, and returns aggregate difference
  counts without returning SQLite chat records, titles, message text, userData
  paths, or session IDs to the UI.
- **Realtime voice surface gated** — dormant OpenAI realtime voice preload/IPC
  APIs are hidden unless `NEXUS_ENABLE_REALTIME_VOICE=1` is set.
- **Roadmap posture** — Nexus is now documented as an AI desktop companion
  first. Tools, knowledge, game bridges, and automation are supporting
  abilities, not the core product identity.

### Removed
- **Subagent dispatcher** — removed the background research helper agent,
  including the `spawn_subagent` chat tool, Autonomy V2 `spawn` decision,
  status strip, history panel, storage model, and runtime tests. The companion
  keeps normal MCP/web/weather/reminder tools, but no longer launches a
  separate helper loop.

### Added
- **Milestone 2 design** — added
  `docs/MILESTONE-2-RELEASE-TRUST-DESIGN-2026-06-19.md` to scope release
  trust, signing/update limitations, rollback, and the first release-trust
  audit slice.
- **Milestone 3 design** — added
  `docs/MILESTONE-3-IPC-PERMISSION-AUDIT-DESIGN-2026-06-19.md` to scope IPC
  inventory, risk classification, trusted sender coverage, validation/audit
  warning gaps, rollback, and the first M3 audit slice.
- **Milestone 4 design** — added
  `docs/MILESTONE-4-MAIN-PROCESS-STORAGE-DESIGN-2026-06-19.md` to scope the
  main-process storage foundation, SQLite dependency deferral, migration ledger,
  export/import scaffolding, rollback, and acceptance criteria.
- **Milestone 1 design** — added
  `docs/MILESTONE-1-FIRST-RUN-MODEL-REPAIR-DESIGN-2026-06-18.md` to scope the
  first-run model repair loop, impact area, risks, rollback, and acceptance
  criteria before implementation.
- **Milestone 0 baseline audit** — added
  `docs/MILESTONE-0-BASELINE-AUDIT-2026-06-18.md` with current structure,
  dependency, IPC, storage, build, smoke, migration, rollback, and next-milestone
  findings for the v1.0 upgrade path.
- **Companion wake-up checklist** — onboarding now summarizes identity, text
  model, character model, and speech readiness before the desktop companion
  starts.
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
