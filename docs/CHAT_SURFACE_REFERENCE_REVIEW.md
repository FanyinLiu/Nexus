# Chat Surface Reference Review

Last checked: 2026-06-28.

This note records the focused chat review generated from:

```sh
npm run ui:references:audit -- --surface=chat --pro-prompt
```

It is a design-planning record, not a source-code dump. It uses the public reference manifest and the Pro review summary to keep future chat work grounded in Nexus-specific behavior instead of another product's skin.

For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.

## Source References

| Reference | Borrow | Avoid |
| --- | --- | --- |
| Open WebUI | Low-noise chat density and restrained utility affordances. | Full workspace/admin chrome or broad platform density inside the companion panel. |
| Jan | Local-first trust posture and quiet privacy/runtime context. | Model-manager panels, runtime dashboards, provider pickers, or local-AI client chrome inside chat. |
| assistant-ui | Thread, message, composer, action, branch, and streaming state grammar. | Demo thread chrome, large branch controls, or always-on message action bars. |
| LibreChat | Named boundaries for agents, artifacts, MCP/tools, presets, search, and resumable streams. | ChatGPT-like shell, account/workspace chrome, dense admin panels, or exposing every capability by default. |
| AnythingLLM | Workspace memory, documents, agents, and source context as explicit boundaries. | Document-workspace density, citation panels as default chrome, or enterprise dashboard framing. |
| Vercel AI Chatbot | Streaming-first composition, composer priority, and tool/result boundaries. | Browser-page layout assumptions copied into the desktop side panel. |
| OpenHands | Agent run-state separation: message, action, observation, and result are distinct. | Coding-agent cockpit chrome, terminal/browser/files panes, issue workflows, or task queues in default chat. |

## Pro Review Summary

Pro accepted chat as a quiet threaded companion chat: a streaming feed with input dominance and tool boundary contracts, not as the product's root surface. The chat stream can be useful and dense, but it must not swallow presence, dial, companion identity, or the user's primary input path.

The most important judgment is whether the chat surface still feels like a companion subsystem. Streaming, tool results, and message density should clarify the conversation without turning Nexus into a generic AI chat app.

The bounded Pro takeaway is visual priority: composer remains the primary intent gateway, user/assistant messages form a continuous reading flow, tool/context/memory/error states are bounded secondary states, and agent/artifact/MCP/runtime/source controls stay hidden until needed.

The review explicitly rejects default workspace, admin, provider-manager, model-manager, agent-cockpit, tool-market, artifact split-pane, and runtime dashboard chrome in the chat surface.

## Chat Surface Contract

- Chat is a quiet threaded companion chat, not an AI workbench.
- Chat visual priority is composer first, message flow second, tool/context/memory/error state third, and platform/workspace/runtime controls absent by default.
- Streaming should feel append-only and continuous; it must not rebuild the message flow or move the composer.
- Tool results, memory use, desktop context, errors, and resumable state must be visible as compact boundaries inside or adjacent to a message.
- Normal messages must not become a card stack.
- Message utilities such as copy, retry, edit, branch, or action controls stay delayed and secondary.
- Do not add workspace sidebar, admin chrome, provider/model manager, agent cockpit, tool market, artifact split-pane, or runtime dashboard controls to default chat.
- Persistence must not introduce raw desktop context, clipboard, screenshot, OCR, credential-like keys, or precise timestamp leakage beyond the existing bounded chat record.

## Chat State Model

Use these states as the review vocabulary before adding visual changes:

| State | Role | Allowed visual behavior |
| --- | --- | --- |
| `empty` | The chat subsystem is available without taking over the panel. | Quiet state, no hero layout, composer remains the action anchor. |
| `streaming` | Assistant output is arriving continuously. | Append-only delta behavior, no message list reflow, no composer movement. |
| `finalized` | A message has completed and can expose secondary utilities. | Copy/retry/edit stay delayed or secondary. |
| `tool-active` | A tool call or result needs structure. | Clear inline boundary, collapsible summary, no second UI system. |
| `interrupted` | User stops or redirects the stream. | Composer regains priority and the interrupted stream resolves to one state. |
| `waiting` | A response slot exists before content arrives. | Stable placeholder, no layout jump, no global loading chrome. |
| `resumable` | A partial stream can continue or has been restored. | Small continuity marker, not a platform notification. |
| `context-used` | Memory, desktop context, or source context shaped the reply. | Compact boundary or details affordance, no raw private context by default. |

