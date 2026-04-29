# Nexus Roadmap — post-v0.3.1

> Last updated 2026-04-28, after v0.3.1 stable.

## Posture

**Polish phase, six months, no commercialisation.**

Nexus is a personal-use desktop companion that happens to be open-source.
There is no "winning the market" story to attach to the next six months —
the goal is straightforwardly to make the existing surface more reliable,
keep it shippable as the regulatory floor rises, and clean up structural
debt accumulated through five betas. No new feature lines.

This roadmap is short on purpose. If something belongs on it that isn't
listed, add it; if something below stops mattering, delete it. Don't grow
this file to feel productive.

## Tier 1 — Compliance & distribution (must-do)

These two items keep Nexus shippable through the end of 2026.

### 1.1 Crisis-response + AI-disclosure layer

California **SB 243** (effective 2026-01-01) and New York's companion
safeguards law require: (a) self-harm / suicidal-ideation detection +
crisis-resource referral; (b) periodic "you are talking to AI" reminders;
(c) minor-safety posture. EU AI Act serious-incident reporting takes
effect August 2026 — even an unsigned binary used by EU/CA residents
counts as "deployed."

**Scope:**
- Detection: pattern + LLM-tagged classification of crisis utterances.
- Response path: **hybrid** — companion stays in character with a
  reframed empathic message, and a separate non-persona hotline panel
  slides in over the conversation. Legally the panel is "non-AI
  resource clearly displayed"; emotionally the relationship continuity
  is preserved (decided 2026-04-28; Klein chose the hybrid over either
  full break-character or full in-character).
- Hotline catalogue keyed by `i18n.locale` (verified 2026-04-28; see
  `src/features/safety/hotlines.ts` for sourceUrls):
  988 (en-US, 24/7 call+text), 12356 / 800-810-1117 (zh-CN, the
  former is the new national unified line opened 2025-01),
  1925 (zh-TW 24/7 安心專線), 0120-279-338 よりそいホットライン
  (ja, 24/7 free), 109 (ko, unified 2024-01 from 1393 / 1577-0199),
  116 123 Samaritans (en-EU fallback).
- Disclosure: periodic in-conversation reminder + onboarding consent.
- Documentation in README so a regulator can locate the path.

Estimate: 2-3 weeks. **Highest priority** — has a hard August deadline.

### 1.2 Code signing + notarisation — **deferred**

**Decision 2026-04-28:** Not signing. Klein declined the ~$220/year
recurring cost (Apple Developer ~$99 + Azure Trusted Signing ~$120).
"No commercialisation" extends to "no recurring infra spend right now."

This is reversible — if a future month brings a strong reason (mass
adoption, EU enforcement actually citing unsigned distribution), revisit.
Until then:

**What we do instead — improve the unsigned-install path:**
- README per locale: clear "first-launch warning is expected, here's
  why and how to bypass" section (xattr -dr on macOS, SmartScreen
  "More info → Run anyway" on Windows). Currently buried.
- Linux: add detached GPG signature + SHA-256 alongside AppImage / deb.
  This is free and orthogonal to platform code-signing.
- Release notes: keep the install workaround visible at the top.

Estimate: ~1 day for docs + GPG, no recurring cost.

## Tier 2 — Quality polish (worth doing while around)

### 2.1 Self-tuning thresholds for M1.4-1.7

The silent guidance telemetry + weekly analyzer (`guidanceAnalysis.ts`)
already records every fire and computes per-kind valence-delta over a
24h pre/post window. The next step is to *consume* the report and
auto-tune the M1.4-1.7 threshold constants toward whatever combination
correlates with post-fire valence lift on Klein's actual use data.

**Scope:**
- `src/features/autonomy/affectTuning.ts` — read latest analysis report,
  produce a candidate threshold tweak with confidence bound.
- Apply only when `pairedFires ≥ 30` and confidence ≥ 0.7.
- Persist to localStorage; classifier reads at injection time.
- Stays silent: no UI, no notification.

**Escape hatch (decided 2026-04-28):** No "reset emotional tuning"
button (would violate the silent-emotion principle — user is recipient,
not debugger). Instead:
- **14-day decay**: every two weeks the persisted tuned threshold is
  re-blended toward the factory default by 5% weight. A wrongly-tuned
  state self-corrects to mid-zone within ~6 months without any user
  action.
