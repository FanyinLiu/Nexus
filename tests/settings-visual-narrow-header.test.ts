import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import postcss, { type AtRule, type Rule } from 'postcss'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function declarationMap(rule: Rule) {
  return new Map(
    (rule.nodes ?? [])
      .filter((node) => node.type === 'decl')
      .map((declaration) => [declaration.prop, declaration.value]),
  )
}

function ruleInMedia(media: AtRule, selector: string) {
  let match: Rule | undefined
  media.walkRules((rule) => {
    if (rule.selector === selector) match = rule
  })
  assert.ok(match, `missing ${selector} in ${media.params}`)
  return declarationMap(match)
}

test('settings V2 preserves 44px controls while allowing narrow English headings to wrap', () => {
  const source = readFileSync(join(ROOT, 'src/features/uiV2/settings-v2.css'), 'utf8')
  const root = postcss.parse(source)
  const narrowMedia = root.nodes.find((node): node is AtRule => (
    node.type === 'atrule'
    && node.name === 'media'
    && node.params === '(max-width: 359px)'
  ))
  assert.ok(narrowMedia, 'missing <=359px settings header contract')

  const header = ruleInMedia(narrowMedia, '.settings-v2__header')
  assert.equal(header.get('grid-template-columns'), '44px minmax(0, 1fr) 44px')
  assert.equal(header.get('gap'), '4px')
  assert.equal(header.get('height'), 'auto')

  const back = ruleInMedia(narrowMedia, '.settings-v2__mobile-back')
  assert.equal(back.get('width'), '44px')
  assert.equal(back.get('max-width'), '44px')
  assert.equal(back.get('padding'), '0')
  assert.equal(ruleInMedia(narrowMedia, '.settings-v2__mobile-back span').get('display'), 'none')

  const heading = ruleInMedia(narrowMedia, '.settings-v2__heading h1')
  assert.equal(heading.get('overflow'), 'visible')
  assert.equal(heading.get('overflow-wrap'), 'break-word')
  assert.equal(heading.get('text-overflow'), 'clip')
  assert.equal(heading.get('white-space'), 'normal')

  let touchRule: Rule | undefined
  root.walkRules((rule) => {
    const declarations = declarationMap(rule)
    if (
      rule.selector.includes('.settings-v2__mobile-back')
      && rule.selector.includes('.settings-v2__close')
      && declarations.has('min-width')
      && declarations.has('min-height')
    ) {
      touchRule = rule
    }
  })
  assert.ok(touchRule, 'missing shared settings header touch-target rule')
  const touch = declarationMap(touchRule)
  assert.equal(touch.get('min-width'), '44px')
  assert.equal(touch.get('min-height'), '44px')
})

test('settings V2 home and detail share the stable shell height', () => {
  const source = readFileSync(join(ROOT, 'src/features/uiV2/settings-v2.css'), 'utf8')
  const visualAudit = readFileSync(join(ROOT, 'scripts/settings-visual-regression.mjs'), 'utf8')
  const root = postcss.parse(source)
  const rules = new Map<string, Map<string, string>>()
  root.nodes.forEach((node) => {
    if (node.type === 'rule') rules.set(node.selector, declarationMap(node))
  })

  const backdrop = rules.get('.settings-backdrop--v2:has(.settings-drawer--home.settings-drawer--v2)')
  assert.ok(backdrop, 'the V2 home backdrop override should remain explicit and home-only')
  assert.equal(backdrop.get('background'), 'transparent')
  assert.equal(backdrop.get('backdrop-filter'), 'none')

  const sectionDrawer = rules.get('.settings-drawer--v2')
  assert.ok(sectionDrawer, 'the shared V2 section drawer sizing should remain explicit')
  assert.equal(sectionDrawer.get('height'), 'min(680px, calc(100vh - 32px))')

  const sharedSurface = rules.get('.settings-drawer--v2 > .settings-v2')
  assert.ok(sharedSurface, 'the V2 home and detail surfaces should share one height contract')
  assert.equal(sharedSurface.get('height'), '100%')

  const homeSurface = rules.get(".settings-drawer--home.settings-drawer--v2 > .settings-v2[data-settings-v2-destination='home']")
  assert.ok(homeSurface, 'the home surface background should remain separately scoped')
  assert.equal(homeSurface.get('height'), undefined)
  assert.match(homeSurface.get('background') ?? '', /var\(--settings-v2-surface\) 94%/)

  const homeAutoHeightRules: string[] = []
  root.walkRules((rule) => {
    const isHomeRule = rule.selector.includes("data-settings-v2-destination='home'")
      || rule.selector.includes('settings-drawer--home.settings-drawer--v2')
    if (isHomeRule && declarationMap(rule).get('height') === 'auto') homeAutoHeightRules.push(rule.selector)
  })
  assert.deepEqual(homeAutoHeightRules, [])
  assert.match(
    visualAudit,
    /const allowsTransparentV2HomeBackdrop = expectedSectionId === 'home'[\s\S]*backdrop\.classList\.contains\('settings-backdrop--v2'\)[\s\S]*backdrop\.querySelector\('\.settings-drawer--home\.settings-drawer--v2'\)/,
    'transparent backdrop must be limited to the exact V2 settings home combination',
  )
  assert.match(
    visualAudit,
    /backdropStyle\.backgroundColor === 'rgba\(0, 0, 0, 0\)' && !allowsTransparentV2HomeBackdrop/,
    'non-V2-home transparent backdrops must remain visual audit failures',
  )
  assert.match(
    visualAudit,
    /async function backdropPixelsMatch\(page, screenshot, sectionId\)/,
    'backdrop pixel stability must receive the active section explicitly',
  )
  assert.match(
    visualAudit,
    /allowsTransparentV2HomeBackdrop: expectedSectionId === 'home'[\s\S]*backgroundColor === 'rgba\(0, 0, 0, 0\)'[\s\S]*backdrop\?\.classList\.contains\('settings-backdrop--v2'\)[\s\S]*backdrop\?\.querySelector\('\.settings-drawer--home\.settings-drawer--v2'\)/,
    'pixel matching may skip only an explicitly transparent V2 home backdrop',
  )
  assert.match(
    visualAudit,
    /if \(backdropState\.allowsTransparentV2HomeBackdrop\) return true/,
    'the transparent home exception must stay inside backdrop pixel matching',
  )
  assert.match(
    visualAudit,
    /captureStableScreenshot\(page, screenshotPath, section\.id\)/,
    'screenshot capture must pass the active section into pixel matching',
  )
})

