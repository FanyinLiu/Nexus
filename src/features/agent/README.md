# Companion Task Boundary

This folder keeps legacy errand, trace, and lightweight follow-up state for the
desktop companion. The folder name stays stable so existing data and imports do
not churn, but the product boundary is companion tasks, not a Codex-style work
agent.

Rules for future changes:

- User-facing copy should prefer companion tasks, reminders, follow-ups, or
  traces instead of presenting Nexus as an autonomous worker.
- New active behavior must stay default-off or confirmation-gated, then pass
  IPC permission and metadata-only audit review before it can run.
- This layer must not become a planner/executor surface for background work
  unless a later milestone adds explicit preview, confirm, stop, rollback, and
  audit contracts.
