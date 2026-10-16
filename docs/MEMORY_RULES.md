# Memory rules

These rules are enforced in code on the hot path (`planTurnMemoryWrite`) and
the daily pass (`consolidateDailyMemory` → `curateMemories`). Prompt text is
not a substitute. A model reply that violates a rule is dropped or the whole
run is aborted.

## Evidence

Every `ADD`, `UPDATE`, `MERGE`, `SUPERSEDE`, and `DELETE` needs a source
quote and a message ref. An op missing either becomes `NOOP` with reason
`missing-evidence` and does not change the row. The quote is the user's
words, capped, and stored on the op. Fallback writes copy the quote from the
candidate that produced them. Cap eviction is a store limit, not a curation
op, and is the one delete that does not carry a quote.

## Undo

The op log is append-only. Each mutating op stores a `before` image of the
rows it touched. Each daily run stores a snapshot of the list before the run
(`nexus:memory:run-snapshots`). One-tap undo restores that image. Undoing a
run restores the snapshot. Neither path rewrites history; the undo itself is
another op.

## Loss guard

One run may retire at most 20% of the active rows, and never more than 10.
The floor for a non-empty store is one retirement, so a single city change
still lands. If a model or curation plan would retire more than that, the
run returns the existing rows and writes none of the destructive ops.
`fallbackReason` is `loss-guard` on the model path.

## Sensitive categories

Health, finances (card or account numbers), passwords and credentials,
government ID numbers, a street address with a door number, and another
person's private details are not stored unless the user confirms them.
The text is dropped before the write. The secret is not copied into the op
log. City-level "我住在上海" is not a street address and may be stored.

## User-owned rows

Pinned, hand-edited, user-confirmed, and manual rows are never rewritten or
retired by the model or the daily pass. An ordinary open loop is protected
from cap eviction, and may still receive a due-date repair or a detail the
user added later.

## Open loops

A commitment the user stated becomes one open loop, with the due date taken
from the words and the day they were said. `下周二` is the Tuesday of the
next Monday-based week. A clock is applied only when the user names one;
otherwise the due time stays 18:00. A later turn that adds a place or a
clock updates that same loop (`slotKey`, or the only open loop when the
place or clock is unambiguous). It does not create a second loop. The
daily pass does not invent tasks the user did not state.

## Proactive mentions

Before the due time the companion confirms what, when, and where, adds a
short prep note, and asks whether to remind the user the night before.
Accepting that card creates a real reminder. Declining does not close the
loop. After the due time it asks once whether the thing got done. Both
lines are questions. Neither asserts that the user forgot. "Done" closes
the loop. Migrated loops are kept and are never selected for a mention.

The shared budget still applies: at most 3 mentions a day, at least 90
minutes apart, quiet hours 23:00–08:00, and after two dismissals the next
three days allow one mention.

## Migration

Existing memories are normalized in place. Fields that were already stored
are kept. An open loop whose stored schema was not v2 is marked `migrated`
so it is never nagged. Newer loops are not marked, and stay eligible.
