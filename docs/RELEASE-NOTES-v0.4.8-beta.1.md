# Nexus v0.4.8-beta.1 — October 2026 catalog follow-up

**Status: Prepared beta candidate. No tag and no GitHub Release yet.**
v0.4.7 remains the current public stable release. The README stable entry
stays on v0.4.7. This document does not publish the beta.

The candidate carries the October 2026 provider catalog that landed in #139,
then removes `MiniMax-M2.7` before its 2026-11-18 retirement and points the
custom OpenAI-compatible speech-to-text default at OpenAI's current file
transcription model. #137 and #133 are included.

## What Changed

### Provider catalog (#139)

Settings schema is v10, with migrations v8 through v10 already on `main`.

- v8 promotes a stored model only when it still equals the previous catalog
  default, and pins a missing MiniMax provider id before that rewrite so a
  bare Token Plan `MiniMax-M3` stays on the coding preset.
- v9 rewrites stored ids that left the official lists, including OpenAI
  `gpt-5.6-sol` → `gpt-6-sol`.
- v10 promotes only a stored SiliconFlow, NVIDIA, or MiniMax PAYG model that
  still equals the previous default. PAYG `MiniMax-M2.7` becomes `MiniMax-M3`.
  An explicit Token Plan selection of `MiniMax-M2.7` is not rewritten by v10.

Current defaults from that refresh include OpenAI `gpt-6-sol`, Anthropic
`claude-sonnet-5-5`, Gemini `gemini-3.8-flash`, xAI `grok-4.7`, DeepSeek
`deepseek-flash`, Kimi `kimi-k3`, MiniMax PAYG `MiniMax-M3`, MiniMax Token
Plan `MiniMax-M3.1-Flash-Preview`, Qwen `qwen3.8-max`, and GLM `glm-5.3`.
SiliconFlow and NVIDIA defaults are the DeepSeek V4.1 Flash ids those
providers publish.

### MiniMax-M2.7 retirement

`MiniMax-M2.7` is removed from the MiniMax PAYG and Token Plan pickers.
`MiniMax-M2.7-highspeed` and `MiniMax-M2.5` stay listed.

Schema v11 rewrites every stored `MiniMax-M2.7`:

- PAYG (`minimax`, `minimax-global`) → `MiniMax-M3`. A store with no provider
  id is pinned to PAYG first, so the new `MiniMax-M3` value is not read as
  the Token Plan.
- Token Plan (`minimax-coding`, `minimax-coding-global`) →
  `MiniMax-M3.1-Flash-Preview`.

### Custom OpenAI-compatible STT

`custom-openai-stt` now defaults to `gpt-transcribe`. OpenAI's transcription
guide recommends that model for completed audio files. `gpt-4o-mini-transcribe`
is deprecated and scheduled to shut down on 2027-02-26.

Schema v11 moves a stored `custom-openai-stt` model only when it is still
exactly `gpt-4o-mini-transcribe`. A model name typed for a private proxy is
left alone. The official `openai-stt` picker still lists the deprecated ids
for existing integrations; v8 already moved its previous default.

### First-use setup (#137)

- In Electron, a pending first-use guide opens in the panel. Only that window
  can use the settings vault. The handoff does not carry a settings draft and
  does not mark onboarding complete.
- Settings can reopen the onboarding guide.
- A failed model save shows an error notice.
- CI runs the first-use smoke for setup chat and restart.

### Stable release link (#133)

- Onboarding message-action demo styles are restored.
- The distribution audit checks the introductory stable declaration in each
  README. The package may be `v0.4.8-beta.1` while that declaration stays on
  v0.4.7 and links the stable notes.

## Known issues

- No cross-platform physical-device evidence is claimed.

## Beta validation boundary

The owner tags `v0.4.8-beta.1` only after this commit is on `main`, CI is
green on that commit, and `npm run prerelease-check -- v0.4.8-beta.1` passes.
The protected tag workflow publishes the pre-release. Do not run
`gh release create` by hand, and do not switch the README stable entry from
v0.4.7 until a later stable promotion.

## macOS unsigned auto-update limitation

The macOS arm64 build is ad-hoc signed, not Apple Developer ID signed or
notarized. Gatekeeper may require right-click → Open or
`xattr -dr com.apple.quarantine /Applications/Nexus.app`. The app opens the
official release page; users manually download and replace the app.

## Windows unsigned installer limitation

The Windows x64 installer is `NotSigned`. SmartScreen may show an
unknown-publisher warning. Bypassing that warning is not a security guarantee;
use only the official GitHub Release and verify its published SHA-256 checksum.
