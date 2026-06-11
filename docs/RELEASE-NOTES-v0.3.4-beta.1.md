# Nexus v0.3.4-beta.1

> **Beta — the messaging bridge actually talks back.** First beta of the `v0.3.4` line on top of `v0.3.3`. The headline: the Telegram/Discord bridge finally closes the loop — your companion now **replies back to the chat you messaged it from**, optionally as a voice note, and Telegram voice messages get transcribed into the conversation. Plus a free fully-offline TTS option, a security pass on the messaging surface, and first-run onboarding polish. As a pre-release it is for manual validation only; stable users are not auto-upgraded.

## What changes for users

### Messaging bridge (Telegram / Discord)

- **The companion replies back.** Message your companion from Telegram or Discord and the reply now routes back to that same chat/channel automatically — previously the bridge was receive-only and answers appeared only on the desktop. Replies go **only to your own (owner) messages**, never to other contacts, so nobody can use your companion as a relay. A new per-gateway toggle controls this (on by default; `read-only` permission mode still blocks all sending).
- **Voice replies.** Optionally have replies arrive as a TTS voice note: Telegram gets a real voice bubble (with mp3/ogg/m4a-capable TTS providers), Discord gets a playable audio attachment. Three modes: **off / always / only-when-they-sent-voice** (the last one mirrors your modality — speak to it and it speaks back, type and it types).
- **Telegram voice messages are understood.** Incoming voice notes are downloaded and transcribed with your configured cloud speech-recognition provider, then reach the companion like any text message. Without an API STT configured they fall back to the old announce-only behaviour. Media messages (photos/stickers/voice/…) are also announced now instead of being silently dropped.
- **No more silently lost messages.** Bridge messages that used to vanish when the assistant was mid-reply are now queued and retried; a Telegram reconnect no longer replays the previous message batch; and the panel's manual reply box no longer pretends a failed send succeeded.
- **Allowlist is now deny-by-default.** An empty allowed-IDs list used to accept *everyone* — bot usernames are publicly searchable, so a freshly configured bridge was open to strangers. It now accepts nobody until you add your chat/channel IDs. **Action needed: if your bridge worked with an empty allowlist, add your IDs in Settings → Integrations.**
- `NEXUS_TELEGRAM_API_BASE` environment variable for routing Bot API traffic through a reverse proxy where api.telegram.org is unreachable.

### Voice

- **Free offline text-to-speech.** New "Local TTS" speech-output provider (MeloTTS, bilingual zh/en) running fully offline through the bundled sherpa-onnx runtime — no API key, no per-character billing. Download the ~165 MB model in Settings → Local Models before first use. Note: its WAV output means Telegram voice bubbles fall back to text-only; desktop playback and Discord attachments work fully.

### First-run setup

- **Provider region tabs.** The first-run model picker now filters providers by 国内 / 海外 / 本地 segments (defaults to your UI language's region; the selected provider stays pinned across tabs), with first-success providers ordered up top.
- **Friendlier chat errors.** A failed chat send now shows actionable, localized advice ("check the API key in Settings → Model") instead of raw provider/network errors; secrets and file paths are scrubbed from anything user-visible.

## Security

- **Webhook hardening.** The local notification webhook (127.0.0.1) now uses constant-time token comparison, rate-limits failed auth attempts (no localhost exemption — browser pages can reach 127.0.0.1 too), and no longer sends CORS headers, so web-page JavaScript can't talk to it at all.
- Honest copy: FEATURES/READMEs no longer promise "bidirectional messaging" beyond what ships; the docs now describe exactly what the bridge does.

## Under the hood

- Protocol-level integration tests for the Telegram gateway against a mock Bot API server (long-poll, offset bookkeeping, multipart voice upload, allowlist, reconnect semantics); the gateway no longer requires an Electron runtime to load.
- Research docs added under `docs/`: bridge survey + upgrade plan, auto-update survey, OpenClaw/Hermes comparison, competitor landscape.

## Known issues

- **The bridge has not been validated against live Telegram/Discord servers yet** — protocol behaviour is covered by the mock-server suite, but real-network behaviour (TLS, proxies, Telegram-side validation, STT quality on real voice notes) is exactly what this beta's validation window is for.
- Local TTS outputs WAV, so Telegram voice-note replies require a cloud TTS provider (mp3/ogg/m4a) for now.
- Discord inbound voice messages are not transcribed yet (Telegram only).
- Carried over from v0.3.3: Screen Recording permission quirks on the unsigned macOS build; ~291 unused i18n keys pending cleanup.

## Notes & limitations

- **Unsigned distribution (macOS arm64).** First launch needs the usual right-click → Open; granting Microphone / Screen Recording follows the in-app prompts. Unchanged in `v0.3.4`.
- This is a **pre-release**: download manually from GitHub Releases for validation. Stable users are not auto-upgraded.
