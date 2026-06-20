# Milestone 6 Slice 6 — Companion Presence Release Theme Sync

## Problem

v0.3.5 gained visible companion-presence work after the original release theme
was written. The in-app spotlight and release notes still described the release
mostly as memory, migration, IPC, and setup groundwork. That is accurate but not
memorable enough for users who expect a desktop companion rather than a work
agent.

Nexus needs the release theme to name the user-visible companion upgrade without
expanding into autonomous task execution.

## Technical Design

- Keep the existing About / Help release spotlight surface.
- Update the v0.3.5 spotlight title and summary so the release is framed as:
  - visible memory,
  - readable desktop companion states.
- Add a `companion_presence` spotlight bullet that points users to the desktop
  state preview and names the visible idle/thinking/listening/speaking/waiting/
  error/offline states.
- Keep the companion-first boundary bullet so the release does not read as a
  Codex-style task-agent expansion.
- Update release notes and roadmap/changelog docs to match the in-app copy.
- Add focused tests that fail if the current release spotlight stops naming the
  companion presence upgrade in English and Chinese.

No dependencies, IPC channels, storage writes, migrations, permissions,
automation tools, or secret-handling changes are introduced.

## Impact

- Users can remember v0.3.5 as "memory is visible, and the companion feels
  present."
- The in-app About / Help panel, release notes, roadmap, and changelog tell the
  same story.
- Release QA can verify the theme with a small focused test instead of relying
  on manual copy review.

## Risks

- Adding another spotlight bullet could make About / Help feel crowded.
- The release theme could overpromise Live2D or voice capabilities.
- Translation copy can drift across locales.

## Mitigations

- The new bullet is short and names only shipped state-preview behavior.
- Copy avoids claiming voice, lip sync, Live2D hot-switching, or autonomous
  execution.
- i18n audit plus the focused release spotlight test cover registration and
  English/Chinese theme wording.

## Rollback

Revert the `companion_presence` spotlight bullet, locale strings, focused test
assertions, and documentation edits. No data rollback is needed.

## Acceptance

- About / Help frames v0.3.5 as visible memory plus companion presence.
- The spotlight includes a desktop state preview bullet.
- Release notes and roadmap/changelog docs mention the companion-presence theme.
- Focused release spotlight tests, i18n audit, build, lint, full tests, and pet
  visual smoke pass.
