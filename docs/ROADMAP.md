# Nexus Roadmap — post-v0.3.1

> Last updated 2026-04-28, after v0.3.1 stable. This file is the
> source of truth for "what's next." It supersedes prior roadmap notes
> embedded in commit messages, release notes, and memory files.

## Posture

**Polish phase, six months, no commercialisation.** v0.3.1 shipped the
emotion-line work that's been the main thread since beta.3 (M1.1 affect
timeline → M1.4-1.7 reply shaping → silent self-summarisation analyzer).
That layer is the product's moat. The next six months are about hardening
the platform around it — not piling on new surface area.

This roadmap is informed by an April-2026 competitive scan. Eight peers
were surveyed (Open-LLM-VTuber, AIRI, Soul of Waifu, Utsuwa, Nomi,
Kindroid, Replika, Character.AI). Nexus is alone in shipping
psychology-grounded reply shaping (Russell circumplex × Kuppens dynamics
× Trull EMA × Mikulincer secure-attachment × Gottman repair). Every
roadmap item below either hardens that moat or fixes structural gaps that
let larger / better-funded competitors pull ahead on commodity axes
(voice, tools, distribution).

## Tier 1 — Compliance & distribution (must-do; legal/safety floor)

These items keep Nexus shippable in the regulatory environment that
takes effect during the polish window.

### 1.1 Crisis-response + AI-disclosure layer

California **SB 243** (effective 2026-01-01) and New York's companion
safeguards law require: (a) self-harm/suicidal-ideation detection +
crisis resource referral; (b) periodic "you are talking to AI"
reminders; (c) minor-safety posture. EU AI Act serious-incident
reporting kicks in August 2026; even a sideloaded hobby binary used in
EU/CA reads as "deployed."

**Scope:**
- Detection: pattern + LLM-tagged classification of crisis utterances.
- Response path: graceful refusal + locale-appropriate hotline/resource
  list (988 US, 116-123 EU, 13-11-14 AU, 1393 CN, 0570-064-556 JP).
- Disclosure: periodic in-conversation reminder ("just so you remember,
  I'm an AI") and onboarding-time consent to the same.
- Documentation in README.md / RELEASE-NOTES so a regulator can locate
  the path.

**Priority:** Highest. Regulatory exposure is real even for an unsigned
GitHub binary. Estimate: 2-3 weeks.

### 1.2 Code signing + notarisation

Currently every release ships unsigned with `xattr -dr` and SmartScreen
workarounds in the notes. That bar is fine for power users but locks
out the "I just want to install this" audience.

**Scope:**
- macOS: `notarytool` (replacing dead `altool`); Apple Developer
  programme membership + entitlements review.
- Windows: **Azure Trusted Signing** (~$10/mo; GA, accepts self-employed
  individuals in US/CA/EU/UK as of 2026). EV certs no longer bypass
  SmartScreen first-download — Trusted Signing is the recommended path.
- Linux: detached GPG signature + SHA-256 alongside AppImage / deb.

**Priority:** High once Tier 1.1 is done. The two together are the
"shippable to non-technical users" milestone. Estimate: 1-2 weeks
real-time, gated on Apple Developer enrolment.

## Tier 2 — Hardening the moat (visible to felt experience, not to UI)

### 2.1 Self-tuning thresholds for M1.4-1.7

The silent guidance telemetry + weekly analyzer (`guidanceAnalysis.ts`)
already records every fire and computes per-kind valence-delta over a
24h pre/post window. The next step is to *consume* that report:
auto-tune the M1.4-1.7 threshold constants (e.g. stuck-low's `< -0.2`
baseline + `≥ 0.4` inertia) toward whatever combination correlates with
post-fire valence lift on each user's actual data.

**Scope:**
- `src/features/autonomy/affectTuning.ts` — read latest analysis report,
  produce a candidate threshold tweak with a confidence bound.
- Apply only when `pairedFires ≥ 30` and confidence ≥ 0.7; otherwise
  defer.
- Persist tuned thresholds to localStorage; the classifier reads them at
  injection time.
- **Stays silent:** no UI surface, no notification of "we adjusted your
  thresholds." The user just experiences a companion that gets better
  fit over time.

**Priority:** High — this is the silent-inference half of the contract
that landed in v0.3.1.

### 2.2 TTS engine upgrade — local-first low-latency

Q1-Q2 2026 reset the local-TTS bar:
- **Voxtral** (Mistral, March 2026, 4B open-weight, 70ms first-frame
  latency, RTF 9.7×, multilingual)
- **Kyutai Pocket TTS** (January 2026, 100M params, CPU real-time)

Either replaces the current Sherpa pipeline with a 5-10× lower-latency
local option, no new dependency on cloud TTS providers.

**Scope:**
- Probe both models for license + model-size + latency on the project's
  reference Mac (M-series) and Win (RTX 3060) hardware.
- Wire as a new `tts.providerId = 'voxtral-local' | 'kyutai-local'`
  alongside existing options; keep Sherpa as fallback.
- Update model-download script + asar-unpack patterns.

**Priority:** Medium. Quality-of-life, not safety.

### 2.3 Minimal MCP client

`Open-LLM-VTuber` adopted MCP early; SillyTavern's 2026 cards already
leverage tool-calls. MCP is becoming the lingua franca of "give the
companion tools." Nexus already has built-in tools (web search,
weather) and an MCP host stub but doesn't actually consume MCP servers
beyond the bare host.