## Structure Model

Review chat as four layers with distinct ownership:

| Layer | Purpose | Must not do |
| --- | --- | --- |
| StreamLayer | Assistant delta output while a response is active. | Re-render the whole message list or shift previous rows. |
| MessageLayer | Finalized user and assistant messages. | Become card stacks or page-level document flow. |
| ToolLayer | Tool calls, results, and future structured blocks. | Become a second visual system competing with messages. |
| ComposerLayer | Primary intent anchor. | Join the scroll container or change elevation on scroll. |

This keeps chat useful without making it the root surface of Nexus.

## Implementation Route

1. Define chat layer ownership before changing visuals: `stream`, `message`, `tool`, and `composer`.
2. Treat streaming as append-only delta rendering. Finalization can snapshot a message, but streaming should not reorder or rebuild the message flow.
3. Keep the composer isolated from the scroll container. Chat scrolling may affect messages, not composer geometry, elevation, or input priority.
4. Normalize tool blocks into three states: collapsed summary, expanded structured view, and inline continuation.
5. Keep message utilities delayed and secondary. Copy, retry, edit, and tool actions should not become always-on toolbar chrome.
6. Use density through semantic boundaries, not spacing bloat. Role markers, stream/final state, and tool boundaries should carry hierarchy without cardifying normal messages.
7. Add source-visible message states before visual polish: `final`, `streaming`, `waiting`, `tool-running`, `tool-result`, `error`, `resumable`, and `context-used`.
8. Keep persistence guards explicit: chat history can store the conversation record, but raw desktop titles, clipboard, screenshots, OCR text, credential-like keys, and precise private context must not be mirrored into chat state.

For Image4 screenshot review, `?view=panel&image4Preview=1&image4ChatPreview=1` provides a URL-gated active-chat fixture. `?view=panel&image4Preview=1&image4ChatPreview=density` provides a local short/long bubble density fixture. These are local review states only: they must not send model requests, write chat history, or add product chrome.

## Automatic Checks

These are suitable for source audits or deterministic tests:

- Composer stays outside the chat scroll container and remains the primary intent anchor.
- Image4 active-chat preview stays URL-gated and does not replace runtime chat state outside preview mode.
- Image4 active-message CSS stays split in `panel-companion-messages.css` instead of returning to the broader chat/actions stylesheet.
- Streaming uses append-only delta behavior and does not introduce message reflow.
- Tool blocks use a shared boundary model instead of ad-hoc cards or page components.
- Message utilities stay secondary and do not become always-on primary chrome.
- Chat CSS does not reuse Image4 rhythm rows, dial chrome, or decorative companion motion.
- Reduced-motion behavior does not break streaming readability.
- MessageBubble exposes a bounded chat state grammar.
- Default chat does not include workspace/admin/provider/model/agent/tool-market/artifact split-pane/runtime dashboard chrome.
- Memory, desktop context, and tool usage remain bounded states instead of silent influence or raw content dumps.

## Human Review Checks

These require visual review:

- Chat still feels like a companion subsystem, not the product's root surface.
- Streaming reads as conversation, not a raw log.
- Tool results are recognizable without looking like a second application.
- Composer remains the strongest input anchor even during active output.
- The surface does not copy Open WebUI, Vercel AI Chatbot, or any other reference skin.

## Guardrail

The safe interpretation is:

```text
chat = streaming feed + input dominance + tool boundary contract
```

It is not:

```text
chat = primary app surface
```

Future chat changes should link back to this note when they touch streaming rendering, message density, tool/result blocks, composer isolation, scroll ownership, or cross-surface chat CSS.
