#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DRAFT_RELEASES = ['0.4.2', '0.4.3', '0.4.4', '0.4.5']
const LOCALIZED_DRAFT_RELEASES = ['0.4.2', '0.4.3', '0.4.4', '0.4.5']
const STABLE_RELEASE = '0.4.1'
const OLD_README_RELEASE_SECTION_PATTERNS = [
  /##\s+(?:本次更新|此次更新)\s+—\s+v0\.3\.[0-5]/,
  /##\s+今回のアップデート\s+—\s+v0\.3\.[0-5]/,
  /##\s+이번 업데이트\s+—\s+v0\.3\.[0-5]/,
  /##\s+(?:上一稳定版|上一穩定版|一つ前の安定版|이전 안정 버전)\s+—\s+v0\.3\.[0-5]/,
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(root, path) {
  return JSON.parse(readText(root, path))
}

function normalize(text) {
  return text.replace(/\s+/g, ' ')
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text))
}

function pushMissing(list, file, phrase) {
  list.push({ file, phrase })
}

export function buildV04DraftStackReport(root = ROOT, options = {}) {
  const mode = options.mode === 'quick' ? 'quick' : 'full'
  const missingFiles = []
  const missingPhrases = []
  const forbiddenPhrases = []
  const versionMismatches = []

  const requireFile = (path) => {
    const fullPath = join(root, path)
    if (!existsSync(fullPath)) {
      missingFiles.push({ file: path })
      return ''
    }
    return readFileSync(fullPath, 'utf8')
  }

  const requirePhrase = (file, text, phrase) => {
    if (!normalize(text).includes(normalize(phrase))) pushMissing(missingPhrases, file, phrase)
  }

  const rejectPattern = (file, text, pattern, label) => {
    if (pattern.test(text)) forbiddenPhrases.push({ file, phrase: label })
  }

  const packageJson = readJson(root, 'package.json')
  if (packageJson.version !== STABLE_RELEASE) {
    versionMismatches.push({
      file: 'package.json',
      expected: STABLE_RELEASE,
      actual: packageJson.version,
    })
  }
  if (packageJson.private !== true) {
    versionMismatches.push({
      file: 'package.json',
      expected: 'private package',
      actual: 'public package',
    })
  }
  if (packageJson.scripts?.['v04:draft-stack:audit'] !== 'node scripts/v04-draft-stack-audit.mjs') {
    pushMissing(missingPhrases, 'package.json', 'v04:draft-stack:audit script')
  }
  if (packageJson.scripts?.['v04:draft-stack:audit:quick'] !== 'node scripts/v04-draft-stack-audit.mjs --quick') {
    pushMissing(missingPhrases, 'package.json', 'v04:draft-stack:audit:quick script')
  }
  if (!packageJson.scripts?.['verify:pr']?.includes('npm run v04:draft-stack:audit:quick')) {
    pushMissing(missingPhrases, 'package.json', 'verify:pr includes npm run v04:draft-stack:audit:quick')
  }

  const readmeFiles = [
    'README.md',
    'docs/README.zh-CN.md',
    'docs/README.zh-TW.md',
    'docs/README.ja.md',
    'docs/README.ko.md',
  ]
  for (const file of readmeFiles) {
    const text = requireFile(file)
    requirePhrase(file, text, 'RELEASE-NOTES-v0.4.1.md')
    for (const version of DRAFT_RELEASES) {
      rejectPattern(
        file,
        text,
        new RegExp(`RELEASE-NOTES-v${version.replaceAll('.', '\\.')}\\.md`),
        `README stable entry must not link v${version} release notes`,
      )
    }
    rejectPattern(
      file,
      text,
      /RELEASE-NOTES-v0\.3\.[0-5](?:-[\w.]+)?\.md/,
      'README should point older releases to CHANGELOG/Releases instead of old release-note links',
    )
    for (const pattern of OLD_README_RELEASE_SECTION_PATTERNS) {
      rejectPattern(
        file,
        text,
        pattern,
        'README should not expand old v0.3.x release sections above the stable entry',
      )
    }
  }

  if (mode === 'full') {
    for (const version of DRAFT_RELEASES) {
      const file = `docs/RELEASE-NOTES-v${version}.md`
      const text = requireFile(file)
      requirePhrase(file, text, 'Status: Draft')
      requirePhrase(file, text, 'Do not publish until')
      requirePhrase(file, text, 'No package version bump')
      requirePhrase(file, text, 'No tag or GitHub Release')
      requirePhrase(file, text, 'No README stable-entry switch')
      rejectPattern(file, text, /\bStable\b/, `v${version} release notes must not claim Stable`)
    }

    for (const version of LOCALIZED_DRAFT_RELEASES) {
      const file = `docs/RELEASE-NOTES-v${version}.zh-CN.md`
      const text = requireFile(file)
      requirePhrase(file, text, '草稿')
      if (!hasAny(text, [/不要发布/, /暂不发布/])) {
        pushMissing(missingPhrases, file, '不要发布 or 暂不发布')
      }
      requirePhrase(file, text, '不改 package 版本号')
      requirePhrase(file, text, '不打 tag，不创建 GitHub Release')
      requirePhrase(file, text, '不切换 README 稳定版入口')
      const escapedVersion = version.replaceAll('.', '\\.')
      rejectPattern(
        file,
        text,
        new RegExp(`v${escapedVersion}.{0,20}稳定版|稳定版.{0,20}v${escapedVersion}`),
        `v${version} localized release notes must not claim stable`,
      )
    }

    const v04Plan = requireFile('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md')
    requirePhrase(v04Plan ? 'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md' : '', v04Plan, 'active stacked v0.4.x slice after `v0.4.1` remains `v0.4.5` Release Hardening Draft')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'Do not publish `v0.4.5`')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'no new product behavior')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'multilingual numeric-unit, written-number, and half-unit leaks')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'invalid current and helper timestamps')
    requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, 'integer TTL bounds')

    const v042Notes = requireFile('docs/RELEASE-NOTES-v0.4.2.md')
    requirePhrase('docs/RELEASE-NOTES-v0.4.2.md', v042Notes, 'invalid current and helper timestamp suppression')
    requirePhrase('docs/RELEASE-NOTES-v0.4.2.md', v042Notes, 'passive in-app payload shape and integer TTL bounds')

    const v042LocalizedNotes = requireFile('docs/RELEASE-NOTES-v0.4.2.zh-CN.md')
    requirePhrase('docs/RELEASE-NOTES-v0.4.2.zh-CN.md', v042LocalizedNotes, '无效当前时间和辅助时间戳压制')
    requirePhrase('docs/RELEASE-NOTES-v0.4.2.zh-CN.md', v042LocalizedNotes, '被动 in-app payload 结构和整数 TTL 边界')

    const roadmap = requireFile('docs/ROADMAP.md')
    requirePhrase('docs/ROADMAP.md', roadmap, '`v0.4.5` is the active stacked release-hardening draft')
    requirePhrase('docs/ROADMAP.md', roadmap, 'no package version bump past the active stable, no future-draft tag, no future-draft GitHub Release, and no README stable-entry switch past `v0.4.1`')

    const changelog = requireFile('CHANGELOG.md')
    requirePhrase('CHANGELOG.md', changelog, 'v0.4.5 release hardening draft')
    requirePhrase('CHANGELOG.md', changelog, 'keeps package version, tag, GitHub Release, and README stable-entry state unchanged')

    const hardening = requireFile('docs/RELEASE-CANDIDATE-v0.4-HARDENING.md')
    requirePhrase('docs/RELEASE-CANDIDATE-v0.4-HARDENING.md', hardening, 'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md')

    const draftHardening = requireFile('docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md')
    for (const phrase of [
      'Status: Draft hardening handoff; not a release.',
      'No package version bump',
      'No tag',
      'No GitHub Release',
      'No README stable-entry switch',
      'v0.4.1 -> v0.4.0',
      'v0.4.2 -> v0.4.1',
      'v0.4.3 -> v0.4.2',
      'v0.4.4 -> v0.4.3',
      'v0.4.5 -> v0.4.1-v0.4.4',
      'npm run v04:draft-stack:audit',
      'npm run verify:release',
      'npm run package:dir:smoke',
    ]) {
      requirePhrase('docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md', draftHardening, phrase)
    }
    rejectPattern(
      'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
      draftHardening,
      /v0\.4\.5\s+stable|stable\s+v0\.4\.5|v0\.4\.5\s+is\s+now\s+stable/i,
      'draft hardening doc must not claim v0.4.5 stable',
    )
  }

  const checkedFiles = [
    'package.json',
    ...readmeFiles,
    ...(mode === 'full' ? [
      ...DRAFT_RELEASES.map((version) => `docs/RELEASE-NOTES-v${version}.md`),
      ...LOCALIZED_DRAFT_RELEASES.map((version) => `docs/RELEASE-NOTES-v${version}.zh-CN.md`),
      'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
      'docs/ROADMAP.md',
      'CHANGELOG.md',
      'docs/RELEASE-CANDIDATE-v0.4-HARDENING.md',
      'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
    ] : []),
  ]

  const errors = { missingFiles, missingPhrases, forbiddenPhrases, versionMismatches }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)
  return {
    schemaVersion: 1,
    mode,
    checkedFiles,
    draftReleases: DRAFT_RELEASES.map((version) => `v${version}`),
    stableRelease: `v${STABLE_RELEASE}`,
    privacy: {
      staticSourceOnly: true,
      readsUserData: false,
      readsEnvironment: false,
      readsNetwork: false,
      createsReleaseArtifacts: false,
    },
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
  }
}

export function summarizeV04DraftStackReport(report) {
  return report.summary
}

function formatHumanReport(report) {
  const lines = ['v0.4 draft stack audit']
  lines.push(`- mode: ${report.mode}`)
  lines.push(`- stable release: ${report.stableRelease}`)
  lines.push(`- draft releases: ${report.draftReleases.join(', ')}`)
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.privacy.staticSourceOnly}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      const details = items.slice(0, 8).map((item) => {
        const values = [item.file, item.phrase, item.expected && `expected ${item.expected}`, item.actual && `actual ${item.actual}`]
          .filter(Boolean)
          .join(': ')
        return values
      })
      lines.push(`  ${details.join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildV04DraftStackReport(ROOT, { mode: argv.includes('--quick') ? 'quick' : 'full' })
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
