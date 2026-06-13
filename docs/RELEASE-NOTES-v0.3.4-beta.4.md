# Nexus v0.3.4-beta.4

> **Beta — her little expressions reach her face, not the chat text.** Fourth beta of the `v0.3.4` line, on top of `v0.3.4-beta.3`. The companion narrates small expressions in passing — 「（眼睛亮了）」, 「（歪头）」 — meant to animate her avatar, not to be read as words. Occasionally one of those slipped into the visible reply as raw text. This release makes those stage directions behave consistently by SHAPE, not by a hand-maintained list, so the ones we recognise drive her face and the novel ones she invents read as quiet script asides instead of looking like leaked text — and she never speaks any of them aloud. As a pre-release it is for manual validation only; stable users are not auto-upgraded.

## What changes for users

### Her expressions land on her, not in the text

She often adds a small parenthetical to colour a reply — her eyes lighting up, a tilt of the head. Those are stage directions for her avatar, not lines to be shown or spoken. Sometimes one leaked into the chat as raw text and looked like a glitch.

- **Recognised expressions are just expressions.** When she writes something we understand — 「（眼睛亮了）」, 「（微笑）」, 「（歪头）」 — it now drives her avatar and is kept out of both the text and the voice, exactly as before. You feel it on her face, you don't read it.
- **Novel asides read as intentional, never as a leak.** When she invents an aside we don't have a face for — a playful 「（突然蹦出一只企鹅）」 — it stays in the reply but is rendered as a quiet, italic script note, clearly an aside rather than a stray line. So nothing she does looks broken, even the things we've never seen.
- **She never speaks an aside.** Whether recognised or not, a parenthetical aside is no longer read aloud — including mid-sentence while the voice is streaming.
- **Notes still show normally.** A genuine parenthetical with a colon — 「（注：周一照常）」 — is treated as content, shown and spoken as usual.

The point: this is decided by the *shape* of what she writes, so a brand-new expression on someone else's screen is handled the same way, without anyone adding it to a list.

## Under the hood

- Replaced the recognised-keyword gate for stripping stage directions with a shape rule (a colon marks structured content; everything else short and bracketed is an aside). Added a streaming-TTS twin so the voice never speaks an aside even mid-stream, and dropped the now-orphaned silent/generic keyword tables.

## Known issues

- **Live bridge + real-machine validation still pending** (carried from the earlier betas): the messaging and awareness flows are covered by protocol and unit tests, but real-network behaviour and the Full Disk Access grant flow need a real machine — that's what this validation window is for.
- The muted styling for an unrecognised aside only appears for the rare asides we don't recognise; most expressions are invisible (they drive her face). Worth an eyeball during validation.
- Emotion changes are deliberately invisible (no dashboard, by design) — you feel them in her replies over days of use, not in a panel.
- Desktop message awareness is macOS-only; the Windows adapter remains an external script.
- Local TTS outputs WAV, so Telegram voice-note replies still need a cloud TTS provider (mp3/ogg/m4a). Discord inbound voice isn't transcribed yet (Telegram only).
- Carried over: Screen Recording permission quirks on the unsigned macOS build.

## Notes & limitations

- **Unsigned distribution (macOS arm64).** First launch needs the usual right-click → Open; granting Microphone / Screen Recording / Full Disk Access follows the in-app prompts. Unchanged in `v0.3.4`.
- This is a **pre-release**: download manually from GitHub Releases for validation. Stable users are not auto-upgraded.
