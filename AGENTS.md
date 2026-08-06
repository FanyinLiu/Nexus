# AGENTS.md — Nexus Code Conventions (Normative)

This file is the **normative rulebook** for anyone — human or AI agent — modifying
this repository. It uses RFC 2119 keywords:

- **MUST / MUST NOT** — absolute requirement/prohibition. Violations block the change.
- **SHOULD / SHOULD NOT** — required unless a documented reason exists. Deviations
  must be justified in the commit message.
- **MAY** — genuinely optional.

**Precedence:** direct instruction from the repository owner > this file > your own
defaults. When rules conflict, the more specific section wins. If you believe a rule
is wrong, change this file first (own commit, `docs:` prefix), then the code —
never the reverse.

Verified against the tree at v0.4.5 (2026-08). Canonical gate: `npm run verify:pr`.

---

## ARCH — Layering and dependencies

- **ARCH-1** Code MUST live in exactly one layer: pure logic in `src/features/<domain>/`,
  host wiring in `src/hooks/`, rendering in `src/components/` or `src/app/views/`,
  composition in `src/app/controllers/`, main-process work in `electron/`,
  cross-process truth in `shared/`. *Enforced by `architecture:audit`.*
- **ARCH-2** `src/features/*` MUST NOT import React hooks, DOM APIs, or
  `window.desktopPet`. Decision logic in hooks/components MUST be moved there.
  *Exemplar: `src/features/reminders/parseReminderIntent.ts`.*
- **ARCH-3** Hooks MUST NOT contain decision logic; they own timers, refs, and
  effect lifecycles only. *Exemplar: `src/hooks/usePollingScheduler.ts`.*
- **ARCH-4** `electron/` MUST NOT import from `src/`; `src/` MUST NOT import from
  `electron/`. Shared logic MUST go through `shared/` (see SRC-1).
- **ARCH-5** A component or controller that grew a second responsibility SHOULD be
  split by pipeline stage or responsibility. *Exemplar: `src/hooks/chat/assistantReply/`.*

## SRC — Single-copy rules

- **SRC-1** Logic needed by both processes MUST exist once, in
  `shared/<module>.js` + `<module>.d.ts`. A second copy in either process is a
  defect, no exceptions. *Enforced by `tests/shared-contract.test.ts`.*
- **SRC-2** Utility helpers MUST live in their single home: type guards in
  `src/lib/guards.ts`, string/number normalizers in `src/lib/normalize.ts`, date/time
  in `src/lib/localDate.ts`, other misc in `src/lib/common.ts`. Before adding any
  `isX` / `normalizeX` / `clamp` / `nowIso` / `pickLocale` helper, you MUST check
  these four files. Private copies are removed on sight.
- **SRC-3** Electron JSON-file stores MUST use the factories in
  `electron/services/jsonFileStore.js` (sync or async variant). Hand-rolled
  load-once caches, debounced writers, or `JSON.parse` read paths in new code are
  prohibited.
- **SRC-4** Electron text helpers (`normalizeWhitespace`, `decodeHtmlEntities`,
  `stripHtml`, …) MUST come from `electron/textNormalize.js`.
- **SRC-5** New audit scripts MUST consume `scripts/lib/audit-framework.mjs` and
  MUST keep existing `build*Report` export signatures stable
  (`scripts/distribution-audit.mjs` imports 14 of them).

## FILE — Naming, size, structure

- **FILE-1** File names MUST follow: modules/hooks camelCase (`useChat.ts`),
  components PascalCase (`SettingsDrawer.tsx`), scripts kebab-case
  (`source-size-audit.mjs`).
- **FILE-2** A source file MUST NOT exceed its `source-size:audit` budget (default
  1200 lines). Files SHOULD be split once past ~600 lines.
- **FILE-3** Complex assemblies MUST be built as one exported factory
  `createXxx(deps)` with an explicit dependency bag. Hidden closure capture across
  module boundaries is prohibited. *Exemplar: `src/hooks/chat/sendMessage.ts`.*
- **FILE-4** New directories under `src/features/` require a real second module —
  no single-file feature folders with an `index.ts` that only re-exports it.

## IMP — Imports and barrels

- **IMP-1** Relative imports in `src/` MUST carry explicit extensions
  (`'../lib/guards.ts'`, `'./Foo.tsx'`). Zero violations tolerated.
- **IMP-2** Extensionless directory imports are permitted **only** when resolving
  to a feature barrel `index.ts` (`'../../features/analytics'`).
- **IMP-3** Barrels (`export *`) are allowed only at `src/features/<domain>/`
  boundaries. They MUST NOT appear inside `src/lib/`, and MUST NOT re-export
  constants through more than one hop (knip duplicate-export ambiguity).
- **IMP-4** `electron/` and `shared/` imports MUST use `.js` extensions.

## DOC — Comments and documentation

- **DOC-1** Comments MUST be in English and MUST explain *why*, not *what*.
- **DOC-2** Every exported helper in `shared/`, `src/lib/`, `scripts/lib/`, and
  `electron/` MUST carry JSDoc.
- **DOC-3** Non-trivial modules SHOULD open with a 3–8 line header stating
  responsibility, variants, and semantic traps.
  *Exemplar: `electron/services/jsonFileStore.js`.*
