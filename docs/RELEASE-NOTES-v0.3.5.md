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

### Long-term memory is easier to understand and control

This release makes memory feel less like a hidden model trick and more like
something the user can inspect.

- The Memory settings page now shows whether recall and learning are active,
  how many long-term memories and daily fragments are available, and which
  storage boundary is still authoritative.
- Users can pause all memory or pause individual long-term memories without
  deleting them.
- Assistant replies can show a small memory-source hint when memory shaped the
  response.
- Expanding that hint resolves the stored source IDs against the current memory
  state, marks missing or paused sources, and opens Settings directly to Memory.
- Opening Memory from a reply highlights the relevant memories and diary
  fragments, including older diary entries outside the recent preview.
- A new content-free memory dry-run inspects long-term, legacy, and daily memory
  localStorage shapes before any SQLite memory migration is attempted.

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
- Kept renderer access to plaintext secrets blocked through the safeStorage
  vault/ref pattern.

## Product boundary

Nexus is still a desktop companion. This release does not add a Codex-style
agent, task planner, autonomous executor, or background work system. The storage
and audit work exists so future memory feels local, visible, reversible, and
under the user's control.

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