test('settings visual audit exempts only clipped buttons inside contained horizontal scrollers', () => {
  const source = readFileSync(join(ROOT, 'scripts/settings-visual-regression.mjs'), 'utf8')
  assert.match(source, /const isContainedInlineScrollClip = \(element, rect\) =>/)
  assert.match(source, /element instanceof HTMLButtonElement/)
  assert.match(source, /overflowX === 'auto' \|\| overflowX === 'scroll'/)
  assert.match(source, /!escapesDrawerBounds\(ancestorRect\)/)
  assert.match(source, /horizontal scroll container escapes drawer bounds/)
  assert.match(source, /escapesDrawerBounds\(rect\) && !isContainedInlineScrollClip\(element, rect\)/)
  assert.doesNotMatch(source, /if\s*\(\s*element instanceof HTMLButtonElement\s*\)\s*continue/)
})

test('narrow settings tabs reveal the active tab without centering or snap-back', () => {
  const drawerSource = [
    readFileSync(join(ROOT, 'src/components/SettingsDrawer.tsx'), 'utf8'),
    readFileSync(join(ROOT, 'src/components/SettingsDrawerV2.tsx'), 'utf8'),
  ].join('\n')
  assert.doesNotMatch(drawerSource, /scrollIntoView\(/)
  assert.match(drawerSource, /getSettingsTabScrollLeft\(/)

  const source = readFileSync(join(ROOT, 'src/features/uiV2/settings-v2.css'), 'utf8')
  const root = postcss.parse(source)
  const mobileMedia = root.nodes.find((node): node is AtRule => {
    if (node.type !== 'atrule' || node.name !== 'media' || node.params !== '(max-width: 719px)') return false
    let containsTabs = false
    node.walkRules((rule) => { if (rule.selector === '.settings-v2__section-tabs') containsTabs = true })
    return containsTabs
  })
  assert.ok(mobileMedia, 'missing <=719px settings tabs contract')

  const tabs = ruleInMedia(mobileMedia, '.settings-v2__section-tabs')
  assert.equal(tabs.get('scroll-padding-inline'), '10px')
  assert.equal(tabs.get('scroll-snap-type'), 'none')

  const tab = ruleInMedia(mobileMedia, '.settings-v2__section-tabs button')
  assert.equal(tab.get('scroll-margin-inline'), '10px')
  assert.equal(tab.get('scroll-snap-align'), 'none')
})

test('settings V2 keeps shell clipping separate from the two scroll owners', () => {
  const source = readFileSync(join(ROOT, 'src/features/uiV2/settings-v2.css'), 'utf8')
  const visualAudit = readFileSync(join(ROOT, 'scripts/settings-visual-regression.mjs'), 'utf8')
  const root = postcss.parse(source)
  const rules = new Map<string, Map<string, string>>()
  root.nodes.forEach((node) => {
    if (node.type === 'rule') rules.set(node.selector, declarationMap(node))
  })

  assert.equal(rules.get('.settings-v2')?.get('overflow'), 'clip')
  assert.equal(rules.get('.settings-v2__content')?.get('overflow'), 'clip')
  assert.equal(rules.get('.settings-v2__section')?.get('overflow'), 'clip')
  assert.equal(rules.get('.settings-v2__active-section')?.get('overflow'), 'clip')
  assert.equal(rules.get('.settings-drawer--v2')?.get('overflow'), 'clip')
  assert.equal(rules.get('.settings-v2__home')?.get('overflow'), 'auto')
  assert.equal(rules.get('.settings-drawer--v2 .settings-v2__active-section > .settings-drawer__sections')?.get('overflow'), 'auto')
  assert.match(
    visualAudit,
    /getComputedStyle\(content\)\.overflowY !== 'clip'/,
    'visual audit must require the V2 shell to remain a non-scrollable clip boundary',
  )
  assert.doesNotMatch(
    visualAudit,
    /\['clip',\s*'hidden'\]/,
    'hidden must not be accepted because it can become a programmatic scroll container',
  )
  assert.match(
    visualAudit,
    /!\['auto',\s*'scroll'\]\.includes\(getComputedStyle\(sections\)\.overflowY\)/,
    'visual audit must keep active sections as the only vertical scroll owner',
  )
})

test('settings focus rings stay fully inside clipped V2 and V3 surfaces', () => {
  const v2Root = postcss.parse(readFileSync(join(ROOT, 'src/features/uiV2/settings-v2.css'), 'utf8'))
  const v3Root = postcss.parse(readFileSync(join(ROOT, 'src/features/settingsV3/settings-v3.css'), 'utf8'))

  function findRule(root: ReturnType<typeof postcss.parse>, selector: string) {
    let match: Rule | undefined
    root.walkRules((rule) => {
      if (rule.selector === selector && rule.parent?.type === 'root') match = rule
    })
    assert.ok(match, `missing ${selector}`)
    return declarationMap(match)
  }

  const headingFocus = findRule(
    v2Root,
    '.settings-drawer--v2 :is(h1, h2, h3, h4)[tabindex]:focus-visible',
  )
  assert.equal(headingFocus.get('outline'), '3px solid var(--nx-v2-focus-ring)')
  assert.equal(headingFocus.get('outline-offset'), '-3px')

  const disclosureFocus = findRule(
    v3Root,
    '.settings-v3-disclosure summary:focus-visible',
  )
  assert.equal(disclosureFocus.get('outline'), '3px solid var(--nx-v2-focus-ring)')
  assert.equal(disclosureFocus.get('outline-offset'), '-3px')

  for (const [root, selector] of [
    [v2Root, '.settings-drawer--v2 :is(h1, h2, h3, h4)[tabindex]:focus-visible'],
    [v3Root, '.settings-v3-page .settings-v3-disclosure summary:focus-visible'],
  ] as const) {
    const forcedColors = root.nodes.find((node): node is AtRule => {
      if (node.type !== 'atrule' || node.name !== 'media' || node.params !== '(forced-colors: active)') {
        return false
      }
      let containsFocusRule = false
      node.walkRules((rule) => { if (rule.selector === selector) containsFocusRule = true })
      return containsFocusRule
    })
    assert.ok(forcedColors, 'missing forced-colors focus treatment')
    const focus = ruleInMedia(forcedColors, selector)
    assert.equal(focus.get('outline'), '3px solid Highlight')
    assert.equal(focus.get('outline-offset'), '-3px')
  }
})

test('integration status metadata keeps its own narrow two-column contract', () => {
  const integrationSource = readFileSync(join(ROOT, 'src/features/settingsV3/IntegrationsSectionV3.tsx'), 'utf8')
  const statusList = integrationSource.match(/<div className="settings-v3-integration-status-list">([\s\S]*?)<\/div>/)?.[1]
  assert.ok(statusList, 'missing integration status list boundary')
  assert.equal([...statusList.matchAll(/<SettingsV3Row\b/g)].length, 5)

  const source = readFileSync(join(ROOT, 'src/features/settingsV3/integrations-section-v3.css'), 'utf8')
  const root = postcss.parse(source)
  const mobileMedia = root.nodes.find((node): node is AtRule => (
    node.type === 'atrule'
    && node.name === 'media'
    && node.params === '(max-width: 719px)'
  ))
  assert.ok(mobileMedia, 'missing <=719px integration status contract')

  const row = ruleInMedia(mobileMedia, '.settings-v3-integration-status-list .settings-v3-row')
  assert.equal(row.get('grid-template-columns'), 'minmax(0, 1fr) max-content')

  const meta = ruleInMedia(mobileMedia, '.settings-v3-integration-status-list .settings-v3-row__meta')
  assert.equal(meta.get('grid-column'), '2')
  assert.equal(meta.get('grid-row'), '1')
  assert.equal(meta.get('overflow-wrap'), 'normal')
  assert.equal(meta.get('white-space'), 'nowrap')
})
