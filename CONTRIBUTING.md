# Contributing to Nexus

Thanks for your interest! Nexus is a solo-maintained project, so any help — from bug reports to translations to PRs — makes a real difference.

## Table of Contents

- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Questions and discussion](#questions-and-discussion)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Code style](#code-style)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Translations](#translations)
- [Security issues](#security-issues)

---

## Reporting bugs

Use the [Bug Report template](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml). It asks for the key details upfront:

- What happened vs. what you expected
- Steps to reproduce
- Nexus version + OS
- Which LLM / STT / TTS providers were active (if audio-related)
- Logs from `%APPDATA%\nexus\logs\` (Windows), `~/Library/Application Support/nexus/logs/` (macOS), or `~/.config/nexus/logs/` (Linux)

**Small, specific reports are easier to fix than long speculative ones.** If you're not sure whether it's a bug or expected behavior, ask in [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a) first.

## Suggesting features

For **small, well-scoped ideas** — open a [Feature Request issue](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml).

For **bigger or more open-ended ideas** — post in [Ideas Discussion](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas) first. That gives others a chance to weigh in before it becomes a tracked task.

Always describe the **problem** you're trying to solve, not just the feature you want. Proposed solutions are welcome but optional.

## Questions and discussion

- **Stuck on setup or usage?** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- **Want to share how you use Nexus?** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- **Just want to chat?** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)

---

## Development setup

### Prerequisites

- **Node.js** 22 or newer (CI uses 22)
- **npm** 10+
- **Python** 3.10+ (optional — only needed if you rebuild voice models from source)
- **Git**
- ~5 GB free disk for the ASR / TTS models that `postinstall` downloads

### Clone and install

```bash
git clone https://github.com/FanyinLiu/Nexus
cd Nexus
npm install
```

`postinstall` automatically fetches vendor binaries and runs `scripts/setup-vendor.mjs`. The first install takes longer because of model downloads; subsequent installs are fast.

If you want to skip the heavy ASR models for a lighter dev environment:

```bash
npm run download-models:lite
```

### Run in dev mode

```bash
npm run electron:dev
```

This runs Vite and Electron concurrently with hot reload.

### Build and package

```bash
npm run build                  # type-check + Vite production build
npm run package:win            # Windows NSIS installer
npm run package:mac            # macOS .dmg (signing disabled for unsigned local builds)
npm run package:linux          # Linux AppImage
```

### Run tests and lint

```bash
npm run lint
npm test
npm run verify:release         # lint + test + build (run this before opening a PR)
```

---

## Project layout

```
Nexus/
├── electron/              Main process — window manager, IPC, services (voice, MCP)
├── src/                   Renderer — React app, Live2D, hooks, stores
│   ├── app/               App shell, controllers, desktop bridge
│   ├── features/          Feature modules (voice, chat, memory, autonomy)
│   ├── hooks/             Cross-cutting React hooks
│   └── lib/               Shared utilities, storage, providers
├── scripts/               Build and setup scripts (vendor, model download)
├── sherpa-models/         Local ASR / wake-word model assets
├── docs/                  Design docs, translated READMEs
├── tests/                 Node test runner tests (`*.test.ts`)
└── public/                Static assets (banner, icons)
```

## Code style

- **TypeScript strict mode** — no `any` without justification
- **Functional React components** with hooks — class components are out
- **ESLint** — run `npm run lint` before pushing
- **File length** — try to keep modules under ~400 lines; split when a file stops fitting in your head
- **Side effects** — keep them at the edges (controllers, effects, IPC handlers), keep pure functions in `lib/`

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add barge-in detection for headphone users
fix: wake word firing on self TTS leakage
docs: expand CONTRIBUTING with package steps
refactor: split streamAudioPlayer into phase controllers
chore: bump electron to 32.x
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`.

Scope is optional but welcome: `fix(voice): ...`, `feat(autonomy): ...`.

## Pull requests

1. **Fork** and create a branch: `git checkout -b feat/my-feature`
2. **Make focused changes.** One logical concern per PR. Split unrelated fixes into separate PRs.
3. **Run `npm run verify:release`** — this is the same check CI runs. If it fails locally, it will fail in CI.
4. **Open a PR against `main`** with:
   - A clear title (Conventional Commit format works well)
   - Description: what the PR does and **why**
   - Linked issue: `Closes #123` if it fixes an open issue
   - Before/after screenshots or short clips if the UI changed
5. **Expect feedback.** Small iterations are normal and don't mean the PR is bad. I'll try to respond within a few days.

## Translations

The `docs/` directory holds translated READMEs (`README.zh-CN.md`, `README.zh-TW.md`, `README.ja.md`, `README.ko.md`). UI strings live in `src/lib/i18n/` — keep keys in sync across all locales when you edit them.

New languages welcome. Open a Discussion first so we can agree on the locale code and layout.

## Security issues

If you find a **security vulnerability**, please do *not* open a public issue. See [SECURITY.md](SECURITY.md) if present, or open a private security advisory via the Security tab.

---

Thanks again. Even a 1-sentence issue or a typo-fix PR moves things forward.
