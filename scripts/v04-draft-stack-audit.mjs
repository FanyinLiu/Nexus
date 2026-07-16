#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CURRENT_STABLE_RELEASE = '0.4.3'
const PREVIOUS_PUBLIC_RELEASE = '0.4.1'
const DRAFT_RELEASES = ['0.4.4', '0.4.5']
const LOCALIZED_DRAFT_RELEASES = ['0.4.4', '0.4.5']

function escapedVersion(version) {
  return version.replaceAll('.', '\\.')
}

function versionTag(version) {
  return `v${version}`
}

const CURRENT_STABLE_PATTERN = escapedVersion(CURRENT_STABLE_RELEASE)
const PREVIOUS_PUBLIC_PATTERN = escapedVersion(PREVIOUS_PUBLIC_RELEASE)
const README_BOUNDARY_PATTERNS = {
  'README.md': new RegExp(`当前稳定版\\s*[:：]?\\s*\\*{0,2}\\s*v${CURRENT_STABLE_PATTERN}`),
  'docs/README.zh-CN.md': new RegExp(`当前稳定版\\s*[:：]?\\s*\\*{0,2}\\s*v${CURRENT_STABLE_PATTERN}`),
  'docs/README.zh-TW.md': new RegExp(`目前穩定版\\s*[:：]?\\s*\\*{0,2}\\s*v${CURRENT_STABLE_PATTERN}`),
  'docs/README.ja.md': new RegExp(`現在の安定版\\s*[:：]?\\s*\\*{0,2}\\s*v${CURRENT_STABLE_PATTERN}`),
  'docs/README.ko.md': new RegExp(`현재 안정 버전\\s*[:：]?\\s*\\*{0,2}\\s*v${CURRENT_STABLE_PATTERN}`),
}
const STALE_README_CANDIDATE_PATTERNS = [
  /当前代码候选|目前程式碼候選|現在のコード候補|현재 코드 후보/,
  new RegExp(`(?:latest public release|latest public stable release)\\s*[:：]?\\s*v${PREVIOUS_PUBLIC_PATTERN}`, 'i'),
]
const OLD_README_RELEASE_SECTION_PATTERNS = [
  /##\s+(?:本次更新|此次更新)\s+—\s+v0\.3\.[0-5]/,
  /##\s+今回のアップデート\s+—\s+v0\.3\.[0-5]/,
  /##\s+이번 업데이트\s+—\s+v0\.3\.[0-5]/,
  /##\s+(?:上一稳定版|上一穩定版|一つ前の安定版|이전 안정 버전)\s+—\s+v0\.3\.[0-5]/,
]
const ENGLISH_CURRENT_STABLE_BOUNDARY = new RegExp(
  `(?:v${CURRENT_STABLE_PATTERN}\\s+is\\s+the\\s+current\\s+public\\s+stable\\s+release|current\\s+(?:public\\s+)?stable(?:\\s+release|\\s+version|\\s+entry\\s+point)?(?:\\s+is|\\s+on|\\s*:)?\\s+v${CURRENT_STABLE_PATTERN}|current\\s+public\\s+stable\\s+v${CURRENT_STABLE_PATTERN}\\s+release)`,
  'i',
)
const CHINESE_CURRENT_STABLE_BOUNDARY = new RegExp(
  `(?:当前公开稳定版(?:是|：|:)?\\s*v${CURRENT_STABLE_PATTERN}|当前稳定版(?:是|：|:)?\\s*v${CURRENT_STABLE_PATTERN}|公开稳定入口继续停留在\\s*v${CURRENT_STABLE_PATTERN})`,
)

function currentDraftPromotionPattern(version) {
  const escaped = escapedVersion(version)
  return new RegExp(
    `(?:\\bv${escaped}\\s+(?:(?:is|was|became|becomes)(?:\\s+now)?\\s+)?(?:the\\s+|a\\s+)?(?:stable|publicly\\s+released|released|published)\\b|\\b(?:stable|released|published)\\s+v${escaped}\\b)`,
    'i',
  )
}

