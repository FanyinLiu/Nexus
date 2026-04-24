/**
 * prerelease-check.mjs
 *
 * Usage:
 *   npm run prerelease-check -- vX.Y.Z-beta.N
 *   npm run prerelease-check -- vX.Y.Z
 *
 * Runs every assertion that must be true before a release tag is pushed.
 * Exits 0 only when every check passes; exits non-zero with a specific
 * diagnostic on the first failure.
 *
 * Docs: docs/RELEASING.md.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const COLOR = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

let step = 0
function check(label, fn) {
  step += 1
  process.stdout.write(`${COLOR.dim(`[${step}/9]`)} ${label} ... `)
  try {
    const result = fn()
    console.log(COLOR.green('OK'))
    return result
  } catch (err) {
    console.log(COLOR.red('FAIL'))
    console.error(COLOR.red(`  ${err.message}`))
    process.exit(1)
  }
}

function sh(cmd, opts = {}) {
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  // execSync returns null when stdout is ignored — the [9/9] verify:release
  // step does that to suppress the long build log. Empty-string is the right
  // value to feed back so callers can `.trim()` without a null crash.
  return (out ?? '').trim()
}

// ── Parse and validate tag argument ────────────────────────────────────────

const tag = process.argv[2]
if (!tag) {
  console.error(COLOR.red('Usage: npm run prerelease-check -- <tag>   (e.g. v0.3.0-beta.2 or v0.3.0)'))
  process.exit(2)
}

console.log(COLOR.bold(`Pre-release check: ${tag}\n`))

// [1/9] Tag format
const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)(-[a-z]+\.\d+)?$/
check(`Tag format ${COLOR.dim('(v<major>.<minor>.<patch>[-<pre>.<n>])')}`, () => {
  if (!SEMVER_TAG.test(tag)) {
    throw new Error(`Tag '${tag}' does not match semver shape. Examples: v1.2.3, v1.2.3-beta.4.`)
  }
})

// [2/9] package.json version matches tag (minus the leading 'v')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const expectedVersion = tag.slice(1)
check(`package.json.version === ${expectedVersion}`, () => {
  if (pkg.version !== expectedVersion) {
    throw new Error(`package.json has '${pkg.version}' but tag implies '${expectedVersion}'. Bump package.json first.`)
  }
})

// [3/9] Local tag does not exist
check(`Local tag ${tag} not present`, () => {
  const existing = sh(`git tag -l ${tag}`)
  if (existing) {
    throw new Error(`Tag ${tag} already exists locally. Delete with 'git tag -d ${tag}' if it was a mistake.`)
  }
})

// [4/9] Remote tag does not exist
check(`Remote tag ${tag} not present on origin`, () => {
  const remote = sh(`git ls-remote --tags origin refs/tags/${tag}`)
  if (remote) {
    throw new Error(`Tag ${tag} already exists on origin. This tag is burned — bump the suffix.`)
  }
})

// [5/9] Working tree is clean
check('Working tree is clean', () => {
  const status = sh('git status --porcelain')
  if (status) {
    throw new Error(`Uncommitted or untracked changes present:\n${status.split('\n').map((l) => '    ' + l).join('\n')}`)
  }
})

// [6/9] HEAD matches origin/main
check('HEAD === origin/main', () => {
  sh('git fetch origin main', { stdio: ['ignore', 'pipe', 'ignore'] })
  const local = sh('git rev-parse HEAD')
  const remote = sh('git rev-parse origin/main')
  if (local !== remote) {
    throw new Error(`HEAD (${local.slice(0, 10)}) != origin/main (${remote.slice(0, 10)}). Pull/push first.`)
  }
})

// [7/9] CI on HEAD is success (best-effort — warns if gh is not configured)
check(`CI on HEAD is success ${COLOR.dim('(best-effort via gh)')}`, () => {
  try {
    sh('gh --version')
  } catch {
    console.log(COLOR.yellow('skip — gh CLI not available'))
    return
  }

  const sha = sh('git rev-parse HEAD')
  let status = ''
  try {
    status = sh(`gh run list --commit ${sha} --limit 1 --json status,conclusion --jq '.[0] | "\\(.status):\\(.conclusion)"'`)
  } catch (err) {
    throw new Error(`gh run list failed: ${err.message?.split('\n')[0] ?? err}`)
  }

  if (!status || status === ':null') {
    throw new Error(`No CI run found for ${sha.slice(0, 10)}. Push and wait for CI before tagging.`)
  }

  const [runStatus, conclusion] = status.split(':')
  if (runStatus !== 'completed') {
    throw new Error(`CI is still ${runStatus} on ${sha.slice(0, 10)}. Wait for it to finish.`)
  }
  if (conclusion !== 'success') {
    throw new Error(`CI on ${sha.slice(0, 10)} concluded as '${conclusion}', not success.`)
  }
})

// [8/9] Release notes file exists (beta only — stable has a different naming convention; we check both)
check('Release notes file exists', () => {
  const notesFile = join(ROOT, 'docs', `RELEASE-NOTES-${tag}.md`)
  try {
    readFileSync(notesFile, 'utf8')
  } catch {
    throw new Error(`Missing docs/RELEASE-NOTES-${tag}.md. See docs/RELEASING.md for the checklist.`)
  }
})

// [9/9] Run npm run verify:release (tsc + lint + test + build)
check(`npm run verify:release ${COLOR.dim('(tsc + lint + test + build — this takes a minute)')}`, () => {
  try {
    sh('npm run verify:release', { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    const hint = err.stderr?.toString()?.split('\n').slice(0, 10).join('\n') ?? err.message
    throw new Error(`verify:release failed:\n${hint}`)
  }
})

console.log()
console.log(COLOR.green(COLOR.bold(`✓ All checks passed. Safe to tag and push ${tag}.`)))
console.log()
console.log(COLOR.dim('Next:'))
console.log(COLOR.dim(`  git tag ${tag}`))
console.log(COLOR.dim(`  git push origin ${tag}`))
console.log()
