# Milestone 6 Slice 3 — Stage Direction Avatar Bridge

## Problem

Nexus already treats Chinese full-width stage directions such as `（眼睛亮了）`
as avatar cues instead of spoken text. But many models also produce short
English companion cues such as `(eyes brightened)`, `(blush)`, or `(nod)`.
Before this slice, those English cues could remain visible as script asides
instead of driving the avatar, which made the companion feel less alive and
made Live2D guidance harder to understand.

## Technical Design

- Extend the existing `features/pet/performance` stage-direction parser.
- Keep full-width `（...）` and `【...】` behavior unchanged:
  - recognized directions drive avatar cues and are removed from display and
    speech,
  - unrecognized full-width asides stay visible as muted script asides but are
    not spoken.
- Accept ASCII parentheses only when the inner text resolves to a known
  companion gesture alias, for example:
  - `(eyes brightened)` -> happy/sparkle,
  - `(blush)` -> embarrassed/shy,
  - `(nod)` -> happy/confirm,
  - `(tilts head)` -> thinking.
- Leave unrecognized ASCII parentheses, square-bracket notes, and Markdown
  links as ordinary content.
- Do not add new model dependencies, renderer dependencies, IPC paths, storage,
  or background work.

## Impact

- English stage directions from common LLM outputs now reach Live2D/Sprite via
  the existing `PetPerformanceCue` queue.
- Voice output still never speaks recognized stage directions.
- Ordinary content such as `(TODO)` and `[docs](https://...)` remains visible
  and spoken.

## Risks

- Over-broad ASCII parenthetical parsing could strip normal prose.
- English aliases can overlap with ordinary words such as "thinking".

Mitigations:

- ASCII parentheses are accepted only when the whole parenthetical is a known
  short gesture alias.
- URLs and labeled notes with colons remain structured content.
- Focused tests cover known English gestures plus ordinary ASCII notes and
  Markdown links.

## Rollback

Remove the English aliases and ASCII-parenthetical gate from
`performance.ts`, then revert the focused tests and documentation. No data
migration or user-data rollback is required.

## Acceptance

- `(eyes brightened)`, `（blush）`, and `(nod)` drive avatar cues and are not
  displayed or spoken.
- `(TODO)` and Markdown links remain ordinary content.
- Existing full-width Chinese stage-direction behavior remains unchanged.
- Focused tests, type checks, build, lint, and full test suite pass.