- **DOC-4** Comments MUST NOT narrate diffs, refactors, or ticket history.
- **DOC-5** Date-stamped files under `docs/` (release notes, milestone plans,
  handoffs) are historical records and MUST NOT be rewritten to track code moves.
  Living documents — this file, `docs/ARCHITECTURE.md`, `docs/BEHAVIOR_MAP.md`,
  `CONTRIBUTING.md`, `README.md` — MUST be updated in the same change that breaks
  their statements.

## ERR — Errors, logging, user-facing text

- **ERR-1** The main process MUST throw stable error codes
  (`shared/chatErrorCodes.js`), never prose. The renderer maps codes to i18n keys
  in `src/lib/humanizeError.ts`. Regex-matching human-language error text is
  prohibited.
- **ERR-2** Structured IPC results MUST carry `messageKey`/`recommendationKey`;
  hard-coded fallback copy in `electron/` is prohibited.
- **ERR-3** Any log line that can contain user data or secrets MUST pass through
  the redaction wrappers (`electron/services/errorRedaction.js` /
  `src/lib/logRedaction.ts`). *Enforced by `error-redaction:audit`,
  `message-privacy:audit`, `desktop-context-privacy:audit`, `vault-security:audit`.*

## STORE — Persistence

- **STORE-1** All writes MUST be atomic (`atomicWriteJson`); parse failures MUST
  normalize to empty defaults; persist errors MUST warn and MUST NOT throw.
- **STORE-2** Renderer storage reads MUST normalize through `guards.ts` /
  `normalize.ts`.
- **STORE-3** Storage keys are contractual. Adding, renaming, or removing a key
  MUST satisfy `storage:audit` and the migration contract.

## I18N — Translations

- **I18N-1** `src/i18n/keys.ts` is generated. Hand-editing it is prohibited.
  Workflow: add the key to `src/types/i18nKeys/*` and all 5 locales, then run
  `npm run i18n:gen`. *Enforced by `i18n:gen:check` in `verify:pr`.*
- **I18N-2** User-visible strings MUST go through `t()` / message keys — in every
  process, including error paths (see ERR-1/ERR-2).
- **I18N-3** When `keys.ts` reaches its line budget, bump the `FILE_BUDGETS`
  entry in `scripts/source-size-audit.mjs` in the same change.

## TEST — Testing

- **TEST-1** New behavior MUST ship with behavior tests: import the module, call
  it, assert outputs/state. Runner: `npm test` (`node --test`).
- **TEST-2** Source-structure assertions (regex/includes over source text) are
  permitted **only** for security boundaries: redaction, vault, privacy, IPC
  surface, storage contract. Any other "assert the code looks like X" test is
  refactor friction and will be deleted.
- **TEST-3** Tests MUST NOT re-run an audit script against the real repository
  root — `verify:pr` already executes every audit. Audit-logic regression
  coverage uses fixtures; one representative fixture file per audit family.
- **TEST-4** Meta/process tests (asserting `package.json` wiring, CI YAML text,
  version strings in docs) are prohibited.
- **TEST-5** The IPC channel inventory in `tests/ipc-contract-audit.test.ts` is a
  security baseline and MUST be updated in the same change that adds/removes a
  channel.
- **TEST-6** Tests MUST NOT depend on execution order, wall-clock dates, or the
  developer machine's paths/locale.

## CSS — Styles

- **CSS-1** The settings style layers and their load order are contractual.
  New global layers or new `settingsStyles*.ts` shims are prohibited.
  *Enforced by `settings:css:audit`.*
- **CSS-2** New rules MUST go into the existing layer file that owns the concern.
  `*-legacy.css` is frozen except `uiV2=0` bug fixes.

## GIT — Commits, branches, PRs

- **GIT-1** Commit messages MUST follow Conventional Commits (`feat`, `fix`,
  `docs`, `refactor`, `test`, `chore`, `perf`, `style`; optional scope), per
  `CONTRIBUTING.md`.
- **GIT-2** One logical concern per commit/PR. Unrelated cleanups MUST be split.
- **GIT-3** `npm run verify:release` MUST be green before a PR is opened.
- **GIT-4** AI agents MUST NOT run `git commit`, `git push`, `git rebase`,
  `git reset`, or any other git mutation without an explicit per-action approval
  from the owner. `--no-verify` and force-push are always prohibited.

## AGT — AI-agent protocol

- **AGT-1** Read this file before your first edit in a session. It overrides your
  defaults.
- **AGT-2** Diffs MUST be minimal and on-task: no drive-by renames, reformatting,
  or speculative abstractions. Match the surrounding style.
- **AGT-3** Run `git status` before editing. Files with uncommitted changes that
  are not yours are someone else's WIP: you MUST NOT modify them; skip and report
  the conflict.
- **AGT-4** After any non-trivial change, `npm run verify:pr` MUST pass before you
  report completion. If the gate fails: fix or revert — bypassing a gate (disabling
  a rule, adding an exemption, deleting a test) without owner approval is
  prohibited.
- **AGT-5** You MUST NOT: add or upgrade dependencies, add lint/knip/audit
  exemptions, edit generated files (`src/i18n/keys.ts`), weaken security
  boundaries, or delete tests — without explicit owner approval in the task.
- **AGT-6** Behavior-preserving refactors MUST keep IPC contracts, storage keys,
  i18n keys, and test assertion semantics intact.
- **AGT-7** Never claim work is done without having run the verification you cite.
  If you could not run something, say so.

---

*This file is enforced socially and by the gates it names. If a rule here is wrong,
fix the rule (own `docs:` commit) — do not erode it by exception.*
