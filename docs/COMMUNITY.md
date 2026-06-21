# Nexus Community Guide

Nexus is a local-first desktop AI companion. The community should make it easier
for people to live with, customize, and understand that companion experience
without turning Nexus into a default task-agent product.

Community work is not tied to one release. It runs across every version because
Nexus should grow as a project, not only as a feature list. Release work can
ship safety, memory, desktop awareness, or pet behavior; community work keeps
the ecosystem healthy around those releases: docs, personas, pets, translations,
model recipes, validation reports, and examples that other people can actually
try.

## Cross-Version Role

Treat community documentation as a permanent project layer:

- **v0.3 foundation:** explain safety, memory visibility, setup, and privacy in
  language new users can follow.
- **v0.4 desktop companion awareness:** collect feedback on quiet observation,
  coarse time language, check-in frequency, and OS permission friction.
- **v0.5 desktop pet behavior:** collect pet packages, motion feedback,
  non-blocking interaction patterns, and accessibility reports.
- **v1.0 and later:** keep contribution paths clear enough that people can add
  value without needing to understand the whole codebase.

The goal is project growth with trust. More contributions are useful only when
they make Nexus easier to run, safer to customize, or clearer as a companion.

## What To Build

The best community contributions are concrete and easy to try:

- Sprite pet packages and avatar variants.
- Persona templates and prompt examples.
- Model setup recipes for Ollama, DeepSeek, OpenAI-compatible endpoints, and
  local-first workflows.
- Installation notes for Windows, macOS, and Linux.
- Translation fixes and new locale proposals.
- Beta validation reports with screenshots or short clips.
- Small bug fixes with clear reproduction steps.
- Use-case writeups: what worked, what felt wrong, what should be quieter.
- v0.4 feedback about whether desktop-aware check-ins feel caring, too frequent,
  too precise, or too much like monitoring.
- v0.5 feedback about whether desktop pet reactions help companionship without
  blocking mouse, keyboard, fullscreen work, or accessibility tools.

## What Not To Build First

Avoid contributions that make the project harder to trust or maintain:

- Default automation that reads files, sends messages, or changes settings
  without explicit confirmation.
- Huge persona prompts with no sample dialogues.
- Bundled community artwork without redistribution permission.
- Features that make Nexus feel like a generic agent platform before the
  companion loop is stable.
- Provider-specific hacks that only work for one account or one private setup.

## Contribution Paths

### Project Growth Docs

Use docs to make the project larger without making it chaotic:

- explain one feature in plain language
- add screenshots or validation notes
- document OS-specific permission setup
- write a model recipe another person can reproduce
- describe what a new contributor should avoid

Docs should stay cross-version when they teach a lasting concept. Use release
notes only for what changed in that release.

### Persona or Prompt Pack

Start with [Persona Contribution Template](PERSONA_CONTRIBUTION_TEMPLATE.md).
Include sample dialogues for normal use, permission boundaries, tool failure,
and memory transparency.

### Sprite Pet or Avatar

Start with [Adding Sprite Pet](ADDING_SPRITE_PET.md). Include:

- Original source or license.
- `pet.json` and spritesheet package.
- A short preview or screenshot.
- Notes about motion states that feel wrong.

Do not submit private app assets or copied community art as bundled Nexus art.
User-selected imports can be documented; bundled assets need explicit permission.

### Model Configuration Recipe

Include:

- Provider and model name.
- Base URL shape.
- Required local services.
- Common failure message and fix.
- Whether the setup works offline.
- Cost or rate-limit notes, if relevant.

Never include API keys, tokens, account IDs, or private endpoints.

### Translation

Keep UI keys in sync across locales. If a translated string changes product
meaning, explain why in the PR.

### Beta Validation

Use the GitHub issue template **Beta Validation Report** for release-candidate
or beta testing. The template is intentionally structured so maintainers can
compare reports across OS, install type, provider setup, and feature area.

Good beta reports include:

- Nexus version and OS.
- Install path: release build or source build.
- Provider setup used.
- What you tested.
- What happened.
- Screenshots or short clips when UI behavior matters.

For v0.4 desktop companion awareness, also include:

- whether Nexus was open but unused
- whether the user was actively chatting with Nexus, because active chat should
  take priority over proactive companionship
- what kind of desktop activity was happening
- whether the time wording felt natural
- whether any check-in felt too soon, too late, or too precise
- whether any line felt caring, cold, nagging, or like monitoring
- whether pausing the feature was obvious
- whether clearing the recent companion summary was obvious
- whether the OS permission flow was understandable

Use the structured v0.4 fields when possible. They intentionally reduce
feedback into safe labels such as timing feel, tone feel, privacy-boundary
signals, permission friction, and whether Nexus was open but unused, actively
chatting, or returning from away. These labels are useful for tuning without
retaining raw desktop activity.

Do not include raw screenshots, private message text, full clipboard contents,
or private file paths unless you intentionally created a safe test fixture.

## Review Standard

Nexus community work should pass these questions:

- Does this keep the user in control?
- Does this make the companion experience clearer or more stable?
- Is the source/license clear?
- Can another person reproduce or try it?
- Does it avoid pretending that Nexus did something it did not do?
- Does it preserve the local-first, companion-first direction?

## Useful Links

- [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md)
- [Nexus Companion Prompt Baseline](NEXUS_COMPANION_PROMPT.md)
- [Persona Contribution Template](PERSONA_CONTRIBUTION_TEMPLATE.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Adding Sprite Pet](ADDING_SPRITE_PET.md)
- [Executable Optimization Tasks](EXECUTABLE_OPTIMIZATION_TASKS.md)
