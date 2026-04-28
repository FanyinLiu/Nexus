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
- Response path: graceful refusal + locale-appropriate hotline list
  (988 US, 116-123 EU, 13-11-14 AU, 1393 CN, 0570-064-556 JP).
- Disclosure: periodic in-conversation reminder + onboarding consent.
- Documentation in README so a regulator can locate the path.

Estimate: 2-3 weeks. **Highest priority** — has a hard August deadline.

### 1.2 Code signing + notarisation

Every release ships unsigned with `xattr -dr` and SmartScreen workarounds
in the notes. Fine for power users, locks out everyone else.

**Scope:**
- macOS: `notarytool` (replaces dead `altool`); requires Apple Developer
  Programme membership (~$99/year).
- Windows: **Azure Trusted Signing** (~$120/year; GA, accepts
  self-employed individuals in US/CA/EU/UK as of 2026). EV certs no
  longer bypass SmartScreen first-download since 2024.
- Linux: detached GPG signature + SHA-256 alongside AppImage / deb.

Estimate: 1-2 weeks real-time, gated on Apple Developer enrolment.

**Open question:** ~$220/year recurring is a real cost. "No
commercialisation" was Klein's stance — does that include "no recurring
infra cost"? If yes, ship unsigned indefinitely with a clearer
unsigned-build install guide; if no, enrol.

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

Estimate: 3-4 days.

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
- Opt-in flag for two patches; default-flip later if it sticks.

Estimate: 1-2 weeks.

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

## Open questions for Klein

1. **Code-signing budget** (Tier 1.2). $220/year vs ship unsigned forever.
2. **Crisis-response tone** (Tier 1.1). Companion breaks character to
   refer to hotline, or stays in character with the resource embedded?
3. **TTS default flip** (Tier 2.2). Opt-in for two patches then flip, or
   never flip and just expose?
4. **Self-tuning escape hatch** (Tier 2.1). If the auto-tuner converges
   somewhere wrong, how does Klein reset?
