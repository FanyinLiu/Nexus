// README history can contain valid release links after the public entry goes
// stale. Only the introductory stable declaration owns that entry; candidate
// package versions may be documented separately without promoting them.

const STABLE_ENTRY_LABELS = {
  'README.md': '当前稳定版',
  'docs/README.zh-CN.md': '当前稳定版',
  'docs/README.zh-TW.md': '目前穩定版',
  'docs/README.ja.md': '現在の安定版',
  'docs/README.ko.md': '현재 안정 버전',
}

/**
 * Check the five README entry paragraphs against the public stable boundary.
 * Versions include their v prefix; currentVersion may identify a beta package.
 * Input texts are injected so regression fixtures never audit the working tree.
 */
export function findReadmeReleaseIssues({ readmeFiles, currentVersion, stableVersion }) {
  const issues = []
  for (const [file, label] of Object.entries(STABLE_ENTRY_LABELS)) {
    const text = readmeFiles[file] ?? ''
    if (!text.includes(currentVersion)) {
      issues.push(`${file} missing current package version ${currentVersion}`)
    }
    if (text.includes('v0.2.7')) {
      issues.push(`${file} should move v0.2.7 history to release notes or GitHub Releases`)
    }

    const introduction = text.split(/^##\s/m, 1)[0]
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/(`+)[\s\S]*?\1/g, '')
    const declaration = new RegExp(`^>\\s*\\*\\*${label}[:：]\\*\\*\\s*(v\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?(?:\\+[\\w.-]+)?)(?![\\w+-])`, 'm')
    const entry = introduction.split(/\r?\n\s*\r?\n/).find((paragraph) => declaration.test(paragraph))
    if (!entry) {
      issues.push(`${file} missing introductory ${label} declaration`)
      continue
    }

    const entryVersion = entry.match(declaration)[1]
    if (entryVersion !== stableVersion) {
      issues.push(`${file} stable entry is ${entryVersion}; expected ${stableVersion}`)
    }

    const notesPath = `${file === 'README.md' ? 'docs/' : ''}RELEASE-NOTES-${stableVersion}.md`
    const linkTargets = [...entry.matchAll(/(?<!!)(?<!\\)\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)]
      .map((match) => match[1].split('#')[0])
    // Later references in the same paragraph cannot repair a stale entry link.
    if (linkTargets[0] !== notesPath) {
      issues.push(`${file} stable entry must link ${notesPath} in its declaration paragraph`)
    }
  }
  return issues
}
