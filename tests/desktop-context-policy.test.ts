import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  configureDesktopContextFlagStore,
  getSavedDesktopContextFlags,
  normalizeDesktopContextPolicy,
  saveDesktopContextFlags,
} from '../electron/services/desktopContextPolicy.js'

test('main ignores desktop-context flags the user has not saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-desktop-flags-'))
  configureDesktopContextFlagStore({
    getStorePath: () => join(dir, 'desktop-context-flags.json'),
  })

  const savedOff = getSavedDesktopContextFlags()
  assert.deepEqual(savedOff, {
    activeWindow: false,
    clipboard: false,
    screenshot: false,
  })

  const rendererEnablesEverything = {
    activeWindow: true,
    clipboard: true,
    screenshot: true,
  }
  assert.deepEqual(
    normalizeDesktopContextPolicy(rendererEnablesEverything, savedOff),
    savedOff,
  )
  assert.deepEqual(
    normalizeDesktopContextPolicy(undefined, savedOff),
    savedOff,
  )

  const saved = saveDesktopContextFlags({
    activeWindow: true,
    clipboard: false,
    screenshot: true,
  })
  assert.deepEqual(getSavedDesktopContextFlags(), saved)

  assert.deepEqual(
    normalizeDesktopContextPolicy(rendererEnablesEverything, saved),
    {
      activeWindow: true,
      clipboard: false,
      screenshot: true,
    },
  )
  // An omitted renderer policy still cannot raise a flag, and it keeps the
  // saved ones so the pet's active-window request continues to work.
  assert.deepEqual(normalizeDesktopContextPolicy(undefined, saved), {
    activeWindow: true,
    clipboard: false,
    screenshot: true,
  })
  assert.deepEqual(
    normalizeDesktopContextPolicy({
      activeWindow: false,
      clipboard: true,
      screenshot: false,
    }, saved),
    {
      activeWindow: false,
      clipboard: false,
      screenshot: false,
    },
  )
})
