# Nexus v0.3.4

> **Stable — v0.3.4 beta line promoted for general downloads.** This release
> promotes the tested `v0.3.4-beta.4` code line to the stable update channel.
> It includes the v0.3.4 beta improvements around message awareness, companion
> emotion behaviour, the default Live2D face, Telegram/Discord bridge polish,
> local TTS fallback, and stage-direction rendering.

## What changes for users

### Desktop message awareness and bridge polish

- macOS desktop message awareness can surface incoming communication context
  from Notification Center after the user grants the required system
  permission. By default, Nexus treats this as gentle context and keeps the
  interaction bounded.
- Telegram and Discord bridge work from the beta line is included, including
  the paired authorization flow and reply path improvements from `v0.3.4-beta.1`
  and `v0.3.4-beta.2`.

### Companion behaviour

- The companion emotion loop from `v0.3.4-beta.3` is included: recent user
  affect and real runtime events can shape tone and whether Nexus chooses a
  gentle check-in or stays quiet.
- 星绘 is the default Live2D face for fresh installs. Existing pet/avatar choices
  are preserved.
- Missed desktop-message context can be mentioned gently in a later
  conversation, within cooldown and quiet-time limits.

### Reply rendering and voice

- Short parenthetical stage directions are handled by shape, not by a fragile
  keyword list. Recognized expressions drive the avatar and are not shown or
  spoken; unrecognized asides render as quiet script notes instead of leaking
  as broken-looking chat text.
- Streaming speech also skips these asides, so Nexus does not read stage
  directions aloud mid-response.
- Local TTS support from the beta line remains available, with cloud TTS still
  required for some voice-note formats.

## Validation

- This stable promotion is based on the `v0.3.4-beta.4` code line.
- Local release verification should pass before tagging:
  `npm run verify:release` and `npm run prerelease-check -- v0.3.4 --quick`.
- No additional real-machine macOS Notification Center, Telegram, or Discord
  live validation was added after `v0.3.4-beta.4`. Treat those integrations as
  useful but still environment-sensitive.

## Known issues

- macOS desktop message awareness depends on Full Disk Access and Notification
  Center database readability. Permission prompts and OS privacy behaviour can
  vary by machine.
- Telegram voice-note replies still need a cloud TTS provider for mp3/ogg/m4a
  output. Local TTS outputs WAV.
- Discord inbound voice transcription is not included.
- Windows message awareness remains adapter/script based rather than a native
  Notification Center equivalent.
- Emotion behaviour is intentionally subtle and does not expose a dashboard.

## Notes and limitations

- **macOS unsigned build.** If Gatekeeper blocks first launch, right-click the
  app and choose Open. If quarantine metadata remains attached after manual
  download, remove it with `xattr -dr com.apple.quarantine /Applications/Nexus.app`.
- **Windows unsigned build.** SmartScreen may warn because the installer is not
  signed. Use More info -> Run anyway only if you downloaded the installer from
  the official GitHub release.
- Stable users on earlier releases can receive this through the stable update
  channel after the GitHub release is published.
