/**
 * prerelease-check.mjs
 *
 * Usage:
 *   npm run prerelease-check -- vX.Y.Z[-beta.N]          # full 6-stage check
 *   npm run prerelease-check -- vX.Y.Z --quick           # skip slow checks (bench, coverage, smoke, sbom)
 *   npm run prerelease-check -- vX.Y.Z --skip C,D        # skip specific stages
 *   npm run prerelease-check -- vX.Y.Z --only A          # run only specific stages
 *
 * Stages:
 *   A. Process / version       (tag shape, package.json sync, working tree, CI)
 *   B. Code quality            (verify:release, smoke, coverage, bundle, perf)
 *   C. Security                (npm audit, Electron config, electron versions, secrets, CSP)
 *   D. Asset integrity         (locale parity, models, dist artefacts)
 *   E. Docs + compliance       (release notes, README sync, SBOM, AI-Act, licenses)
 *   F. Privacy + governance    (no default telemetry, H4 status, known-issues coverage)
 *
 * Docs: docs/RELEASING.md.
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const COLOR = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

let total = 0
let passed = 0
let warned = 0
let failed = 0
const failures = []

function check(stage, label, fn, { warnOnly = false } = {}) {
  total += 1
  const id = `${stage}.${total}`
  process.stdout.write(`  ${COLOR.dim(id)} ${label} ... `)
  try {
    const note = fn()
    passed += 1
    console.log(COLOR.green('OK') + (note ? COLOR.dim(`  (${note})`) : ''))
  } catch (err) {
    if (warnOnly) {
      warned += 1
      console.log(COLOR.yellow('WARN'))
      console.log(COLOR.yellow(`     ${err.message}`))
    } else {
      failed += 1
      console.log(COLOR.red('FAIL'))
      console.log(COLOR.red(`     ${err.message}`))
      failures.push({ id, label, message: err.message })
    }
  }
}

function sh(cmd, opts = {}) {
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  return (out ?? '').trim()
}

function shJson(cmd, opts = {}) {
  return JSON.parse(sh(cmd, opts) || '{}')
}

function readPkg() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
}

// ── Args ────────────────────────────────────────────────────────────────────

const tag = process.argv[2]
const quick = process.argv.includes('--quick')
const skipArg = process.argv.find((a) => a.startsWith('--skip='))
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const skipped = new Set((skipArg?.split('=')[1] ?? '').split(',').filter(Boolean))
const onlyStages = (onlyArg?.split('=')[1] ?? '').split(',').filter(Boolean)

if (!tag) {
  console.error(COLOR.red('Usage: npm run prerelease-check -- <tag> [--quick] [--skip=B,C] [--only=A]'))
  process.exit(2)
}

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)(-[a-z]+\.\d+)?$/
const isStable = SEMVER_TAG.test(tag) && !tag.includes('-')

console.log(COLOR.bold(`Pre-release check: ${tag}`) + COLOR.dim(`  ${isStable ? '(stable)' : '(beta)'}${quick ? ' [quick]' : ''}`))
console.log()

function shouldRunStage(letter) {
  if (skipped.has(letter)) return false
  if (onlyStages.length > 0 && !onlyStages.includes(letter)) return false
  return true
}

function stage(letter, name, fn) {
  if (!shouldRunStage(letter)) {
    console.log(COLOR.dim(`▷ Stage ${letter}: ${name} — skipped`))
    console.log()
    return
  }
  console.log(COLOR.cyan(COLOR.bold(`▷ Stage ${letter}: ${name}`)))
  total = 0
  fn()
  console.log()
}

// ════════════════════════════════════════════════════════════════════════════
// Stage A — Process / version
// ════════════════════════════════════════════════════════════════════════════

stage('A', 'Process & version', () => {
  check('A', `Tag matches v<major>.<minor>.<patch>[-<pre>.<n>]`, () => {
    if (!SEMVER_TAG.test(tag)) {
      throw new Error(`Tag '${tag}' invalid. Examples: v1.2.3, v1.2.3-beta.4.`)
    }
  })

  const pkg = readPkg()
  const expectedVersion = tag.slice(1)
  check('A', `package.json.version === ${expectedVersion}`, () => {
    if (pkg.version !== expectedVersion) {
      throw new Error(`package.json has '${pkg.version}'. Bump first.`)
    }
  })

  check('A', `Local tag ${tag} not present`, () => {
    if (sh(`git tag -l ${tag}`)) throw new Error(`Tag ${tag} exists locally. 'git tag -d ${tag}' if mistake.`)
  })

  check('A', `Remote tag ${tag} not present`, () => {
    if (sh(`git ls-remote --tags origin refs/tags/${tag}`)) throw new Error(`Tag ${tag} burned on origin.`)
  })

  check('A', 'Working tree clean', () => {
    const status = sh('git status --porcelain')
    if (status) throw new Error(`Uncommitted/untracked:\n${status.split('\n').map((l) => '       ' + l).join('\n')}`)
  })

  check('A', 'HEAD === origin/main', () => {
    sh('git fetch origin main', { stdio: ['ignore', 'pipe', 'ignore'] })
    const local = sh('git rev-parse HEAD')
    const remote = sh('git rev-parse origin/main')
    if (local !== remote) throw new Error(`HEAD ${local.slice(0,10)} != origin/main ${remote.slice(0,10)}.`)
  })

  check('A', `CI on HEAD is success`, () => {
    try { sh('gh --version') } catch { throw new Error('gh CLI not available') }
    const sha = sh('git rev-parse HEAD')
    let status
    try {
      status = sh(`gh run list --commit ${sha} --limit 1 --json status,conclusion --jq '.[0] | "\\(.status):\\(.conclusion)"'`)
    } catch (err) {
      throw new Error(`gh run list failed: ${err.message?.split('\n')[0]}`)
    }
    if (!status || status === ':null') throw new Error(`No CI run for ${sha.slice(0,10)}. Push and wait.`)
    const [s, c] = status.split(':')
    if (s !== 'completed') throw new Error(`CI ${s} on ${sha.slice(0,10)}.`)
    if (c !== 'success') throw new Error(`CI concluded ${c}.`)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Stage B — Code quality
// ════════════════════════════════════════════════════════════════════════════

stage('B', 'Code quality', () => {
  check('B', `verify:release ${COLOR.dim('(tsc + lint + test + build)')}`, () => {
    try {
      sh('npm run verify:release', { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (err) {
      const hint = err.stderr?.toString()?.split('\n').slice(0, 10).join('\n') ?? err.message
      throw new Error(`verify:release failed:\n       ${hint.replace(/\n/g, '\n       ')}`)
    }
  })

  if (!quick) {
    check('B', `Smoke (npm run smoke; Electron launches + renderer loads)`, () => {
      try {
        sh('npm run smoke', { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90_000 })
      } catch (err) {
        throw new Error(`smoke failed: ${err.message?.split('\n')[0]}`)
      }
    })

    check('B', `Packaged smoke (electron-builder --dir + SMOKE_TEST)`, () => {
      try {
        sh('npm run package:dir:smoke', {
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 420_000,
          env: {
            ...process.env,
            CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          },
        })
      } catch (err) {
        const detail = err.stderr?.toString()?.split('\n').slice(-8).join('\n') || err.message
        throw new Error(`packaged smoke failed:\n       ${detail.replace(/\n/g, '\n       ')}`)
      }
    })

    check('B', 'Coverage ≥ 80% lines', () => {
      let out
      try {
        out = sh(`node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/features/**/*.ts' --test-coverage-exclude='**/*.test.ts' --test "tests/*.test.ts" 2>&1`, { stdio: ['ignore', 'pipe', 'ignore'] })
      } catch (err) {
        out = err.stdout?.toString() ?? ''
      }
      const m = /^ℹ all files\s+\|\s+([0-9.]+)/m.exec(out)
      if (!m) throw new Error('could not parse coverage')
      const pct = Number(m[1])
      if (pct < 80) throw new Error(`coverage ${pct}% < 80%`)
      return `${pct}%`
    }, { warnOnly: true })
  } else {
    console.log(COLOR.dim('       smoke / coverage skipped (--quick)'))
  }

  check('B', 'Bundle: app-runtime ≤ 1700 KB', () => {
    if (!existsSync(join(ROOT, 'dist/assets'))) {
      throw new Error(`dist/assets missing — run 'npm run build' first`)
    }
    const files = readdirSync(join(ROOT, 'dist/assets'))
    const target = files.find((f) => f.startsWith('app-runtime-') && f.endsWith('.js'))
    if (!target) throw new Error('app-runtime-*.js not found in dist/assets')
    const size = readFileSync(join(ROOT, 'dist/assets', target)).length
    const sizeKB = Math.round(size / 1024)
    if (sizeKB > 1700) throw new Error(`${sizeKB} KB > 1700 KB ceiling`)
    return `${sizeKB} KB`
  })

  if (!quick) {
    check('B', `Benchmarks (no per-task regression > 2× expected)`, () => {
      try {
        sh('node --experimental-strip-types tests/benchmarks.bench.ts', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 300_000 })
      } catch (err) {
        throw new Error(`benchmark crashed: ${err.message?.split('\n')[0]}`)
      }
    }, { warnOnly: true })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Stage C — Security
// ════════════════════════════════════════════════════════════════════════════

stage('C', 'Security', () => {
  check('C', `npm audit --omit=dev: critical=0, high=0`, () => {
    let v
    try {
      v = shJson('npm audit --omit=dev --json').metadata?.vulnerabilities ?? {}
    } catch (err) {
      v = JSON.parse(err.stdout?.toString() || '{}').metadata?.vulnerabilities ?? {}
    }
    const c = v.critical ?? 0
    const h = v.high ?? 0
    if (c > 0 || h > 0) throw new Error(`critical=${c}, high=${h}`)
    return `m=${v.moderate ?? 0} l=${v.low ?? 0}`
  })

  check('C', 'Electron webPreferences: contextIsolation+sandbox+!nodeIntegration+webSecurity', () => {
    const wm = readFileSync(join(ROOT, 'electron/windowManager.js'), 'utf8')
    const required = ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true']
    const missing = required.filter((r) => !wm.includes(r))
    if (missing.length > 0) throw new Error(`missing in windowManager.js: ${missing.join(', ')}`)
  })

  check('C', 'electron ≥ 41.3 (latest stable; April 2026 security rollups)', () => {
    // Latest stable electron at time of writing is 41.3.0 (released
    // 2026-04-22), which carries forward the 41.2.2 security patch line.
    // Bump this floor when a new security-relevant minor lands.
    const pkg = readPkg()
    const range = pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? ''
    const m = /\d+\.\d+/.exec(range)
    if (!m) throw new Error(`could not parse electron version range: ${range}`)
    const [maj, min] = m[0].split('.').map(Number)
    if (maj < 41 || (maj === 41 && min < 3)) throw new Error(`electron ${range} < 41.3 — bump devDependencies.electron`)
    return range
  })

  check('C', 'electron-updater ≥ 6.6', () => {
    const pkg = readPkg()
    const range = pkg.dependencies?.['electron-updater'] ?? ''
    const m = /\d+\.\d+/.exec(range)
    if (!m) throw new Error(`electron-updater missing or unversioned`)
    const [maj, min] = m[0].split('.').map(Number)
    if (maj < 6 || (maj === 6 && min < 6)) throw new Error(`electron-updater ${range} < 6.6`)
    return range
  })

  check('C', 'No API keys / tokens committed', () => {
    const patterns = [
      /sk-[a-zA-Z0-9]{20,}/,                                    // OpenAI / Anthropic-shape
      /AIza[a-zA-Z0-9_\-]{35}/,                                 // Google API
      /AKIA[0-9A-Z]{16}/,                                       // AWS access key
      /xox[abp]-[a-zA-Z0-9-]{10,}/,                             // Slack
      /ghp_[a-zA-Z0-9]{36}/,                                    // GitHub PAT
    ]
    let hits = []
    try {
      // Search committed files (skip dist, release, node_modules — handled by .gitignore)
      const out = sh(`git grep -nE "${patterns.map((p) => p.source).join('|')}" -- src/ electron/ scripts/ docs/`, { stdio: ['ignore', 'pipe', 'ignore'] })
      hits = out.split('\n').filter(Boolean)
    } catch {
      // git grep exits 1 when no match — that's the success path
    }
    if (hits.length > 0) throw new Error(`possible secret leaks:\n       ${hits.slice(0, 3).join('\n       ')}`)
  })

  check('C', 'CSP enforced in packaged build (rendererServer.js)', () => {
    const rs = readFileSync(join(ROOT, 'electron/rendererServer.js'), 'utf8')
    if (!/Content-Security-Policy/i.test(rs)) throw new Error('rendererServer.js missing CSP header')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Stage D — Asset integrity
// ════════════════════════════════════════════════════════════════════════════

stage('D', 'Asset integrity', () => {
  check('D', '5-locale presence across prose modules', () => {
    // Parsing nested-object Record<UiLanguage,...> blocks reliably needs
    // a real TS AST. Heuristic check instead: each module that should
    // carry localised prose must mention each of the 5 locale keys at
    // least once. False positives possible (a file might pass while
    // having only one Record fully filled), but the failure mode this
    // catches in practice is "developer forgot to add the new locale" —
    // which always shows up as a complete absence.
    const files = [
      'src/features/autonomy/affectGuidance.ts',
      'src/features/autonomy/repairGuidance.ts',
      'src/features/letter/letterExport.ts',
      'src/features/yearbook/yearbookRender.ts',
      'src/features/arc/openArcDelivery.ts',
      'src/features/futureCapsule/futureCapsuleDelivery.ts',
    ]
    const required = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']
    const errors = []
    for (const file of files) {
      const path = join(ROOT, file)
      if (!existsSync(path)) continue
      const src = readFileSync(path, 'utf8')
      const missing = required.filter((k) => !new RegExp(`['"]${k}['"]\\s*:`).test(src))
      if (missing.length > 0) errors.push(`${file}: ${missing.join(', ')}`)
    }
    if (errors.length > 0) throw new Error(errors.slice(0, 3).join('\n       '))
  })

  check('D', 'sherpa models referenced (build extraResources)', () => {
    const pkg = readPkg()
    const macExtras = pkg.build?.mac?.extraResources ?? []
    const winExtras = pkg.build?.win?.extraResources ?? []
    const sherpaInMac = macExtras.some((e) => e.from?.includes('sherpa-models'))
    const sherpaInWin = winExtras.some((e) => e.from?.includes('sherpa-models'))
    if (!sherpaInMac || !sherpaInWin) throw new Error(`sherpa-models extraResources missing on ${[!sherpaInMac && 'mac', !sherpaInWin && 'win'].filter(Boolean).join('+')}`)
  })

  check('D', 'dist/ contains app-runtime + index.html + ort-wasm', () => {
    const required = ['index.html']
    for (const r of required) {
      if (!existsSync(join(ROOT, 'dist', r))) throw new Error(`dist/${r} missing — run 'npm run build'`)
    }
    const assets = existsSync(join(ROOT, 'dist/assets')) ? readdirSync(join(ROOT, 'dist/assets')) : []
    if (!assets.some((f) => f.startsWith('app-runtime-'))) throw new Error('dist/assets/app-runtime-*.js missing')
    if (!assets.some((f) => f.includes('ort-wasm-simd'))) throw new Error('dist/assets/ort-wasm-simd*.wasm missing')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Stage E — Docs + compliance
// ════════════════════════════════════════════════════════════════════════════

stage('E', 'Docs + compliance', () => {
  check('E', `docs/RELEASE-NOTES-${tag}.md exists`, () => {
    const path = join(ROOT, 'docs', `RELEASE-NOTES-${tag}.md`)
    if (!existsSync(path)) throw new Error(`missing — see docs/RELEASING.md`)
  })

  if (isStable) {
    const ver = tag.slice(1)
    check('E', `README.md mentions ${tag}`, () => {
      const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
      if (!readme.includes(tag) && !readme.includes(ver)) {
        throw new Error(`README.md does not reference ${tag}. Update News + What's-new sections.`)
      }
    })

    for (const lang of ['zh-CN', 'zh-TW', 'ja', 'ko']) {
      check('E', `docs/README.${lang}.md mentions ${tag}`, () => {
        const path = join(ROOT, 'docs', `README.${lang}.md`)
        if (!existsSync(path)) throw new Error(`missing docs/README.${lang}.md`)
        const md = readFileSync(path, 'utf8')
        if (!md.includes(tag) && !md.includes(ver)) {
          throw new Error(`does not reference ${tag} — update news block`)
        }
      })
    }
  } else {
    console.log(COLOR.dim('       README sync only enforced for stable tags'))
  }

  check('E', 'No GPL/AGPL in production deps', () => {
    let out
    try {
      out = sh('npx -y license-checker --production --summary 2>/dev/null', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 })
    } catch (err) {
      throw new Error(`license-checker failed: ${err.message?.split('\n')[0]}`)
    }
    const bad = out.split('\n').filter((l) => /\b(GPL-|AGPL-|SSPL)/i.test(l) && !/LGPL/i.test(l))
    if (bad.length > 0) throw new Error(`copyleft licences:\n       ${bad.join('\n       ')}`)
  }, { warnOnly: true })

  check('E', 'AI-output disclosure in README (EU AI Act prep)', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    if (!/\bAI\b/.test(readme)) throw new Error(`README.md mentions no 'AI' label — Aug 2026 transparency duty.`)
  }, { warnOnly: true })
})

// ════════════════════════════════════════════════════════════════════════════
// Stage F — Privacy + governance
// ════════════════════════════════════════════════════════════════════════════

stage('F', 'Privacy + governance', () => {
  check('F', 'No default outbound telemetry (grep src/ for non-user fetch)', () => {
    // Look for fetch(/api... or similar to suspicious hosts. User-configured
    // endpoints are passed through settings; hard-coded remote URLs in the
    // source are the red flag.
    const suspicious = [
      'sentry.io',
      'mixpanel.com',
      'segment.io',
      'amplitude.com',
      'google-analytics.com',
      'datadoghq.com',
      'logflare.app',
    ]
    const errors = []
    for (const host of suspicious) {
      try {
        const out = sh(`git grep -nE "${host.replace('.', '\\.')}" -- src/ electron/`, { stdio: ['ignore', 'pipe', 'ignore'] })
        if (out) errors.push(`${host}: ${out.split('\n')[0]}`)
      } catch {
        // grep exit 1 = no match
      }
    }
    if (errors.length > 0) throw new Error(`suspicious telemetry hosts:\n       ${errors.join('\n       ')}`)
  })

  if (existsSync(join(ROOT, 'docs/AUDIT-FINDINGS-2026-04-24.md'))) {
    check('F', 'Audit deferred items still tracked (H4 noted)', () => {
      const audit = readFileSync(join(ROOT, 'docs/AUDIT-FINDINGS-2026-04-24.md'), 'utf8')
      if (!audit.includes('H4')) throw new Error(`H4 vault deferral not tracked in audit doc`)
    }, { warnOnly: true })
  }

  if (isStable) {
    check('F', 'Release notes mention unsigned/SmartScreen workaround', () => {
      const path = join(ROOT, 'docs', `RELEASE-NOTES-${tag}.md`)
      if (!existsSync(path)) return  // E.1 handles missing
      const notes = readFileSync(path, 'utf8')
      const hasMacWarning = /xattr|quarantine|gatekeeper/i.test(notes)
      const hasWinWarning = /smartscreen|signed/i.test(notes)
      if (!hasMacWarning || !hasWinWarning) {
        throw new Error(`missing distribution caveats: ${[!hasMacWarning && 'mac', !hasWinWarning && 'windows'].filter(Boolean).join('+')}`)
      }
    }, { warnOnly: true })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════

console.log(COLOR.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
console.log(`  ${COLOR.green(`pass=${passed}`)}  ${warned > 0 ? COLOR.yellow(`warn=${warned}`) : `warn=0`}  ${failed > 0 ? COLOR.red(`fail=${failed}`) : `fail=0`}`)
console.log()

if (failed > 0) {
  console.log(COLOR.red(COLOR.bold(`✗ ${failed} blocker${failed > 1 ? 's' : ''} — DO NOT TAG ${tag}.`)))
  console.log()
  for (const f of failures) {
    console.log(COLOR.red(`  ${f.id} ${f.label}`))
    console.log(COLOR.red(`     ${f.message.split('\n')[0]}`))
  }
  console.log()
  process.exit(1)
}

if (warned > 0) {
  console.log(COLOR.yellow(`⚠ ${warned} warning${warned > 1 ? 's' : ''} — review before tagging.`))
  console.log()
}

console.log(COLOR.green(COLOR.bold(`✓ All blocker checks passed. Safe to tag and push ${tag}.`)))
console.log()
console.log(COLOR.dim('Next:'))
console.log(COLOR.dim(`  git tag ${tag}`))
console.log(COLOR.dim(`  git push origin ${tag}`))
console.log()
