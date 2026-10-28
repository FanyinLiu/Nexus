# Nexus v0.4.8 — A Companion That Stays Closer

**Status: Stable unsigned release.** v0.4.8 is the current stable version and
this document is its formal release record. It was promoted through the
standard beta flow from `v0.4.8-beta.1` (published 2026-10-15); the planned
`0.4.8-beta.2` package was dropped. Official assets are created only from the
release commit by the protected tag workflow.

v0.4.8 brings the companion closer to your day: it follows where you are
working and notices when you type, the panel can handle messages without
opening the chat, and memory can reach out about a promise you made. It also
makes the everyday parts calmer: three looks, one plain settings path, a
smaller install, and clearer words when something goes wrong.

## What changed

### The companion stays closer

- The pet follows your cursor across the screen and notices typing in coarse
  strokes, without blocking what you are doing.
- The frameless backdrop stays off unless you turn it on, so the character
  stands on your desktop instead of sitting inside a panel.
- Keyboard sensing is only active when you turn on typing awareness. On Linux,
  looking around no longer keeps a keyboard-capable hook running.

### Three ways to look

- Settings can switch between Warm companion, System look, and A little
  character. Warm companion is the default.
- Every look has a light and a dark version and changes without reopening the
  app. On a Mac, System look uses the desktop blur; other computers keep a
  translucent panel.
- The same look reaches the small details: line icons in soft badges,
  notification cards that match the look's color and corners, a light focus
  ring, and the berry accent for your messages in A little character.

### Messages on the companion panel

- Telegram and Discord messages show as cards on the default panel.
- Reply and read stay on the card. Later and important sit in a small menu.
- A card shows one preview line while the message still has text, and the same
  arrival is not copied into the chat.

### Voice

- Setup can suggest a speech model from a check of this computer's hardware.
- Local voice models can be checked and repaired from Settings.
- SenseVoice downloads when you choose it instead of shipping inside the
  installer, and its transcripts now come through instead of arriving empty.
- GLM-ASR and OmniVoice start only when you choose that engine and turn the
  matching voice switch on. They stop again when either one is off, so the
  optional Python services no longer sit in memory for everyone else.
- Setup and voice notices now use short, friendly wording. Raw technical text
  stays in the log instead of on screen.
- The voice screens and local model list are written in plain language in all
  five interface languages. Developer wording about mirrors, packages, and
  model formats is gone.

### Memory that follows through

- Long-term memory now keeps a cleaner record that can be reviewed and
  reconciled, so the companion keeps a steadier picture of what happened.
- An open loop keeps a commitment from chat as one item that later details
  update. The companion can reach out before the due time, offer a reminder the
  night before, and ask once afterwards whether it got done.
- SOUL and memory cards are editable, with the evidence behind a change and a
  one-tap undo. The SOUL card now edits the persona that chat actually uses.
- Follow-ups share one proactive agenda instead of several separate nudges, and
  a global pause stops capture and tidying while it is on.
- Clearing memory now removes it everywhere: the search copy of memory, the
  memory pages, the app's own storage logs, presence notes, and the snapshots
  kept for updates. Deleting one memory also removes its snapshot copy, and a
  damaged memory file is kept aside instead of being overwritten.

### Setup and settings

- Settings is five plain pages with one advanced disclosure each, instead of a
  long wall of switches.
- The guide starts by choosing the language. The text model, character, and
  always-on window come first; voice, tools, memory, and desktop context can
  wait.
- The first-use guide opens in the panel, and Settings can open it again.
  Finishing takes one click, and a failed model save shows a notice you can
  retry.
- After wake-word setup, voice model setup waits for the first time voice is
  used, so it no longer appears in a hidden window before you need it.

### Updates and the app behind the scenes

- An update flushes your data first and waits until you confirm the install.
- Each window only receives the capabilities that belong to it.
- The app runs on Electron 43.7.11, with additional crash handling and safer
  external links.
- The companion's listening, thinking, and replying states come from the real
  chat request, and a reply's mood is applied in order, so a sad reply no
  longer keeps a happy face.

### A smaller install and the October catalog

- Bundled characters are the official Live2D samples: Mao, Haru, and Hiyori,
  with Mao as the default. Live2D is the only pet type. A saved picture or
  sprite choice becomes Mao.
- Minecraft and Factorio stay hidden until a later release.
- The October 2026 model defaults are in, including `gpt-6-sol`, MiniMax
  `MiniMax-M3`, and DeepSeek V4.1 Flash on SiliconFlow and NVIDIA.
- `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` leave the MiniMax pickers before
  the 2026-11-18 retirement. A saved choice moves to `MiniMax-M3`, and the
  plan you were on stays put.
- Custom OpenAI-compatible speech-to-text defaults to `gpt-transcribe`, the
  model OpenAI recommends for a finished recording. A saved
  `gpt-4o-mini-transcribe` value moves; a name you typed for your own service
  stays.

### Fixed during the beta

- Both eyes blink together again.
- SenseVoice returns the words you said instead of an empty transcript.
- The SOUL card shows and saves the persona chat actually receives.
- Turning typing awareness off stops the keyboard hook even while gaze follow
  stays on.
- Delayed voice model setup stays visible, and the guide no longer shows a
  grey backdrop or a duplicate missing-key line.
- Mao stays visible after hiding and restoring the pet, and after onboarding.
- Copy cleanup across all five languages removes promises the app could not
  keep and wording that described internals instead of what you see.

## Validation boundary

The release commit must pass `verify:release`, the Live2D smoke, packaged
smoke, the sustained runtime gate, and the full `prerelease-check -- v0.4.8`
flow before the protected tag workflow publishes assets. Cross-platform CI must
be green on macOS, Windows, and Linux.

No cross-platform physical-device evidence is claimed.

## macOS unsigned auto-update limitation

The macOS arm64 build is ad-hoc signed, not Apple Developer ID signed or
notarized. Gatekeeper may require right-click → Open or
`xattr -dr com.apple.quarantine /Applications/Nexus.app`. Unsigned macOS builds
only check for a new version and open the official release page; the update is
downloaded and installed by hand.

## Windows unsigned installer limitation

The Windows x64 installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning. Bypassing that warning is not a security guarantee.
Use only the official GitHub Release and verify its published SHA-256 checksum.

## Scope boundary

- No dependency changes beyond the Electron 43.7.11 update and the production
  advisory patches already on this line.
- No telemetry, no new desktop sensing source, and no signed installer.
- No v0.5 window interaction, local Kokoro speech, or gaming companion work.

## Known issues

- No cross-platform physical-device evidence is claimed.
- The macOS and Windows builds remain unsigned, so the first launch can show a
  system trust prompt.
