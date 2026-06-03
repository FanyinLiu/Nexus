/**
 * Sandboxed filesystem service for the agent loop.
 *
 * Every operation is gated by a configured workspace root (set via
 * `workspaceFs:set-root`). Paths are normalized and verified to live
 * underneath the root before any read/write hits disk. The renderer
 * cannot escape the sandbox via `..`, absolute paths, or symlinks.
 *
 * Limits:
 *   - Reads cap at 256 KB to keep tool results manageable.
 *   - Writes cap at 1 MB.
 *   - Glob/grep walk caps at 5000 visited entries to bound runtime.
 */

import { readFile, writeFile, mkdir, stat, readdir, lstat, realpath } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'

const READ_LIMIT_BYTES = 256 * 1024
const WRITE_LIMIT_BYTES = 1024 * 1024
const WALK_LIMIT = 5000

let workspaceRoot = ''

export function setWorkspaceRoot(root) {
  if (typeof root !== 'string' || !root.trim()) {
    workspaceRoot = ''
    return
  }
  workspaceRoot = path.resolve(root.trim())
}

export function getWorkspaceRoot() {
  return workspaceRoot
}

function ensureRoot() {
  if (!workspaceRoot) {
    throw new Error('Workspace root not configured. Set it in Settings → Agent.')
  }
}

function resolveSafe(relPath) {
  ensureRoot()
  if (typeof relPath !== 'string') {
    throw new Error('Path must be a string')
  }
  const normalized = relPath.replace(/^[/\\]+/, '')
  const absolute = path.resolve(workspaceRoot, normalized)
  const rel = path.relative(workspaceRoot, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${relPath}" escapes the workspace root`)
  }

  // Resolve symlinks to detect escapes via symlink targets.
  // For new files, resolve the nearest existing ancestor so a path like
  // `link-to-outside/new.txt` cannot write through an in-workspace symlink.
  try {
    const realRoot = fs.realpathSync(workspaceRoot)
    const real = realpathExistingAncestor(absolute)
    const realRel = path.relative(realRoot, real)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error(`Path "${relPath}" resolves via symlink outside the workspace root`)
    }
  } catch (err) {
    // ENOENT on the root means the workspace has not been created yet. Keep
    // the lexical boundary check above, and mkdir/write will create it later.
    // Re-throw anything else (including our own escape error).
    if (err.code !== 'ENOENT') throw err
  }

  return absolute
}

function realpathExistingAncestor(absolutePath) {
  let current = absolutePath
  while (true) {
    try {
      return fs.realpathSync(current)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      const parent = path.dirname(current)
      if (parent === current) throw err
      current = parent
    }
  }
}

export async function readWorkspaceFile(relPath) {
  const abs = resolveSafe(relPath)
  const info = await stat(abs)
  if (!info.isFile()) {
    throw new Error(`Not a file: ${relPath}`)
  }
  if (info.size > READ_LIMIT_BYTES) {
    const buffer = await readFile(abs)
    return {
      path: relPath,
      content: buffer.subarray(0, READ_LIMIT_BYTES).toString('utf8'),
      truncated: true,
      bytes: info.size,
    }
  }
  const content = await readFile(abs, 'utf8')
  return { path: relPath, content, truncated: false, bytes: info.size }
}

export async function writeWorkspaceFile(relPath, content) {
  if (typeof content !== 'string') {
    throw new Error('Content must be a string')
  }
  if (Buffer.byteLength(content, 'utf8') > WRITE_LIMIT_BYTES) {
    throw new Error(`Content exceeds ${WRITE_LIMIT_BYTES} byte write limit`)
  }
  const abs = resolveSafe(relPath)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
  return { path: relPath, bytes: Buffer.byteLength(content, 'utf8') }
}

export async function editWorkspaceFile(relPath, oldString, newString) {
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    throw new Error('oldString and newString must be strings')
  }
  if (oldString === newString) {
    throw new Error('oldString and newString are identical')
  }
  const abs = resolveSafe(relPath)
  const original = await readFile(abs, 'utf8')
  const occurrences = original.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error(`oldString not found in ${relPath}`)
  }
  if (occurrences > 1) {
    throw new Error(
      `oldString matches ${occurrences} times in ${relPath} — provide more context to make it unique`,
    )
  }
  const updated = original.replace(oldString, newString)
  if (Buffer.byteLength(updated, 'utf8') > WRITE_LIMIT_BYTES) {
    throw new Error(`Resulting file exceeds ${WRITE_LIMIT_BYTES} byte write limit`)
  }
  await writeFile(abs, updated, 'utf8')
  return { path: relPath, bytes: Buffer.byteLength(updated, 'utf8'), occurrences }
}

function compileGlob(pattern) {
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*'
        i += 2
        if (pattern[i] === '/') i++
      } else {
        regex += '[^/]*'
        i++
      }
    } else if (c === '?') {
      regex += '[^/]'
      i++
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      regex += '\\' + c
      i++
    } else {
      regex += c
      i++
    }
  }
  return new RegExp('^' + regex + '$')
}

async function walk(rootAbs, onEntry, max = WALK_LIMIT) {
  const queue = [rootAbs]
  let visited = 0
  while (queue.length > 0 && visited < max) {
    const dir = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visited >= max) break
      visited++
      const full = path.join(dir, entry.name)
      // Skip hidden dirs and common heavy folders
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isDirectory()) {
        queue.push(full)
        continue
      }
      if (entry.isFile()) {
        await onEntry(full)
      }
    }
  }
  return { visited, hitLimit: visited >= max }
}

export async function globWorkspace(pattern) {
  ensureRoot()
  if (typeof pattern !== 'string' || !pattern) {
    throw new Error('Glob pattern is required')
  }
  const re = compileGlob(pattern)
  const matches = []
  const stats = await walk(workspaceRoot, async (full) => {
    const rel = path.relative(workspaceRoot, full).replaceAll(path.sep, '/')
    if (re.test(rel)) matches.push(rel)
  })
  return { pattern, matches: matches.slice(0, 200), totalMatched: matches.length, ...stats }
}

export async function grepWorkspace(query, options = {}) {
  ensureRoot()
  if (typeof query !== 'string' || !query) {
    throw new Error('Grep query is required')
  }
  const flags = options.caseSensitive ? '' : 'i'
  let re
  try {
    re = new RegExp(query, flags)
  } catch (error) {
    throw new Error(`Invalid grep regex: ${error?.message ?? String(error)}`)
  }
  const limit = Math.min(Math.max(Number(options.maxResults) || 50, 1), 200)
  const results = []
  const stats = await walk(workspaceRoot, async (full) => {
    if (results.length >= limit) return
    let info
    try {
      info = await lstat(full)
    } catch {
      return
    }
    if (!info.isFile() || info.size > READ_LIMIT_BYTES) return
    let content
    try {
      content = await readFile(full, 'utf8')
    } catch {
      return
    }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= limit) break
      if (re.test(lines[i])) {
        const rel = path.relative(workspaceRoot, full).replaceAll(path.sep, '/')
        results.push({ path: rel, line: i + 1, text: lines[i].slice(0, 200) })
      }
    }
  })
  return { query, matches: results, ...stats }
}
