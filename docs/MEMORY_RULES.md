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

## Global pause

`memoryPaused` (暂停所有记忆) stops the hot path and the daily pass. Chat
does not capture a new loop or update an existing one, and the daily pass
does not read the diary, merge rows, or retire anything. A pause that lands
after the scheduler has already chosen to run still returns the current
list with no ops.

## Open loops

A commitment the user stated about their own plan becomes one open loop,
with the due date taken from the words and the day they were said.
`下周二` is the Tuesday of the next Monday-based week. A clock is applied
only when the user names one; otherwise the due time stays 18:00. Someone
else's plan, a hypothetical, a past event, and sensitive text are not
stored. A later turn that adds a place or a clock updates that same loop
(`slotKey`, or the only open loop when the place or clock is unambiguous).
It does not create a second loop. The daily pass does not invent tasks the
user did not state.

A plan is clear when it is the user's own, the date resolves, the user
named a clock, and a place is present when the errand needs one (a hall,
an appointment, an interview, a meeting). A report or a send does not need
a place. Vague time, a missing clock, a missing place, or two readings
stay a question.

## Proactive mentions

A clear plan books a night-before reminder as soon as it is clear, plus
the day-of check. The card then confirms the date and place (`10月20日 9:00`)
and offers 改时间 and 撤销. 撤销 dismisses the loop, removes the reminder,
and writes an op. An unclear plan still asks, with a short prep note,
before any reminder is created. Declining that ask does not close the
loop. After the due time the card asks once whether the thing got done.
No line asserts that the user forgot. "Done" closes the loop. Migrated
loops are kept and are never selected for a mention.

The shared budget still applies: at most 3 mentions a day, at least 90
minutes apart, quiet hours 23:00–08:00, and after two dismissals the next
three days allow one mention.

## Migration

Existing memories are normalized in place. Fields that were already stored
are kept. An open loop whose stored schema was not v2 is marked `migrated`
so it is never nagged. Newer loops are not marked, and stay eligible.
