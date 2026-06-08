# Nexus v0.3.3-beta.1

> **Beta — maintenance & polish.** First beta of the `v0.3.3` line on top of `v0.3.2`: a reliability, behaviour-polish, and slimming release. It makes imported character cards actually drive chat, adds a cloud→local voice-recognition fallback, fixes a cluster of voice/notification/persona bugs, changes a couple of pet defaults for the better, and removes ~2,500 lines of dead/dormant code. No major new feature surface — the bigger autonomy work is tracked separately for v0.4. As a pre-release it is for manual validation only; stable users are not auto-upgraded.

## What changes for users

### Desktop pet

- **Default pet renamed to “Pip.”** The bundled sample sprite pet (previously shown as “Terminal Pet”) is now **Pip**, and its description makes clear it’s a sample/test pet demonstrating the sprite-pet system — still a fine default to start from.
- **Pets now show their scene backdrop by default.** Sprite pets used to default to free-roam mode (transparent background, character only). They now default to **fixed mode with the time-of-day backdrop**. The transparent “roam the whole desktop” mode is now **opt-in** — toggle it from the new setting (Settings → pet) or the pet’s right-click menu. *(If you previously relied on the transparent default, just switch the toggle on.)* Pets you had explicitly set are unaffected.
- **A new in-app free/fixed toggle** for sprite pets (previously only available on the right-click menu).
- **The “spawn clone (分身)” feature was removed.** The right-click options to spawn/dismiss extra roaming pet windows are gone; the single companion is unaffected.
- Hidden pets no longer burn CPU/battery — locomotion is paused while the window is hidden.

### Voice

- **Cloud→local speech-recognition fallback.** When cloud transcription fails and you’ve enabled failover, Nexus now falls back to the fully-offline local SenseVoice model for that utterance (continuous/VAD path).
- A long continuous utterance no longer gets silently dropped (and no longer leaves voice stuck) — it’s flushed and transcribed.
- Barge-in no longer mistakes the assistant’s own tail audio for new user speech.

### Persona & character cards

- **Imported Character Cards can now drive chat.** Previously an imported card only shaped the autonomy/letters surface; the chat replies still used the global persona. With the new per-profile-persona setting enabled, the active card’s soul/personality drives chat too.
- An imported card no longer leaks a `[Character card: …]` placeholder into the prompt — the real assembled persona is used.
- Live2D models now keep their authored `surprised` / `confused` / `embarrassed` expressions (they were being silently dropped). Added docs on the Live2D auto-discovery naming/order conventions.

### Notifications

- Chinese urgency keywords (立即 / 紧急 / 重要 / 立刻) are now correctly prioritized — they were always being downgraded to normal priority.

## Reliability fixes

- Chat requests now retry once on a transient `429`/`5xx` before surfacing a failure (helps under provider rate-limits).
- SSRF redirect-following is now revalidated per hop on the chat/voice connection-test and model/voice-list probes.
- Fixed a regression where the panel-sent always-on-top / click-through toggles silently no-op’d.
- Fixed timezone-dependent flakiness in the usage/cost history.

## Under the hood

- **~2,500 lines of dead/dormant code removed:** orphaned test-only modules and barrels, the dormant realtime-voice backend (gated behind an off-by-default flag), the unused agent-workspace fs-tools stack, a dead inter-plugin delivery path, and duplicate/stub files.
- Dropped the unused `protobufjs` dependency.

## Known issues

- **Screen Recording permission on the unsigned build.** Because the app isn’t code-signed, macOS TCC may not list Nexus under System Settings → Privacy → Screen Recording until it actually requests capture. The default-off “desktop awareness” (screen OCR) is the only thing that requests it; turn that on (or use right-click → Open + remove the quarantine attribute) to get the prompt. Microphone behaves the same. Deferred to a future signed build.
- **Deferred internal cleanup (no user impact):** ~291 unused i18n keys and a small tail of dead exports are not yet pruned; planned for a follow-up.

## Notes & limitations

- **Unsigned distribution (macOS arm64).** First launch needs the usual right-click → Open; granting Microphone / Screen Recording follows the in-app prompts. Unchanged in `v0.3.3`.
- The “Codex pet” gallery/import/creator feature keeps its name — it integrates with the external `codex-pet.org` / `CodexPets.net` community ecosystem and is not Nexus-branded.
- This is a **pre-release**: download manually from GitHub Releases for validation. Stable users are not auto-upgraded.
