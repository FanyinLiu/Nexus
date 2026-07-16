import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readWorkspaceFile(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

const STYLE_IMPORTS = [
  "import '../styles/onboarding-guide-shell.css'",
  "import '../styles/onboarding-guide-responsive.css'",
  "import '../styles/onboarding-guide-calm.css'",
]

const STYLE_FILES = [
  'src/features/onboarding/styles/onboarding-guide-shell.css',
  'src/features/onboarding/styles/onboarding-guide-responsive.css',
  'src/features/onboarding/styles/onboarding-guide-calm.css',
]

const EAGER_STYLE_ENTRY_MODULES = [
  'src/app/main.tsx',
  'src/app/App.tsx',
]

function collectRelativeStyleImports(relativeModulePath: string, source: string) {
  return [...source.matchAll(/(?:import\s+|@import\s+)["']([^"']+\.css)["']/g)]
    .map((match) => posix.join(posix.dirname(relativeModulePath), match[1]))
}

function collectEagerStyleGraph() {
  const pending = EAGER_STYLE_ENTRY_MODULES.flatMap((entry) => (
    collectRelativeStyleImports(entry, readWorkspaceFile(entry))
  ))
  const styleFiles = new Set<string>()

  while (pending.length > 0) {
    const relativePath = pending.pop()
    if (!relativePath || styleFiles.has(relativePath)) continue
    styleFiles.add(relativePath)
    pending.push(...collectRelativeStyleImports(relativePath, readWorkspaceFile(relativePath)))
  }

  return [...styleFiles].sort()
}

test('OnboardingGuide owns its ordered lazy CSS boundary', () => {
  const app = readWorkspaceFile('src/app/App.tsx')
  const guide = readWorkspaceFile('src/features/onboarding/components/OnboardingGuide.tsx')

  assert.match(
    app,
    /const OnboardingGuide = lazy\(async \(\) => \{[\s\S]*?import\('\.\.\/features\/onboarding\/components\/OnboardingGuide'\)/,
  )

  let previousIndex = -1
  for (const styleImport of STYLE_IMPORTS) {
    const index = guide.indexOf(styleImport)
    assert.notEqual(index, -1, `missing lazy onboarding style import: ${styleImport}`)
    assert.ok(index > previousIndex, 'onboarding styles must retain shell, responsive, calm cascade order')
    previousIndex = index
  }

  assert.equal(
    [...guide.matchAll(/import '\.\.\/styles\/onboarding-guide-[^']+\.css'/g)].length,
    STYLE_IMPORTS.length,
    'OnboardingGuide should own exactly the three ordered CSS modules',
  )
})

test('every eager entry CSS source has no onboarding or disclosure selectors', () => {
  const eagerStyleFiles = collectEagerStyleGraph()

  assert.ok(eagerStyleFiles.includes('src/app/App.css'))
  assert.ok(eagerStyleFiles.includes('src/index.css'))
  assert.ok(eagerStyleFiles.length > 4, 'the boundary must cover the eager CSS graph, not only App.css')
  for (const relativePath of eagerStyleFiles) {
    const source = readWorkspaceFile(relativePath)
    assert.doesNotMatch(source, /\.onboarding-/, `${relativePath} must not eagerly own onboarding selectors`)
    assert.doesNotMatch(source, /\.ai-disclosure-/, `${relativePath} must not eagerly own disclosure selectors`)
    assert.doesNotMatch(source, /@keyframes\s+onboarding-/, `${relativePath} must not eagerly own onboarding keyframes`)
  }
})

test('onboarding CSS modules stay bounded and preserve their responsibilities', () => {
  const [shell, responsive, calm] = STYLE_FILES.map(readWorkspaceFile)

  for (const [index, source] of [shell, responsive, calm].entries()) {
    const lineCount = source.trimEnd().split('\n').length
    assert.ok(lineCount < 1_200, `${STYLE_FILES[index]} must stay below 1200 lines; got ${lineCount}`)
    assert.doesNotMatch(source, /\.settings-(?:drawer|page|relationship)/)
  }

  assert.match(shell, /\.onboarding-backdrop\s*\{/)
  assert.match(shell, /\.onboarding-card\s*\{/)
  assert.match(shell, /\.ai-disclosure-step\s*\{/)
  assert.match(responsive, /@media \(max-width: 620px\)/)
  assert.match(responsive, /\.onboarding-card--pet/)
  assert.match(calm, /\.onboarding-card\.onboarding-card--disclosure/)
  assert.match(calm, /\.onboarding-card\.onboarding-card--calm/)
})

test('Settings relationship chooser no longer depends on onboarding class names', () => {
  const relationship = readWorkspaceFile('src/components/settingsSections/chat/RelationshipPanel.tsx')
  const settingsSources = [
    relationship,
    readWorkspaceFile('src/app/styles/settings.css'),
    readWorkspaceFile('src/app/styles/settings-themes.css'),
    readWorkspaceFile('src/app/styles/settings-chat-aligned.css'),
    readWorkspaceFile('src/app/styles/settings-product-reference-final.css'),
    readWorkspaceFile('src/app/styles/settings-visual-system.css'),
  ].join('\n')

  assert.match(relationship, /className="settings-relationship__options"/)
  assert.match(relationship, /className=\{`settings-relationship__chip/)
  assert.doesNotMatch(settingsSources, /onboarding-relationship__/)
  assert.doesNotMatch(settingsSources, /\.onboarding-region-tabs(?:__[\w-]+)?/)
  assert.doesNotMatch(
    readWorkspaceFile('src/app/styles/settings-themes.css'),
    /\.onboarding-card/,
    'lazy settings CSS must not restyle the independently lazy onboarding dialog',
  )
})
