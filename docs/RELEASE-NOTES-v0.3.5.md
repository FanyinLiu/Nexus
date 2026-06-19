# Nexus v0.3.5

> **Stable — a safer foundation for a companion that remembers locally.** This
> release keeps Nexus pointed at companionship, not autonomous work execution.
> The big change is trust: first-run setup is easier to repair, release posture
> is clearer, IPC boundaries are stricter, and chat memory now has a hidden,
> reversible SQLite migration rehearsal before any storage authority switch.

## What changes for users

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
- Kept renderer access to plaintext secrets blocked through the safeStorage
  vault/ref pattern.

## Product boundary

Nexus is still a desktop companion. This release does not add a Codex-style
agent, task planner, autonomous executor, or background work system. The storage
and audit work exists so future memory feels local, visible, reversible, and
under the user's control.

## Known issues

- macOS packages are still unsigned in local smoke builds; first launch may
  require the usual right-click -> Open flow.
- `node:sqlite` still emits an ExperimentalWarning in this Node/Electron line.
- Optional KWS/SenseVoice models may be missing in local smoke environments.
- Torch-backed Python sidecars remain disabled when torch is not installed.
- Desktop message awareness remains macOS-first; Windows support is still not
  equivalent.

## Notes & limitations

- This is a stable release candidate for manual GitHub release publishing.
- Signed macOS and Windows release gates are prepared but still require real
  signing credentials before trusted auto-update can be enabled.