function localizedDraftPromotionPattern(version) {
  const escaped = escapedVersion(version)
  return new RegExp(
    `(?:稳定(?:版|版本|入口)\\s*(?:(?:继续)?\\s*(?:停留在|是|为|：|:)\\s*)?v${escaped}|v${escaped}\\s*(?:是|为|已|正式)?\\s*(?:稳定(?:版|版本)|(?:公开)?发布(?!候选|而非|但未)))`,
  )
}

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

  const requirePattern = (file, text, pattern, phrase) => {
    if (!pattern.test(text)) pushMissing(missingPhrases, file, phrase)
  }

  const rejectPattern = (file, text, pattern, label) => {
    if (pattern.test(text)) forbiddenPhrases.push({ file, phrase: label })
  }

  const packageJson = readJson(root, 'package.json')
  if (packageJson.version !== CURRENT_STABLE_RELEASE) {
    versionMismatches.push({
      file: 'package.json',
      expected: CURRENT_STABLE_RELEASE,
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
    requirePattern(
      file,
      text,
      README_BOUNDARY_PATTERNS[file],
      `README must identify ${versionTag(CURRENT_STABLE_RELEASE)} as the current stable release`,
    )
    requirePattern(
      file,
      text,
      new RegExp(`\\[[^\\]]+\\]\\([^)]*RELEASE-NOTES-v${CURRENT_STABLE_PATTERN}\\.md(?:#[^)]*)?\\)`),
      `README stable entry must link RELEASE-NOTES-${versionTag(CURRENT_STABLE_RELEASE)}.md`,
    )
    for (const pattern of STALE_README_CANDIDATE_PATTERNS) {
      rejectPattern(file, text, pattern, 'README must not retain the pre-release code-candidate boundary')
    }
    for (const version of DRAFT_RELEASES) {
      rejectPattern(
        file,
        text,
        new RegExp(`RELEASE-NOTES-v${escapedVersion(version)}\\.md`),
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
    const stableNotesFile = `docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md`
    const stableNotes = requireFile(stableNotesFile)
    for (const phrase of [
      'Status: Stable unsigned release',
      `${versionTag(CURRENT_STABLE_RELEASE)} is the current stable version`,
      'formal release record',
      'protected tag workflow',
      'maintainer explicitly waived',
      'No multi-day or cross-platform physical-device evidence is claimed',
    ]) {
      requirePhrase(stableNotesFile, stableNotes, phrase)
    }
    for (const [pattern, label] of [
      [/Status:\s*Release candidate/i, 'stable release notes must not retain release-candidate status'],
      [/not a public release/i, 'stable release notes must not call v0.4.3 unpublished'],
      [/No tag or GitHub Release/i, 'stable release notes must not retain the no-release boundary'],
      [/No README stable-entry switch/i, 'stable release notes must not retain the pre-release README boundary'],
    ]) {
      rejectPattern(stableNotesFile, stableNotes, pattern, label)
    }

    const stableLocalizedFile = `docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.zh-CN.md`
    const stableLocalizedNotes = requireFile(stableLocalizedFile)
    for (const phrase of [
      '状态：正式未签名稳定版',
      `${versionTag(CURRENT_STABLE_RELEASE)} 是当前稳定版本`,
      '正式发行记录',
      '受保护的 tag 工作流',
      '明确豁免',
      '不会虚构多日使用或跨平台实体设备验证证据',
    ]) {
      requirePhrase(stableLocalizedFile, stableLocalizedNotes, phrase)
    }
    for (const [pattern, label] of [
      [/状态\s*[:：]\s*发布候选/, '中文稳定版说明不得保留发布候选状态'],
      [/尚未公开发布/, '中文稳定版说明不得称 v0.4.3 尚未公开发布'],
      [/不打 tag，不创建 GitHub Release/, '中文稳定版说明不得保留不发布边界'],
      [/不切换 README 稳定版入口/, '中文稳定版说明不得保留候选 README 边界'],
    ]) {
      rejectPattern(stableLocalizedFile, stableLocalizedNotes, pattern, label)
    }

    for (const version of DRAFT_RELEASES) {
      const file = `docs/RELEASE-NOTES-v${version}.md`
      const text = requireFile(file)
      requirePhrase(file, text, 'Status: Draft')
      requirePhrase(file, text, 'Do not publish until')
      requirePhrase(file, text, 'No package version bump')
      requirePhrase(file, text, 'No tag or GitHub Release')
      requirePhrase(file, text, 'No README stable-entry switch')
      requirePattern(
        file,
        text,
        ENGLISH_CURRENT_STABLE_BOUNDARY,
        `v${version} release notes must identify current stable ${versionTag(CURRENT_STABLE_RELEASE)}`,
      )
      rejectPattern(
        file,
        text,
        currentDraftPromotionPattern(version),
        `v${version} release notes must not claim the draft is stable or published`,
      )
      rejectPattern(
        file,
        text,
        new RegExp(`(?:local\\s+)?v${CURRENT_STABLE_PATTERN}\\s+code candidate|latest public(?: stable)?(?: release)?\\s+v${PREVIOUS_PUBLIC_PATTERN}`, 'i'),
        `v${version} release notes must not retain the superseded candidate boundary`,
      )
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
      requirePattern(
        file,
        text,
        CHINESE_CURRENT_STABLE_BOUNDARY,
        `v${version} 中文说明必须明确当前稳定版 ${versionTag(CURRENT_STABLE_RELEASE)}`,
      )
      rejectPattern(
        file,
        text,
        localizedDraftPromotionPattern(version),
        `v${version} localized release notes must not claim the draft is stable or published`,
      )
      rejectPattern(
        file,
        text,
        new RegExp(`本地代码候选\\s*v${CURRENT_STABLE_PATTERN}|最新公开稳定版\\s*v${PREVIOUS_PUBLIC_PATTERN}`),
        `v${version} localized release notes must not retain the superseded candidate boundary`,
      )
    }

    requirePhrase('docs/RELEASE-NOTES-v0.4.5.md', requireFile('docs/RELEASE-NOTES-v0.4.5.md'), 'Recorded local draft-hardening evidence')
    requirePhrase('docs/RELEASE-NOTES-v0.4.5.zh-CN.md', requireFile('docs/RELEASE-NOTES-v0.4.5.zh-CN.md'), '本地硬化证据')

    const v04Plan = requireFile('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md')
    for (const phrase of [
      `current public stable release ${versionTag(CURRENT_STABLE_RELEASE)}`,
      '`v0.4.5` Release Hardening Draft is a non-shipping review layer only',
      'Do not publish `v0.4.5`',
      'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
      'no new product behavior',
      'multilingual numeric-unit, written-number, and half-unit leaks',
      'invalid current and helper timestamps',
      'integer TTL bounds',
    ]) {
      requirePhrase('docs/V0.4_DESKTOP_COMPANION_AWARENESS.md', v04Plan, phrase)
    }
    rejectPattern(
      'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
      v04Plan,
      /local `?v0\.4\.3`? code candidate|v0\.4\.3[^\n]{0,80}not a public release/i,
      'desktop-awareness plan must not retain the v0.4.3 candidate boundary',
    )

    const optimizationPlanFile = 'docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md'
    const optimizationPlan = requireFile(optimizationPlanFile)
    requirePhrase(optimizationPlanFile, optimizationPlan, 'historical implementation and review plan')
    requirePhrase(
      optimizationPlanFile,
      optimizationPlan,
      'current public stable release is `' + versionTag(CURRENT_STABLE_RELEASE) + '`',
    )
    requirePhrase(optimizationPlanFile, optimizationPlan, '`v0.4.4` remains a draft')
    rejectPattern(
      optimizationPlanFile,
      optimizationPlan,
      /local code candidate|not publicly released/i,
      'v0.4.3 optimization plan must not retain the candidate release boundary',
    )

    const roadmap = requireFile('docs/ROADMAP.md')
    for (const phrase of [
      `current public stable release is ${versionTag(CURRENT_STABLE_RELEASE)}`,
      '`v0.4.4` remains a draft',
      '`v0.4.5` is a non-shipping release-hardening review layer',
      'package version, tag, GitHub Release, or README stable entry beyond',
    ]) {
      requirePhrase('docs/ROADMAP.md', roadmap, phrase)
    }
    rejectPattern(
      'docs/ROADMAP.md',
      roadmap,
      /local code candidate is v0\.4\.3|v0\.4\.3[^\n]{0,80}remains unpublished/i,
      'ROADMAP must not retain the v0.4.3 candidate boundary',
    )

    const changelog = requireFile('CHANGELOG.md')
    for (const phrase of [
      `## [${CURRENT_STABLE_RELEASE}] - 2026-07-16`,
      'v0.4.4 beta feedback and copy tuning draft',
      'v0.4.5 draft hardening evidence',
      'full v0.4 draft-stack audit',
      'The release commit is published only through the protected stable-tag workflow',
      'current stable release',
    ]) {
      requirePhrase('CHANGELOG.md', changelog, phrase)
    }
    const currentHeadingIndex = changelog.indexOf(`## [${CURRENT_STABLE_RELEASE}] - `)
    const previousHeadingIndex = changelog.indexOf(`## [${PREVIOUS_PUBLIC_RELEASE}] - `)
    if (currentHeadingIndex < 0 || previousHeadingIndex < 0 || currentHeadingIndex >= previousHeadingIndex) {
      pushMissing(missingPhrases, 'CHANGELOG.md', `${versionTag(CURRENT_STABLE_RELEASE)} dated release heading before ${versionTag(PREVIOUS_PUBLIC_RELEASE)}`)
    }
    rejectPattern(
      'CHANGELOG.md',
      changelog,
      /v0\.4\.3 code candidate|v0\.4\.3[^\n]{0,80}not publicly released/i,
      'CHANGELOG must not retain the v0.4.3 candidate boundary',
    )

    const hardening = requireFile('docs/RELEASE-CANDIDATE-v0.4-HARDENING.md')
    requirePhrase('docs/RELEASE-CANDIDATE-v0.4-HARDENING.md', hardening, 'RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md')

    const draftHardeningFile = 'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md'
    const draftHardening = requireFile(draftHardeningFile)
    for (const phrase of [
      'Status: Draft hardening handoff; not a release.',
      `current public stable release ${versionTag(CURRENT_STABLE_RELEASE)}`,
      '`v0.4.3` remains the current public stable release entry point',
      '`v0.4.4` and `v0.4.5` remain stacked draft review layers',
      'No package version bump',
      'No tag',
      'No GitHub Release',
      'No README stable-entry switch',
      'v0.4.4 -> v0.4.3',
      'v0.4.5 -> v0.4.3-v0.4.4',
      'npm run v04:draft-stack:audit',
      'npm run verify:release',
      '## Evidence Collected',
    ]) {
      requirePhrase(draftHardeningFile, draftHardening, phrase)
    }
    rejectPattern(
      draftHardeningFile,
      draftHardening,
      /latest public release v0\.4\.1|local code candidate v0\.4\.3|v0\.4\.3 is a release candidate/i,
      'v0.4.5 hardening handoff must not retain the superseded candidate boundary',
    )
    rejectPattern(
      draftHardeningFile,
      draftHardening,
      /v0\.4\.5\s+stable|stable\s+v0\.4\.5|v0\.4\.5\s+is\s+now\s+stable/i,
      'draft hardening doc must not claim v0.4.5 stable',
    )

    const stableHandoffFile = `docs/RELEASE-CANDIDATE-v${CURRENT_STABLE_RELEASE}-HANDOFF.md`
    const stableHandoff = requireFile(stableHandoffFile)
    for (const phrase of [
      `# Nexus ${versionTag(CURRENT_STABLE_RELEASE)} Stable Release Handoff`,
      'Status: Stable unsigned release handoff.',
      `${versionTag(CURRENT_STABLE_RELEASE)} is the current stable version`,
      'maintainer explicitly waived',
      'No multi-day conversation evidence',
      'protected tag workflow',
      'v0.4.4/v0.4.5 drafts',
    ]) {
      requirePhrase(stableHandoffFile, stableHandoff, phrase)
    }
  }

  const checkedFiles = [
    'package.json',
    ...readmeFiles,
    ...(mode === 'full' ? [
      `docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.md`,
      `docs/RELEASE-NOTES-v${CURRENT_STABLE_RELEASE}.zh-CN.md`,
      ...DRAFT_RELEASES.map((version) => `docs/RELEASE-NOTES-v${version}.md`),
      ...LOCALIZED_DRAFT_RELEASES.map((version) => `docs/RELEASE-NOTES-v${version}.zh-CN.md`),
      'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
      'docs/V0.4.3_OPTIMIZATION_AND_COMPETITOR_PLAN_2026-07-12.md',
      'docs/ROADMAP.md',
      'CHANGELOG.md',
      `docs/RELEASE-CANDIDATE-v${CURRENT_STABLE_RELEASE}-HANDOFF.md`,
      'docs/RELEASE-CANDIDATE-v0.4-HARDENING.md',
      'docs/RELEASE-CANDIDATE-v0.4.5-DRAFT-HARDENING.md',
    ] : []),
  ]

  const errors = { missingFiles, missingPhrases, forbiddenPhrases, versionMismatches }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)
  return {
    schemaVersion: 3,
    mode,
    checkedFiles,
    currentStableRelease: versionTag(CURRENT_STABLE_RELEASE),
    previousPublicRelease: versionTag(PREVIOUS_PUBLIC_RELEASE),
    draftReleases: DRAFT_RELEASES.map(versionTag),
    releaseState: 'stable',
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
  lines.push(`- current stable release: ${report.currentStableRelease}`)
  lines.push(`- previous public release: ${report.previousPublicRelease}`)
  lines.push(`- draft releases: ${report.draftReleases.join(', ')}`)
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.privacy.staticSourceOnly}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      const details = items.slice(0, 8).map((item) => [
        item.file,
        item.phrase,
        item.expected && `expected ${item.expected}`,
        item.actual && `actual ${item.actual}`,
      ].filter(Boolean).join(': '))
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
