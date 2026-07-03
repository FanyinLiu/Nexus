# Agent Activity Surface Reference Review

This note records the bounded Pro review for the `agent-activity` surface.

## Source References

- OpenHands: borrow observation, action, progress, and completion boundaries without importing cockpit chrome.
- Cline: borrow confirmation and approval grammar without importing coding-agent shell behavior.
- LibreChat: borrow context, tool, agent, and artifact boundaries without turning Nexus into a general agent platform.
- Vercel AI Chatbot: borrow subordinate run-state behavior that stays beneath the conversation and composer.

## Pro Review Summary

Pro accepted `agent-activity` as companion activity state, not as a task cockpit. The strongest judgment is that Nexus should answer three quiet questions: what companion state is active, what coarse context shaped the reply, and whether the user must approve a next action.

The baseline contract is companion activity, not agent execution.

## Agent Activity Contract

- Activity state must read as 星绘 noticing, preparing, speaking, finishing, or needing confirmation.
- Desktop awareness must explain coarse context without surveillance wording.
- Activity state must not imply that Nexus is autonomously executing a task.
- Legacy or internal task-state identifiers may exist for compatibility, but user-visible companion status copy must use companion language such as preparing, all set, or could not finish instead of executing, execution failed, 执行中, or 执行失败.
- Image4 may show a light activity line or breathing state only; no run panel, timeline, or log surface.
- Chat may explain context boundaries under the relevant reply.
- Settings may explain transparency, permission, pause, and clear controls.
- Real actions require explicit confirmation before execution.
- Completion must settle back to a quiet companion state instead of becoming a persistent activity history.

## State Model

idle
context_available
preparing_reply
speaking
done
needs_confirmation
blocked

## Surface Placement

| Surface | Allowed activity role | Must not become |
| --- | --- | --- |
| Image4 | Ambient companion state: noticed, preparing, speaking, done. | Agent dashboard, task timeline, or cockpit panel. |
| Chat | Context boundary and action result summary attached to the relevant message. | Tool console, generic agent transcript, or workspace log. |
| Settings | Transparency controls for desktop awareness, permissions, pause, clear, and policy. | Activity history dashboard or surveillance log. |

## Implementation Route

1. Define a local `CompanionActivityState` view model before adding visuals.
2. Map current awareness/check-in signals to `idle`, `context_available`, `preparing_reply`, `speaking`, `done`, `needs_confirmation`, and `blocked`.
3. Keep Image4 activity as one low-weight companion state line or existing presence state.
4. Put context boundary explanations in chat when they affect a reply.
5. Put privacy, permission, pause, and clear controls in settings.
6. Add source-only audit rules for coding-agent shell language, surveillance wording, precise-time leakage, and cockpit DOM.

## Automatic Checks

- No coding-agent shell terms such as terminal, diff, patch, issue, workspace, task board, executing, autonomous, run panel, or agent cockpit in companion UI source.
- No surveillance wording such as monitoring desktop, scanning screen, watching you, 正在监控, 扫描桌面, 读取窗口标题, or 精确记录.
- No activity state names such as `running_task`, `executing_command`, `agent_run`, or `autonomous_work`.
- No user-visible pet companion status copy such as `Executing`, `Execution failed`, `执行中`, `执行失败`, `執行中`, `実行中`, or `실행 중`.
- No cockpit DOM names such as `terminal`, `timeline`, `log-panel`, `task-list`, or `checkpoint-tree`.
- Activity UI must use coarse time buckets, not minute/second precision or ISO timestamps.
- Context boundary text must preserve coarse-context and explicit-confirmation language.

## Human Review Checks

- Idle Image4 remains quiet and does not show a false run state.
- Desktop-awareness check-ins feel like companionship, not monitoring.
- Preparing/speaking/done states do not overpower the dial, greeting, or composer.
- Confirmation state reads as a lightweight user choice, not a command approval cockpit.
- Settings read as transparency controls, not activity history.

## Rejected Routes

- Agent activity panel.
- OpenHands or Codex-style run timeline.
- Cline checkpoint tree or command approval shell.
- Activity history dashboard in settings.
- MCP/tool marketplace or general agent capability center inside the companion panel.
- Any copy of reference project skin, component tree, visual chrome, or product shell.

## Future Change Boundary

Future agent-activity changes should link back to this note when they touch desktop-awareness visible states, check-in state language, action confirmation, settings transparency, context boundary messaging, or any UI that could be mistaken for autonomous task execution.
