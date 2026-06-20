# Nexus v0.3.5 — Memory is visible. The companion feels present.

> **The memorable upgrade:** Nexus can now show which memories shaped a reply,
> and the desktop companion has readable states you can preview: idle, thinking,
> listening, speaking, waiting, error, and offline.
>
> This release keeps Nexus pointed at companionship, not autonomous work
> execution. The trust work around first-run setup, IPC, release posture, and
> SQLite rehearsal exists to make memory local, visible, reversible, and under
> the user's control while the companion becomes more visibly present.

## What changes for users

### Memory is no longer hidden background magic

This is the companion-memory headline for v0.3.5. Existing memory still lives in
renderer `localStorage` by default, and nothing is deleted.

- Assistant replies can show a small memory-source hint when memory shaped the
  response.
- Expanding that hint resolves the stored source IDs against the current memory
  state, marks missing or paused sources, and opens Settings directly to Memory.
- The About / Help spotlight also has a local "Review Memory" action that opens
  Memory without starting a chat, model request, or migration.
- Settings home surfaces the same release theme so memory controls are visible
  before users open the deeper About / Help panel.
- Opening Memory from a reply highlights the relevant memories and diary
  fragments, including older diary entries outside the recent preview.
- The Memory settings page now shows whether recall and learning are active,
  how many long-term memories and daily fragments are available, and which
  storage boundary is still authoritative.
- Users can pause all memory or pause individual long-term memories without
  deleting them.
- A new content-free memory dry-run inspects long-term, legacy, and daily memory
  localStorage shapes before any SQLite memory migration is attempted.

### The desktop companion has readable states

This is the user-visible presence upgrade for v0.3.5. Nexus still avoids
autonomous task-agent behavior, but the companion no longer feels like a static
status icon.

- The pet window now resolves idle, thinking, listening, speaking, waiting,
  error, and offline through one shared companion activity state.
- CSS-only micro-motion turns those states into subtle breathing, thinking,
  listening, speaking, waiting, error, and offline motion cues without new
  runtime dependencies.
- Companion Profile includes a compact desktop state preview so users and QA can
  inspect those states without forcing chat, voice, network, or Live2D rendering
  inside settings.
- The About / Help spotlight has a local "Preview Companion" action that opens
  Companion Profile directly.
- Settings home uses the same local action, so the desktop state preview is one
  click away from the first Settings screen.
- Sprite companions preview the same runtime state mapping used by the desktop
  pet, while Live2D remains lazy in the pet window.
- Common English stage directions such as `(eyes brightened)`, `(blush)`, and
  `(nod)` now drive avatar cues instead of reading like leaked task text.

### First conversation is easier to reach

- The first-run model setup now catches common Ollama, DeepSeek, and
  OpenAI-compatible mistakes before a real request is made.
- Safe repairs can fill built-in Base URL and model defaults without touching
  API keys.
- The final onboarding step shows whether the current setup is ready for the
  "first conversation within 5 minutes" target.
- Settings can export a local first-run QA report with launch checks and timing
  evidence, but no chat content, model output, API keys, or provider secrets.

### Release trust is more explicit

- Local release audits now check macOS, Windows, and Linux signing/update
  assumptions from repo config and docs.
- Unsigned macOS builds use a manual-download update posture until Developer ID
  signing and notarization are enabled.
- SQLite availability is smoke-tested before release-style packaging.

### Chat memory is moving carefully, not suddenly

This is the companion-memory groundwork for v1.0. Existing chat history still
lives in renderer `localStorage` by default, and nothing is deleted.

- A hidden dry-run can inspect local chat storage without sending message text
  over IPC.
- A hidden, explicitly confirmed migration path can write normalized chat
  sessions to main-process SQLite.
- A hidden runtime mirror can copy the current live chat session into SQLite
  while localStorage remains authoritative.
- A hidden comparison preview can compare local chat-session metadata with
  SQLite metadata and show aggregate differences.
- Rollback deletes only the SQLite chat-session records written by this path;
  localStorage chat history remains untouched.

## Under the hood

- Added source-only IPC contract auditing and brought the current preload/main
  handler surface to zero warnings.
- Hardened high-risk IPC families with schema validation, trusted-sender checks,
  metadata-only audit records, and confirmation/permission hints.
- Added the main-process local-data foundation under
  `userData/local-data/nexus.sqlite` using Electron/Node's built-in
  `node:sqlite`.
- Added metadata-only local-data status, onboarding mirror, chat migration
  status, chat runtime mirror, and chat comparison preview paths.
- Added content-free memory storage dry-run reports for future long-term memory
  SQLite migration design.
