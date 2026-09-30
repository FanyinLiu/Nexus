import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findReadmeReleaseIssues } from '../scripts/lib/readme-release-contract.mjs'

const STABLE_VERSION = 'v1.2.3'
const BETA_VERSION = 'v1.2.4-beta.2'
const README_LABELS = {
  'README.md': '当前稳定版',
  'docs/README.zh-CN.md': '当前稳定版',
  'docs/README.zh-TW.md': '目前穩定版',
  'docs/README.ja.md': '現在の安定版',
  'docs/README.ko.md': '현재 안정 버전',
}

function notesPath(file: string, version = STABLE_VERSION) {
  return `${file === 'README.md' ? 'docs/' : ''}RELEASE-NOTES-${version}.md`
}

function createReadmeFixture(currentVersion = STABLE_VERSION): Record<string, string> {
  return Object.fromEntries(Object.entries(README_LABELS).map(([file, label]) => [file, `# Nexus

> **${label}：** ${STABLE_VERSION}; [release notes](${notesPath(file)}).

${currentVersion === STABLE_VERSION ? '' : `Candidate package: ${currentVersion} (beta, not stable).`}

## History

[Previous release](${notesPath(file, 'v1.2.2')})
[Stable release reference](${notesPath(file)})
`]))
}

function audit(readmeFiles: Record<string, string>, currentVersion = STABLE_VERSION) {
  return findReadmeReleaseIssues({ readmeFiles, currentVersion, stableVersion: STABLE_VERSION })
}

test('README release contract accepts five current stable entries with historical links', () => {
  assert.deepEqual(audit(createReadmeFixture()), [])
})

test('README release contract accepts a beta package while all five stable entries stay public', () => {
  assert.deepEqual(audit(createReadmeFixture(BETA_VERSION), BETA_VERSION), [])
})

for (const [file, label] of Object.entries(README_LABELS)) {
  test(`README release contract rejects ${file} top wrong target despite correct label and history`, () => {
    const fixture = createReadmeFixture()
    fixture[file] = fixture[file].replace(
      `[release notes](${notesPath(file)})`,
      `[RELEASE-NOTES-${STABLE_VERSION}.md](${notesPath(file, 'v1.2.2')})`,
    )

    assert.deepEqual(audit(fixture), [
      `${file} stable entry must link ${notesPath(file)} in its declaration paragraph`,
    ])
  })

  test(`README release contract rejects ${file} stale declaration despite correct notes and history`, () => {
    const fixture = createReadmeFixture()
    fixture[file] = fixture[file].replace(`**${label}：** ${STABLE_VERSION}`, `**${label}：** v1.2.2`)

    assert.deepEqual(audit(fixture), [`${file} stable entry is v1.2.2; expected ${STABLE_VERSION}`])
  })

  test(`README release contract rejects ${file} stable declaration only in history`, () => {
    const fixture = createReadmeFixture()
    fixture[file] = `# Nexus\n\n## History\n\n${fixture[file]}`

    assert.deepEqual(audit(fixture), [`${file} missing introductory ${label} declaration`])
  })

  test(`README release contract rejects ${file} beta promoted into the stable entry`, () => {
    const fixture = createReadmeFixture(BETA_VERSION)
    fixture[file] = fixture[file].replace(`**${label}：** ${STABLE_VERSION}`, `**${label}：** ${BETA_VERSION}`)

    assert.deepEqual(audit(fixture, BETA_VERSION), [
      `${file} stable entry is ${BETA_VERSION}; expected ${STABLE_VERSION}`,
    ])
  })
}

test('README release contract requires the link in the stable paragraph, not an adjacent paragraph', () => {
  const fixture = createReadmeFixture()
  fixture['README.md'] = fixture['README.md'].replace('; [release notes]', '\n\n[release notes]')

  assert.deepEqual(audit(fixture), [
    `README.md stable entry must link ${notesPath('README.md')} in its declaration paragraph`,
  ])
})

test('README release contract rejects a stale first link even with a correct reference in the same paragraph', () => {
  for (const file of Object.keys(README_LABELS)) {
    const fixture = createReadmeFixture()
    fixture[file] = fixture[file].replace(
      `[release notes](${notesPath(file)})`,
      `[release notes](${notesPath(file, 'v1.2.2')}); [reference](${notesPath(file)})`,
    )
    assert.deepEqual(audit(fixture), [
      `${file} stable entry must link ${notesPath(file)} in its declaration paragraph`,
    ])
  }
})

test('README release contract resolves the root and translated paths without accepting URL lookalikes', () => {
  for (const file of Object.keys(README_LABELS)) {
    for (const target of [
      `wrong/${notesPath(file)}`,
      `https://example.com/${notesPath(file)}`,
      `${notesPath(file)}.bak`,
    ]) {
      const fixture = createReadmeFixture()
      fixture[file] = fixture[file].replace(`(${notesPath(file)})`, `(${target})`)
      assert.equal(audit(fixture).length, 1, `${file}: ${target}`)
    }
  }
})

test('README release contract accepts wrapped declarations, CRLF, and release-note anchors', () => {
  const fixture = createReadmeFixture()
  for (const file of Object.keys(README_LABELS)) {
    fixture[file] = fixture[file]
      .replace('; [release notes]', ';\n> [release notes]')
      .replace(`(${notesPath(file)})`, `(${notesPath(file)}#highlights)`)
      .replaceAll('\n', '\r\n')
  }

  assert.deepEqual(audit(fixture), [])
})

test('README release contract requires clickable notes links, not images, code, or comments', () => {
  for (const file of Object.keys(README_LABELS)) {
    const link = `[release notes](${notesPath(file)})`
    for (const replacement of [`!${link}`, `\\${link}`, `\`${link}\``, `\`\`${link}\`\``, `<!-- ${link} -->`]) {
      const fixture = createReadmeFixture()
      fixture[file] = fixture[file].replace(link, replacement)
      assert.deepEqual(audit(fixture), [
        `${file} stable entry must link ${notesPath(file)} in its declaration paragraph`,
      ])
    }
  }
})

test('README release contract does not accept a stable-version prefix inside an invalid version', () => {
  const fixture = createReadmeFixture()
  fixture['README.md'] = fixture['README.md'].replace(`**当前稳定版：** ${STABLE_VERSION}`, `**当前稳定版：** ${STABLE_VERSION}oops`)

  assert.deepEqual(audit(fixture), ['README.md missing introductory 当前稳定版 declaration'])
})

test('README release contract retains the package-version mention requirement for beta preparation', () => {
  const fixture = createReadmeFixture(BETA_VERSION)
  fixture['README.md'] = fixture['README.md'].replace(`Candidate package: ${BETA_VERSION} (beta, not stable).`, '')

  assert.deepEqual(audit(fixture, BETA_VERSION), [`README.md missing current package version ${BETA_VERSION}`])
})