**Scope:**
- Renderer-side MCP client that can connect to a stdio or HTTP MCP
  server given a config file path.
- Surface available tools in the chat-prompt builder alongside
  built-in tools.
- Keep the per-tool approval gate from the v0.3.0 audit (M2).

**Priority:** Medium. Stays consistent with "user is in control" —
each new MCP tool requires explicit approval.

## Tier 3 — Structural debt to address while polishing

### 3.1 readJson<T> migration

`readJsonValidated` helper landed in v0.3.1 but the existing ~30
storage consumers still cast through `readJson<T>`. One-by-one
migration to validators would close the remaining "corrupt blob
crashes downstream walker" risk surfaced in the audit.

**Priority:** Low; opportunistic. Migrate when touching a store for
other reasons.

### 3.2 Voice-runtime test coverage

`src/features/voice/runtimeSupport.ts` covers at 21.72%
(per `--experimental-test-coverage`). It's the largest untested
surface in the project. A focused property-based test pass on the
state machine + lifecycle calls would catch the kind of bug that
beta.3 shipped (TTS state wedge).

**Priority:** Low; opportunistic.

### 3.3 Bundle dieting

`app-runtime` is 1.45 MB (gzip 444 KB). `transformers-vendor` is 868 KB
unconditionally bundled, even for users on remote LLM only. Splitting
local-model paths into a lazy-loaded chunk gates ~250 KB gzip off the
first paint.

**Priority:** Low; cosmetic.

## Explicitly NOT planning

These would either dilute the moat or contradict an established Klein
principle. Listed so future contributors understand the negative space.

| Not doing | Why |
|---|---|
| Group / multi-character rooms (Nomi's USP) | Conflicts with the one-persistent-companion identity Nexus has built around relationship-tracking + dream-cycle. |
| VRM / 3D pipeline (AIRI, Utsuwa, Soul of Waifu) | Doubles avatar scope; Live2D is already differentiating. The Russell/Kuppens/Gottman work is the moat, not polygons. |
| NSFW / dating-sim mechanics | Regulatory exposure under SB 243 / NY laws + dilutes the calm tone Nexus optimises for. |
| Memory legibility UI ("what I remember about you" panel) | Klein principle (`feedback_nexus_silent_emotion`): emotional adaptation is felt, not configured. Reviewer-driven trend on competitors says the opposite — Nexus deliberately differentiates by NOT showing the strings. |
| Subscription / paid tier / commercialisation | Klein stance: six months of polish, no commercialisation. |
| Cloud sync / account system | Local-first is the marketing position; introducing accounts breaks the trust contract. |

## Open questions for Klein

These need explicit decisions before they can be acted on:

1. **Crisis-response language tone.** The locale-appropriate hotline
   list is mechanical, but the *companion's* response when she detects a
   crisis utterance — does she break character ("I'm worried about you,
   please reach out to..."), or stay in character with the resource
   embedded? The first is safer; the second is the artifact-craft
   position.
2. **Code-signing budget.** Apple Developer Programme is $99/year;
   Azure Trusted Signing ~$120/year. If "no commercialisation" means
   "no recurring costs," this is a hard stop.
3. **Default TTS swap timing.** Voxtral / Kyutai are good but switching
   the default is a behavioural change for existing users. Opt-in flag
   for two betas, then flip default? Or never flip, just expose?
4. **Self-tuning's escape hatch.** If the auto-tuner converges on a
   threshold that feels wrong to the user, how do they reset? A hidden
   "reset to defaults" button is fine, but should there be a more
   visible safety valve?

## Reference

- Competitive scan dated 2026-04-28 (this session's research output).
- Sources: Open-LLM-VTuber, AIRI, Soul of Waifu, Utsuwa, Nomi AI 2026
  reviews, Kindroid 2026 reviews, Character.AI lawsuit landscape, CA
  SB 243, NY companion safeguards, EU AI Act, Voxtral, Kyutai Pocket
  TTS, REMT (Frontiers in AI 2026 memory paper).