- **Hidden hard reset**: piggyback on the existing onboarding-redo flow
  — when the user re-runs onboarding, clear the guidance telemetry +
  tuned thresholds. Not surfaced in settings, not in user docs.

Estimate: 3-4 days for the tuner + decay; another 0.5 day to wire the
onboarding-redo telemetry clear.

### 2.2 TTS engine upgrade — local low-latency

Q1-Q2 2026 reset the local-TTS bar:
- **Voxtral** (Mistral, March 2026, 4B open-weight, 70ms first-frame
  latency, RTF 9.7×, multilingual)
- **Kyutai Pocket TTS** (January 2026, 100M params, CPU real-time)

Either replaces the current Sherpa pipeline with a 5-10× lower-latency
local option.

**Scope:**
- Probe both for license / size / latency on the project's reference
  hardware.
- Wire as new `tts.providerId = 'voxtral-local' | 'kyutai-local'`;
  keep Sherpa as fallback.
- Update model-download script + asar-unpack patterns.

**Rollout cadence (decided 2026-04-28):**
- **v0.3.2** — new engine ships, settings toggle present, default OFF.
  Existing users keep Sherpa.
- **v0.3.3** — release notes announce "next patch will flip the default"
  and link the toggle. Two-week soak window.
- **v0.3.4** — flip default to the new engine. Toggle stays so anyone
  unhappy with the change can revert.

Voice is core sensory continuity for the companion — no overnight
default change.

Estimate: 1-2 weeks for the engine; rollout spans three patch versions.

### 2.3 Minimal MCP client

Open-LLM-VTuber and SillyTavern both speak MCP now; it's becoming the
standard way to give a chat companion access to tools. Nexus has an MCP
host stub and approval gate but doesn't actually consume MCP servers
beyond the bare host.

**Scope:**
- Renderer-side MCP client that connects to a stdio or HTTP server given
  a config file path.
- Surface available tools alongside built-in tools in the prompt.
- Keep the per-tool approval gate from the v0.3.0 audit (M2).

Estimate: 1 week.

## Tier 3 — Structural debt (opportunistic)

### 3.1 readJson<T> migration

`readJsonValidated` helper landed in v0.3.1; ~30 storage consumers still
cast through `readJson<T>`. Migrate when touching a store for other
reasons.

### 3.2 Voice-runtime test coverage

`src/features/voice/runtimeSupport.ts` covers at 21.72%. Largest
untested surface in the project. A focused property-based test pass on
the state machine + lifecycle calls would catch the kind of bug beta.3
shipped (TTS state wedge).

### 3.3 Bundle dieting

`app-runtime` is 1.45 MB (gzip 444 KB). `transformers-vendor` is 868 KB
unconditionally bundled even for users on remote LLM only. Lazy-loading
local-model paths gates ~250 KB gzip off first paint.

## Explicitly NOT planning

Listed so future contributors don't pile feature work onto a polish
phase.

- New narrative-ritual features (Listen Mode, multi-day Arc deepening,
  yearbook variants, etc. were considered and explicitly held).
- Group / multi-character rooms.
- VRM / 3D pipeline.
- NSFW / dating-sim mechanics.
- Subscription / paid tier.
- Cloud sync / account system.
- Memory legibility UI ("what I remember about you" panel) — would mean
  re-mounting the letters / capsule / arc / mood-map UIs Klein
  intentionally pulled from the drawer in v0.3.1.

## Decisions log

All four open questions resolved 2026-04-28:

1. **Code signing** — deferred indefinitely. No $220/year right now.
   Improve the unsigned-install README + add Linux GPG signatures
   instead. Reversible if reasons change. (See 1.2.)
2. **Crisis-response tone** — hybrid. Persona stays in character with an
   empathic reframing; a separate hotline panel slides over the
   conversation. (See 1.1.)
3. **TTS default flip** — three-version rollout. v0.3.2 opt-in →
   v0.3.3 announce → v0.3.4 flip default. Toggle stays for opt-out.
   (See 2.2.)
4. **Self-tune escape hatch** — no settings button. 14-day decay toward
   factory defaults at 5%/cycle for slow self-correction; piggyback
   onboarding-redo for hard reset. (See 2.1.)
