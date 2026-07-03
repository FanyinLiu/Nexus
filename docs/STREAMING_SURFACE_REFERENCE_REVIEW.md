# Streaming Surface Reference Review

This note records the bounded Pro review for the `streaming` surface.
It is a local implementation contract, not a transcript of the Pro answer.

## Source References

- Vercel AI Chatbot: borrow append-only streaming and tool/result layering inside the message flow.
- assistant-ui: borrow assistant run state grammar for pending, streaming, actions, and recoverable states without copying thread chrome.
- LibreChat: borrow separation between partial output, resumable streams, artifacts, and final responses without importing chat platform density.
- OpenHands: borrow observation/action/run-state separation at a high level without copying autonomous workbench chrome.
- Cline: borrow approval/checkpoint boundaries for high-risk actions without copying IDE, terminal, diff, or task-board UI.

## Pro Review Summary

`streaming` is not a loading animation layer. It is the contract that keeps one assistant run understandable while the reply is being formed. The baseline contract is append-only message continuity.

The core judgment is: Nexus should feel like the same companion is steadily composing one answer, not like a web chat dashboard running tasks.

For Nexus, streaming must preserve three priorities:

1. Append-only message continuity.
2. Composer reachability.
3. Bounded tool-result previews.

## Streaming Surface Contract

- Waiting, partial output, tool pending, tool result, final, interrupted, and error states belong to the assistant message boundary.
- Streaming state must not live on a global panel wrapper as a visual mode.
- Existing partial output remains readable and is not covered by skeletons or loading overlays.
- Tool results appear as lightweight child previews of the assistant message.
- Tool result previews are bounded by default and must not become artifact workspaces.
- Composer remains mounted and reachable while the assistant is busy.
- Streaming does not hide or cover the composer.
- Auto-scroll must not override user reading position during long output.
- Loading animation is secondary to readable text.
- Message, chat list, and panel wrappers must not use streaming state for transform, filter, z-index, scale, or elevation jumps.

## Current Nexus Baseline

- `ChatMessage` exposes an optional `runStatus` for assistant run states.
- `MessageBubble` maps assistant run states to `data-chat-surface-state`.
- `MessageBubble` renders tool results inside the message bubble.
- `PanelView` keeps the composer mounted while `chat.busy` is true.
- The send button can be disabled during busy work, but the textarea remains present and editable.
- Chat already uses message-scoped `aria-live="polite"` for new content.

## State Model

```text
waiting
streaming_text
tool_pending
tool_result_preview
final
interrupted
error_recoverable
```

Recommended rendering order inside a single assistant bubble:

1. Message text.
2. Low-weight run status line.
3. Bounded tool-result preview.
4. Final response state.

## Implementation Route

1. Keep assistant run state on the message, not on the panel wrapper.
2. Let `MessageBubble` own the visible streaming/tool-result boundary.
3. Keep composer mounted and keyboard-reachable while a run is active.
4. Add tool-result previews as bounded summaries before any expandable details.
5. Add auto-scroll restraint for long output after the message-state boundary is stable.
6. Use source-only audits for structure and human review for perceived companion feel.

## Automatic Checks

- `ChatMessage` keeps an assistant run status field.
- `MessageBubble` maps run status to `data-chat-surface-state`.
- Tool results render inside `MessageBubble`, not as panel-level cards.
- Tool-result lists and long previews have default `max-height` and local scrolling so tool output stays bounded inside the assistant message.
- `PanelView` keeps `companion-chat__composer` mounted outside busy conditionals.
- Streaming reference evidence points at at least two open-source AI chat references.
- Companion chat source avoids terminal, diff, log, cockpit, artifact-workspace, or task-board chrome.

## Human Review Checks

- Streaming reads as "星绘 is replying" rather than a generic loading task.
- Waiting state is visible but quiet.
- Partial output stays readable while more text arrives.
- Tool-result preview does not overpower the message.
- Long streaming does not force-scroll away from what the user is reading.
- Composer remains psychologically and visually the primary input route.

## Rejected Routes

- Full-screen loading overlays.
- Separate loading cards outside the assistant message.
- Terminal/log/diff chrome inside companion chat.
- Large artifact or agent workspace panels.
- Message wrapper scale, glow, z-index, transform, or elevation changes during streaming.
- Hiding or covering the composer during assistant work.
- Copying Vercel, assistant-ui, LibreChat, OpenHands, or Cline skins.
