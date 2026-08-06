/**
 * Tripwire for the `verify:pr` wiring: the chain must not reference npm
 * scripts or scripts/ files that do not exist, and every scripts/*-audit.mjs
 * on disk must either run inside `verify:pr` or carry a documented exclusion
 * below — so adding an audit script without gating it fails loudly.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Audit scripts that intentionally stay out of `verify:pr` because the PR
// gate never produces the artifacts or environment they inspect:
const VERIFY_PR_AUDIT_EXCLUSIONS = new Set([
  // Measures an electron-builder output directory; only runs inside
  // `package:dir:smoke` against a real packaged build.
  'scripts/package-size-audit.mjs',
  // Verifies built installers and latest*.yml metadata under release/;
  // nothing exists to audit until a release build runs.
  'scripts/release-artifact-audit.mjs',
  // Release-signing trust gate (release:unsigned:gate / release:signing:gate:*);
  // requires signing secrets and signed artifacts that only exist at release time.
  'scripts/release-trust-audit.mjs',
])

type PackageJson = { scripts?: Record<string, string> }

function readNpmScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageJson
  return pkg.scripts ?? {}
}

const NPM_RUN_RE = /npm run(?: -[a-z]+)* ([a-z0-9:-]+)/g
const SCRIPT_FILE_RE = /scripts\/[\w.-]+\.(?:mjs|cjs)/g

/**
 * Collect every scripts/*.{mjs,cjs} file a command executes, following nested
 * `npm run <name>` references so indirect wiring (e.g. image4:contract:check
 * running the visual-contract audit) resolves to the file that actually runs.
 */
function collectScriptFiles(
  command: string,
  scripts: Record<string, string>,
  missingScripts: Set<string>,
  seen = new Set<string>(),
): Set<string> {
  const files = new Set<string>()
  for (const match of command.matchAll(SCRIPT_FILE_RE)) {
    files.add(match[0])
  }
  for (const match of command.matchAll(NPM_RUN_RE)) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    const target = scripts[name]
    if (typeof target !== 'string') {
      missingScripts.add(name)
      continue
    }
    for (const file of collectScriptFiles(target, scripts, missingScripts, seen)) {
      files.add(file)
    }
  }
  return files
}

test('verify:pr only references npm scripts and scripts/ files that exist', () => {
  const scripts = readNpmScripts()
  const verifyPr = scripts['verify:pr']
  assert.ok(verifyPr, 'package.json must define a verify:pr script')

  const missingScripts = new Set<string>()
  const files = collectScriptFiles(verifyPr, scripts, missingScripts)
  assert.deepEqual(
    [...missingScripts],
    [],
    'verify:pr references npm scripts that do not exist in package.json',
  )
  assert.ok(files.size > 0, 'verify:pr should execute at least one scripts/ file')

  const missingFiles = [...files].filter((file) => !existsSync(join(ROOT, file)))
  assert.deepEqual(missingFiles, [], 'verify:pr references scripts/ files missing on disk')
})

test('verify:pr runs every scripts/*-audit.mjs except the documented exclusions', () => {
  const scripts = readNpmScripts()
  const files = collectScriptFiles(scripts['verify:pr'] ?? '', scripts, new Set())
  const chainAudits = new Set([...files].filter((file) => file.endsWith('-audit.mjs')))

  const diskAudits = readdirSync(join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('-audit.mjs'))
    .map((name) => `scripts/${name}`)

  const notWired = diskAudits.filter(
    (file) => !chainAudits.has(file) && !VERIFY_PR_AUDIT_EXCLUSIONS.has(file),
  )
  assert.deepEqual(
    notWired,
    [],
    'audit scripts on disk missing from verify:pr; wire them in or document the exclusion above',
  )

  // Exclusions rot silently: an entry deleted from disk or later wired into
  // the chain must be dropped from the list above.
  const staleExclusions = [...VERIFY_PR_AUDIT_EXCLUSIONS].filter(
    (file) => chainAudits.has(file) || !existsSync(join(ROOT, file)),
  )
  assert.deepEqual(staleExclusions, [], 'exclusion list entries that no longer apply')
})
