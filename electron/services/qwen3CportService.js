/**
 * Pure-C Qwen3-TTS server: discovery, launch spec, and parent-death guard.
 *
 * The C port is preferred over the Python sidecar when its Metal binary and
 * the 1.7B CustomVoice checkpoint exist on this machine. It is a long-lived
 * resident server (~5 GB RSS, ~15 s cold start), so it must never outlive
 * Nexus. On POSIX we launch it through a tiny `/bin/sh` guard that blocks on
 * the parent's stdin pipe: when Electron exits — normally, by crash, or by
 * SIGKILL — the pipe closes, the guard wakes up and terminates the server.
 *
 * The module is dependency-injected so path resolution and launch-spec
 * building are testable without spawning the real 5 GB model.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Preferred ports, in order. The first free one is used. */
export const QWEN3_CPORT_PORTS = Object.freeze([8003, 8004, 8005])

/**
 * The guard blocks on stdin until the Electron parent closes it. A normal
 * quit kills the whole process group first; a crash/force-kill closes the pipe
 * and lands here. Both paths end with the server gone.
 */
export const PARENT_DEATH_GUARD_SCRIPT = [
  '"$@" &',
  'child=$!',
  'cat >/dev/null 2>&1',
  'kill -TERM "$child" 2>/dev/null',
  'sleep 0.2',
  'kill -KILL "$child" 2>/dev/null',
  'wait "$child" 2>/dev/null',
  'exit 0',
].join('\n')

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Resolve the C server binary, checkpoint, and candidate ports.
 *
 * `NEXUS_QWEN3_CPORT_BIN`, `NEXUS_QWEN3_CPORT_MODEL` and
 * `NEXUS_QWEN3_CPORT_PORT` override the defaults; `NEXUS_QWEN3_CPORT_DISABLE=1`
 * forces the Python sidecar (useful for debugging the fallback path).
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   homedir?: () => string,
 *   existsSync?: (filePath: string) => boolean,
 * }} [deps]
 * @returns {{
 *   available: boolean,
 *   binaryPath: string,
 *   modelDir: string,
 *   ports: number[],
 *   reason: string | null,
 * }}
 */
export function resolveQwen3CportConfig(deps = {}) {
  const env = deps.env ?? process.env
  const homedir = deps.homedir ?? os.homedir
  const existsSync = deps.existsSync ?? fs.existsSync

  const binaryPath = isNonEmptyString(env.NEXUS_QWEN3_CPORT_BIN)
    ? env.NEXUS_QWEN3_CPORT_BIN.trim()
    : path.join(homedir(), 'Models', 'qwen3-tts-c', 'src', 'qwen_tts')
  const modelDir = isNonEmptyString(env.NEXUS_QWEN3_CPORT_MODEL)
    ? env.NEXUS_QWEN3_CPORT_MODEL.trim()
    : path.join(homedir(), 'Models', 'qwen3-tts', 'Qwen3-TTS-12Hz-1.7B-CustomVoice')

  const forcedPort = Number(env.NEXUS_QWEN3_CPORT_PORT)
  const ports = Number.isInteger(forcedPort) && forcedPort > 0
    ? [forcedPort]
    : [...QWEN3_CPORT_PORTS]

  if (String(env.NEXUS_QWEN3_CPORT_DISABLE ?? '').trim() === '1') {
    return { available: false, binaryPath, modelDir, ports, reason: 'disabled by NEXUS_QWEN3_CPORT_DISABLE' }
  }

  const hasBinary = existsSync(binaryPath)
  const hasModel = existsSync(modelDir)
  return {
    available: hasBinary && hasModel,
    binaryPath,
    modelDir,
    ports,
    reason: hasBinary && hasModel
      ? null
      : `missing ${hasBinary ? 'model directory' : 'C binary'}`,
  }
}

/**
 * The fastest launch verified in RESULTS.md: Metal fused talker, int4, fixed
 * seed. Only the resident server is used — one-shot CLI mode peaks at 12 GB.
 *
 * @param {{ modelDir: string }} config
 * @param {number} port
 * @returns {string[]}
 */
export function buildQwen3CportArgs(config, port) {
  return [
    '-d', config.modelDir,
    '--int4',
    '--backend', 'metal',
    '--serve', String(port),
    '--seed', '42',
  ]
}

/**
 * Environment for the C server. `QWEN_METAL_FUSED_TALKER=1` is required for
 * the fast Metal path; without it the same binary uses a slower matvec seam.
 *
 * @param {Record<string, string | undefined>} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function buildQwen3CportEnv(baseEnv = process.env) {
  return { ...baseEnv, QWEN_METAL_FUSED_TALKER: '1' }
}

/**
 * Loopback-only base URL for a running C server.
 *
 * @param {number} port
 * @returns {string}
 */
export function buildQwen3CportBaseUrl(port) {
  return `http://127.0.0.1:${port}/v1`
}

/**
 * Wrap the server command in the parent-death guard.
 *
 * On Windows the POSIX-shell guard is unavailable; the caller spawns the
 * server directly and the normal quit path still group-kills it. The guard is
 * what covers crash/force-kill, so it is only claimed on POSIX.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ platform?: string }} [options]
 * @returns {{ command: string, args: string[], guarded: boolean }}
 */
export function buildParentDeathGuardLaunch(command, args, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    return { command, args: [...args], guarded: false }
  }
  return {
    command: '/bin/sh',
    args: ['-c', PARENT_DEATH_GUARD_SCRIPT, 'nexus-qwen3-guard', command, ...args],
    guarded: true,
  }
}

/**
 * Map a renderer language tag to a name the C server understands.
 *
 * The C table only knows full English names; an unknown value is ignored by
 * the server, which would silently fall back to the model default. Returning
 * undefined keeps the request honest (let the server use its default) instead
 * of sending a value that will be discarded.
 *
 * @param {unknown} language
 * @returns {string | undefined}
 */
export function mapQwen3CportLanguage(language) {
  const raw = String(language ?? '').trim().toLowerCase()
  if (!raw) return undefined
  if (/^(zh|cmn)/u.test(raw) || raw === '中文') return 'Chinese'
  if (/^en/u.test(raw) || raw === 'english') return 'English'
  if (/^ja/u.test(raw) || raw === '日本語') return 'Japanese'
  if (/^ko/u.test(raw) || raw === '한국어') return 'Korean'
  if (/^fr/u.test(raw) || raw === 'french') return 'French'
  if (/^de/u.test(raw) || raw === 'german') return 'German'
  if (/^es/u.test(raw) || raw === 'spanish') return 'Spanish'
  if (/^it/u.test(raw) || raw === 'italian') return 'Italian'
  if (/^pt/u.test(raw) || raw === 'portuguese') return 'Portuguese'
  if (/^ru/u.test(raw) || raw === 'russian') return 'Russian'
  return undefined
}
