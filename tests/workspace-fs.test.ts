import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  setWorkspaceRoot,
  writeWorkspaceFile,
} from '../electron/services/workspaceFs.js'

async function withWorkspace(fn: (root: string, outside: string) => Promise<void>) {
  const base = await mkdtemp(path.join(tmpdir(), 'nexus-workspace-fs-'))
  const root = path.join(base, 'root')
  const outside = path.join(base, 'outside')
  try {
    setWorkspaceRoot(root)
    await fn(root, outside)
  } finally {
    setWorkspaceRoot('')
    await rm(base, { recursive: true, force: true })
  }
}

describe('workspaceFs', () => {
  test('write rejects new files through an in-workspace symlink to outside', async (t) => {
    await withWorkspace(async (root, outside) => {
      await writeWorkspaceFile('seed.txt', 'ok')
      await mkdir(outside)
      try {
        await symlink(outside, path.join(root, 'outside-link'), 'dir')
      } catch (error) {
        if (process.platform === 'win32') {
          t.skip(`directory symlink unavailable on this Windows host: ${String(error)}`)
          return
        }
        throw error
      }

      await assert.rejects(
        () => writeWorkspaceFile('outside-link/new.txt', 'escape'),
        /resolves via symlink outside the workspace root/,
      )
      await assert.rejects(
        () => readFile(path.join(outside, 'new.txt'), 'utf8'),
        /ENOENT/,
      )
    })
  })

  test('write limit is enforced by UTF-8 bytes, not JavaScript character count', async () => {
    await withWorkspace(async () => {
      const oversized = '你'.repeat(Math.floor((1024 * 1024) / 3) + 1)
      await assert.rejects(
        () => writeWorkspaceFile('large.txt', oversized),
        /Content exceeds 1048576 byte write limit/,
      )
    })
  })
})
