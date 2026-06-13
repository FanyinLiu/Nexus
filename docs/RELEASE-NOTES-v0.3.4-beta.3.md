# Nexus v0.3.4-beta.3

> **Beta — the companion's emotions finally drive her, not just describe her.** Third beta of the `v0.3.4` line, on top of `v0.3.4-beta.2`. The headline is a four-step deepening of the emotion engine: she now reads how *you* feel from the whole conversation, her own mood is shaped by genuine events (a failed reply, a long absence, your low days), and that mood actually changes how — and whether — she reaches out. Plus the Live2D character is now the default face, message awareness collapses to one toggle, and a gentle follow-up on messages you missed while away. As a pre-release it is for manual validation only; stable users are not auto-upgraded.

## What changes for users

### The companion feels more like a person

This release closes the emotion loop end to end — perception → her inner state → her tone **and behaviour**. None of it is a dial you set; it just happens, quietly.

- **She reads how you feel.** Using the whole conversation (not keyword matching), she now picks up on moods that have no obvious keyword — 「我今天被裁了」 carries no "sad" word, but she'll notice. This shapes her tone and, over time, how she checks in.
- **Her mood is shaped by real events.** A failed reply leaves her a little concerned. A long stretch of you being away — she starts to miss you, and there's a genuine warm lift when you come back. Your stretch of low days softens her (more warmth, more care). These were defined long ago but never actually fired until now.
- **Her mood changes what she does.** When she's worried she leans toward a gentle check-in; when she's tired she'd rather stay quiet; when she's bright she might share something playful. This never overrides quiet hours, away/locked, or cost limits — it only colours the moments that were already going to happen. She never gets chatty just because her mood is good.
- **Her warmth follows the relationship.** The same feeling shows more reservedly while you're still getting to know each other, more openly once you're close.

### Avatar

- **The Live2D character (星绘) is now the default face.** Her soul and her model finally match out of the box. The lightweight sprite pets (Pip and friends) remain a fully-supported option in the picker — they're just no longer the default. (Fresh installs only; if you already chose a pet, your choice is kept.)

### Desktop message awareness

- **One toggle now.** Turning on "Desktop message awareness" (macOS) auto-enables the notifications it depends on — so it's a single flip plus the (Apple-mandated) Full Disk Access grant, nothing else to configure.
- **She follows up on what you missed.** A message that arrived while you were away can surface, gently, in your next conversation — 「下午张三在微信找过你，后来处理了吗？」 Asks, never assumes (she can't see whether you replied in the other app); once per conversation, at most twice a day, and silent if it would feel forced.

## Under the hood

- A never-wired pair of agent tool definitions removed (dead scaffolding, no behaviour change).

## Known issues

- **Live bridge + real-machine validation still pending** (carried from the earlier betas): the messaging and awareness flows are covered by protocol and unit tests, but real-network behaviour and the Full Disk Access grant flow need a real machine — that's what this validation window is for.
- Emotion changes are deliberately invisible (no dashboard, by design) — you feel them in her replies over days of use, not in a panel.
- Desktop message awareness is macOS-only; the Windows adapter remains an external script.
- Local TTS outputs WAV, so Telegram voice-note replies still need a cloud TTS provider (mp3/ogg/m4a). Discord inbound voice isn't transcribed yet (Telegram only).
- Carried over: Screen Recording permission quirks on the unsigned macOS build.

## Notes & limitations

- **Unsigned distribution (macOS arm64).** First launch needs the usual right-click → Open; granting Microphone / Screen Recording / Full Disk Access follows the in-app prompts. Unchanged in `v0.3.4`.
- This is a **pre-release**: download manually from GitHub Releases for validation. Stable users are not auto-upgraded.