- Added a source-only message privacy audit and tightened desktop notification
  handling so third-party message bodies remain local preview data, not
  automatic model input, persisted chat history, follow-up hints, or renderer
  localStorage payloads.
- Notification reply drafts now keep that same local-preview boundary: the
  composer is seeded with the message source only, not the third-party message
  text shown in the notification preview.
- Tightened Telegram/Discord bridge ingress so external contacts cannot use an
  allowed bridge channel to push their message text into Nexus' model context;
  only owner-listed remote messages are forwarded, bridge debug logs stay
  metadata-only, and external Telegram voice notes are not transcribed.
- Stopped returning the local notification webhook bearer token to the renderer;
  Settings now shows the token file placeholder, while local automation scripts
  continue reading the `0600` token file directly.
- Desktop context now redacts obvious secrets such as API keys, bearer tokens,
  passwords, and private-key material before active-window or clipboard text
  leaves the main process; OCR and VLM text are redacted again before prompt
  formatting. Screenshot image data is used only as a temporary OCR/VLM input
  and is stripped before desktop context is handed to chat/runtime code.
  Autonomy context triggers now keep only salted comparison fingerprints for
  previous active-window and clipboard values instead of retaining earlier
  desktop text in renderer refs.
- Kept renderer access to plaintext secrets blocked through the safeStorage
  vault/ref pattern, and added `npm run vault-security:audit` so vault
  retrieval paths must keep returning opaque `nexus-vault-ref:` tokens instead
  of plaintext API keys or bot tokens.
- Main-process chat/audio network failures now redact common API-key, bearer
  token, JWT, URL credential, secret parameter, and user-home path shapes before
  logging or returning provider error text; `npm run error-redaction:audit`
  keeps that boundary in the PR/release gate.
- Desktop context active-window and screenshot capture failures now log
  redacted error summaries instead of raw exception objects, stderr, local
  paths, or accidental captured text.
- VTube Studio bridge connection/authentication errors now use the same
  redaction boundary before renderer-visible status updates or VTS audit records
  can expose token-like strings, credentialed URLs, or local user paths.
- Auto-updater check/download errors now use the same redaction boundary before
  renderer-visible update events, manual-check results, or updater logs can
  expose token-like strings, credentialed URLs, or local user paths.
- Model download/install failures now use the same redaction boundary before
  first-run model setup progress events or batch download results can expose
  credentialed source URLs, tar stderr, or local user paths.
- Telegram/Discord gateway status errors and diagnostic logs now use the same
  redaction boundary before Settings/status/support surfaces can expose bot
  tokens, credentialed gateway URLs, service error payloads, or local user
  paths.
- macOS notification watcher status and persistence errors now use the same
  redaction boundary before Settings/status surfaces or logs can expose
  Notification Center database paths, local user paths, or sensitive system
  error details.
- Local notification bridge support logs now keep webhook/RSS failures
  metadata-only, avoiding raw channel names, ids, feed URLs, bearer tokens, and
  URL-safety host details.
- MCP host support logs now keep external-process output metadata-only, avoiding
  raw server ids, launch commands, arguments, tool names, stdout lines, paths,
  and tokens.
- Renderer-side VTube Studio support logs now sanitize token-like strings and
  local paths before printing connection, input-update, or legacy-token
  migration errors.
- KeyVault support logs now avoid raw slot names, plaintext values, vault
  paths, and raw exception objects when vault reads or decrypts fail.

## Product boundary

Nexus is still a desktop companion. This release does not add a Codex-style
work agent, task planner, autonomous executor, or background work system. The
storage and audit work exists so future memory feels local, visible,
reversible, and under the user's control; the presence work exists so Nexus
feels more alive on the desktop without taking work away from the user.

## Known issues

- macOS packages are still unsigned in local smoke builds. Gatekeeper may keep
  the quarantine bit, so first launch may require the usual right-click -> Open
  flow or, for advanced users, removing quarantine with `xattr`.
- Windows signing gates are prepared but final installer trust still depends on
  a real signing certificate; unsigned builds may show SmartScreen warnings.
- `node:sqlite` still emits an ExperimentalWarning in this Node/Electron line.
- Optional KWS/SenseVoice models may be missing in local smoke environments.
- Torch-backed Python sidecars remain disabled when torch is not installed.
- Desktop message awareness remains macOS-first; Windows support is still not
  equivalent.

## Notes & limitations

- This is a stable release candidate for manual GitHub release publishing.
- Signed macOS and Windows release gates are prepared but still require real
  signing credentials before trusted auto-update can be enabled.
