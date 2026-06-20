# Milestone 2 Slice - In-App Release Spotlight

## Problem

After v0.3.5, the release theme exists in release notes and changelog entries,
but a user inside the app still has to leave Nexus to understand what the
current version should be remembered for. That weakens the release story: the
upgrade is real, but the product does not explain it at the point where users
look for version/help information.

For Nexus, this should stay companion-first. The answer is not a growth-style
what's-new feed or an automation dashboard. It is a compact release spotlight
inside About/Help that names the current theme and the user-visible changes.

## Technical Design

- Add `features/releaseNotes/releaseSpotlight.ts` as a small typed release-theme
  contract:
  - current version: `0.3.5`,
  - spotlight title and summary translation keys,
  - four memorable bullets: memory sources, memory control, first-run repair,
    and companion-first boundary.
- Render the spotlight in `AboutPanel` between app links and FAQ.
- Add localized strings for zh-CN, zh-TW, en-US, ja, and ko.
- Add compact settings CSS that behaves like inline release information rather
  than a nested card.
- Add `tests/release-spotlight.test.ts` to ensure:
  - the current release theme stays explicitly tied to v0.3.5,
  - all spotlight translation keys are registered,
  - every supported locale provides non-empty localized text.

No new dependencies, IPC paths, storage writes, migrations, network calls, or
renderer access to secrets are introduced.

## Impact

- Users can open About/Help and immediately see the memorable v0.3.5 theme:
  memory is no longer a black box.
- Release QA has a stable in-app place to verify the release message.
- The companion boundary is visible in the product itself: these changes are
  about transparent local memory and first-run reliability, not autonomous task
  execution.

## Risks

- The spotlight can become stale if the app version is bumped without updating
  the release contract.
- Extra text in About/Help can make the section feel crowded on narrow windows.
- If future releases add many bullets, the panel could drift into a changelog.

## Mitigations

- Keep the current version and bullet IDs in one typed contract.
- Limit the spotlight to one title, one summary, and four short bullets.
- Treat detailed history as changelog/release-note content, not About-panel
  content.

## Rollback

Remove `features/releaseNotes/releaseSpotlight.ts`, the AboutPanel spotlight block,
the spotlight styles, the translation keys/strings, and
`tests/release-spotlight.test.ts`. No user data rollback is required because no
storage or migration path changes.

## Acceptance

- About/Help shows the v0.3.5 release theme before the FAQ.
- The spotlight says the release is about transparent companion memory and
  explicitly preserves the non-agent boundary.
- `npm run i18n:audit` passes across all supported locales.
- The focused release spotlight test passes.
- The normal build/test/lint gates continue to pass.
