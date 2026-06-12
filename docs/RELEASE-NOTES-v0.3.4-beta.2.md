# Nexus v0.3.4-beta.2

> **Beta — the companion notices all your messages.** Second beta of the `v0.3.4` line, on top of `v0.3.4-beta.1`. The headline: **desktop-wide message awareness** — Nexus now reads the macOS Notification Center so your companion knows when WeChat, QQ, mail or any other app gets a message, behind a single settings toggle. Plus pairing codes that replace hand-typed allowlist IDs, MiniMax Token Plan web search, region tabs in the settings model picker, and ~2,100 lines of dead code removed. As a pre-release it is for manual validation only; stable users are not auto-upgraded.

## What changes for users

### Desktop message awareness (macOS) — new

- **Your companion now notices messages from every app.** Enable it under Settings → Autonomy → Notifications → "Desktop message awareness": Nexus reads the system Notification Center history, so a WeChat/QQ/DingTalk/mail banner becomes something the companion knows about — announce (optional), inbox, and **into the conversation** so she can react ("张三在微信找你了").
- **One toggle replaces the manual adapter script.** This previously required running an external node script by hand; it now runs inside the app. Requires granting Nexus **Full Disk Access** (the card shows a "needs permission" status with a one-click jump to System Settings while the grant is missing). Enabling never replays old notifications.
- **Privacy follows the existing model**: by default the companion only learns *source + sender* (「微信 · 张三 发来了新消息」); message content is included only with the existing read-content opt-in. Ten rapid pings from one conversation become a single companion reaction, not ten.
- **Source filter**: choose which apps count as messengers (keyword field; empty uses the built-in list covering WeChat/QQ/WeCom/DingTalk/Feishu/Telegram/Discord/Slack/Teams).
- Honest scope: this reads what apps put in **notification banners** — muted chats, apps with notifications off, and content hidden by your notification-preview settings stay invisible. It also cannot reply back to those apps (replies remain a Telegram/Discord bridge capability).

### Messaging bridge

- **Pairing codes replace hand-typed IDs.** With the deny-by-default allowlist, allowing even yourself meant digging up a numeric chat ID. Now: message the bot once → it replies with a one-time 6-digit code (1 h expiry, max 3 pending, repeats silent) → approve the request in Settings → Integrations. Approving a Telegram private chat also marks it as the owner; group chats and Discord channels enter the allowlist only.
- **Reminder broadcasts hardened**: scheduled reminders now go only to *your own* chats (owner Telegram chats + allowlisted Discord channels) and pass the same permission gate as every other send — previously they went to every remembered sender with no check.

### Search & setup

- **MiniMax web search**: 9th search provider — the same MiniMax Token Plan key you may already use for chat doubles as a search key (ordinary model keys are not accepted by MiniMax's search endpoint). CN endpoint by default, base-URL override for global.
- **Region tabs in the settings model picker**: the provider grid now filters by 国内 / 海外 / 本地, and a cross-region brand (MiniMax/Moonshot/Qwen/SiliconFlow) selects the right regional variant depending on which tab you click it from. Matches the onboarding picker from the previous beta.

## Under the hood

- **~2,100 lines removed**: 303 unused translation keys deleted across all five locales (detection guarded against dynamically-built keys).
- The optimization roadmap (`docs/EXECUTABLE_OPTIMIZATION_TASKS.md`) reconciled with shipped reality.

## Known issues

- **Live bridge validation is still pending** (carried from beta.1) — the Telegram/Discord reply loop and the new awareness flow are covered by protocol-level and unit tests, but real-network/real-grant behaviour is what this beta's validation window is for. The Full Disk Access grant flow in particular needs a real machine.
- Local TTS outputs WAV, so Telegram voice-note replies still require a cloud TTS provider (mp3/ogg/m4a).
- Discord inbound voice messages are not transcribed yet (Telegram only).
- Desktop message awareness is macOS-only in this beta (Windows adapter still available as an external script).
- Carried over: Screen Recording permission quirks on the unsigned macOS build; a small tail of dead exports pending cleanup.

## Notes & limitations

- **Unsigned distribution (macOS arm64).** First launch needs the usual right-click → Open; granting Microphone / Screen Recording / Full Disk Access follows the in-app prompts. Unchanged in `v0.3.4`.
- This is a **pre-release**: download manually from GitHub Releases for validation. Stable users are not auto-upgraded.
