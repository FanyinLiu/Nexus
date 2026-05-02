import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  buildPlatformProfile,
  isExecutableOnPath,
} from '../electron/platformProfile.js'

test('isExecutableOnPath finds executable files on PATH', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-platform-profile-'))
  const executableName = process.platform === 'win32' ? 'playerctl.cmd' : 'playerctl'
  const executable = path.join(directory, executableName)

  try {
    await writeFile(executable, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n')
    if (process.platform !== 'win32') {
      await chmod(executable, 0o755)
    }

    assert.equal(isExecutableOnPath('playerctl', {
      env: { PATH: directory, PATHEXT: '.CMD;.EXE' },
      platform: process.platform,
    }), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('buildPlatformProfile reports Linux media and active-window dependency gaps', () => {
  const profile = buildPlatformProfile({
    platform: 'linux',
    packaged: true,
    trayActive: true,
    env: { PATH: '', DISPLAY: '' },
    hasExecutable: () => false,
  })

  assert.equal(profile.startup.supported, true)
  assert.equal(profile.mediaSession.backend, 'playerctl')
  assert.equal(profile.mediaSession.available, false)
  assert.equal(profile.desktopContext.activeWindowAvailable, false)
  assert.equal(profile.desktopContext.activeWindowDependencyHint, 'xdotool/xprop + X11/XWayland DISPLAY')
  assert.equal(profile.desktopContext.screenshotAvailable, false)
  assert.equal(profile.desktopContext.clipboardAvailable, false)
  assert.equal(profile.voice.speechInputAvailable, true)
})

test('buildPlatformProfile enables Linux parity features when runtime dependencies exist', () => {
  const profile = buildPlatformProfile({
    platform: 'linux',
    packaged: false,
    env: { PATH: '/usr/bin', DISPLAY: ':0' },
    hasExecutable: (command) => command === 'playerctl' || command === 'xprop',
  })

  assert.equal(profile.startup.supported, false)
  assert.equal(profile.mediaSession.available, true)
  assert.equal(profile.desktopContext.activeWindowAvailable, true)
  assert.equal(profile.desktopContext.screenshotAvailable, true)
  assert.equal(profile.desktopContext.clipboardAvailable, true)
  assert.equal(profile.window.usesTaskbarIcon, true)
})

test('buildPlatformProfile keeps macOS desktop capabilities aligned by default', () => {
  const profile = buildPlatformProfile({
    platform: 'darwin',
    packaged: true,
    launchOnStartupEnabled: true,
    trayActive: false,
  })

  assert.equal(profile.startup.mechanism, 'login_item')
  assert.equal(profile.startup.enabled, true)
  assert.equal(profile.tray.hideToBackgroundOnClose, true)
  assert.equal(profile.mediaSession.backend, 'osascript')
  assert.equal(profile.mediaSession.available, true)
  assert.equal(profile.desktopContext.activeWindowAvailable, true)
  assert.equal(profile.voice.wakewordSupported, true)
})
