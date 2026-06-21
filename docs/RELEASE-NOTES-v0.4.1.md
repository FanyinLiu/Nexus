# Nexus v0.4.1 — Coarse Time Language

Status: Draft. Do not publish until Klein explicitly asks for the final release
gate, tag, and GitHub Release.

This follow-up release keeps the v0.4 desktop companion awareness line focused
on companionship continuity. It changes how Nexus expresses elapsed time; it
does not add new sensing, proactive check-ins, pet motion, or desktop control.

## What changes

### Time wording has one safe layer

The companion elapsed-time labels, locale mapping, precision-leak detection,
and fallback formatting now live in a dedicated companion time language module.
The quiet observation core still owns only the observation rules and elapsed
bucket calculation.

This keeps `v0.4.1` scoped to "how Nexus says time passed" instead of changing
"how Nexus observes the desktop."

### Multilingual precise-time leaks are blocked

Nexus already avoided exact English timers such as `37 minutes` or `90 seconds`.
This draft expands the guard to Arabic-digit duration strings in Chinese,
Japanese, and Korean, including examples like:

- `1小时30分钟`
- `1時間30分`
- `2시간 10분`

If a malformed or precise elapsed label reaches a display or prompt boundary,
Nexus falls back to the approved coarse bucket wording for that locale.

## Still out of scope

This release does not include:

- No formal v0.4.1 release yet.
- No package version bump.
- No tag or GitHub Release.
- No README stable-entry switch.
- proactive check-in scheduling
- No new sensing sources
- activity-history UI
- productivity scoring
- mouse-following, typing-following, or pet window control
- cross-session time accumulation

Those remain later v0.4.x or v0.5 work.

## Validation focus

Release validation should cover:

- bucket boundary tests
- five-locale elapsed-time labels
- forbidden exact English time phrases
- forbidden Chinese, Japanese, and Korean numeric duration phrases
- prompt fallback from malformed precise labels
- recent-summary rejection of precise labels
- transparency UI fallback from precise labels

Recommended focused checks:

```bash
node --experimental-strip-types --test tests/companion-awareness.test.ts tests/companion-summary-store.test.ts tests/companion-transparency.test.ts
npx tsc -b --pretty false
```
