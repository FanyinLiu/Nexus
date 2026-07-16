import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const memoryV3Source = readFileSync(
  new URL('../src/features/settingsV3/MemorySectionV3.tsx', import.meta.url),
  'utf8',
)

const localeContracts = [
  {
    name: 'en',
    source: readFileSync(new URL('../src/i18n/locales/en.ts', import.meta.url), 'utf8'),
    enabledLabel: 'Memory recall and learning',
    summary: /coarse companion summary/,
    decision: /local (?:decision|quiet\/check-in decision)/,
    lifecycle: /session\/expiry markers/,
    raw: /raw window titles.*raw signals/,
    condition: /may briefly/,
    clear: 'Clear recent companion data',
  },
  {
    name: 'zh-CN',
    source: readFileSync(new URL('../src/i18n/locales/zh-CN.ts', import.meta.url), 'utf8'),
    enabledLabel: '记忆召回和学习',
    summary: /粗粒度陪伴摘要/,
    decision: /本地决定/,
    lifecycle: /会话\/过期标记/,
    raw: /原始窗口标题.*原始信号/,
    condition: /可能短期/,
    clear: '清理近期陪伴数据',
  },
  {
    name: 'zh-TW',
    source: readFileSync(new URL('../src/i18n/locales/zh-TW.ts', import.meta.url), 'utf8'),
    enabledLabel: '記憶召回與學習',
    summary: /粗略的陪伴摘要/,
    decision: /本機決定/,
    lifecycle: /工作期間／到期標記/,
    raw: /原始視窗標題.*原始訊號/,
    condition: /可能短期/,
    clear: '清理近期陪伴資料',
  },
  {
    name: 'ja',
    source: readFileSync(new URL('../src/i18n/locales/ja.ts', import.meta.url), 'utf8'),
    enabledLabel: '記憶の呼び出しと学習',
    summary: /寄り添いの粗い要約/,
    decision: /ローカル判断/,
    lifecycle: /セッション・期限管理情報/,
    raw: /生のウィンドウタイトル.*元のシグナル/,
    condition: /ことがあります/,
    clear: '最近の寄り添いデータを消去',
  },
  {
    name: 'ko',
    source: readFileSync(new URL('../src/i18n/locales/ko.ts', import.meta.url), 'utf8'),
    enabledLabel: '기억 불러오기 및 학습',
    summary: /대략적인 동행 요약/,
    decision: /로컬 판단/,
    lifecycle: /세션·만료 표지/,
    raw: /원본 창 제목.*원본 신호/,
    condition: /잠시 저장될 수/,
    clear: '최근 동행 데이터 지우기',
  },
] as const

function readLocaleValue(source: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`'${escapedKey}': '([^']*)'`))
  assert.ok(match, `${key} should remain defined in the locale`)
  return match[1] ?? ''
}

test('Memory Settings V3 renders the complete companion transparency contract', () => {
  assert.match(memoryV3Source, /transparency\.companionAwarenessView/)
  assert.match(memoryV3Source, /companionTransparencyView\.statusLabelKey/)
  assert.match(memoryV3Source, /companionTransparencyView\.recentSummary\.labelKey/)
  assert.match(memoryV3Source, /companionTransparencyView\.detailRows\.map/)
  assert.match(memoryV3Source, /companionTransparencyView\.checkInStatus\.labelKey/)
  assert.match(memoryV3Source, /companionTransparencyView\.privacyBoundary\.labelKey/)
  assert.match(memoryV3Source, /clearRecentSummaryAction\.unavailableReason/)
})

test('Memory Settings V3 names the master checkbox by its enabled state and preserves value polarity', () => {
  assert.match(memoryV3Source, /checked=\{!draft\.memoryPaused\}/)
  assert.match(memoryV3Source, /label=\{ti\('settings\.memory\.transparency\.enabled_label'\)\}/)
  assert.match(memoryV3Source, /onChange=\{\(enabled\) => setDraft\(\(previous\) => \(\{ \.\.\.previous, memoryPaused: !enabled \}\)\)\}/)
  assert.doesNotMatch(memoryV3Source, /label=\{ti\('settings\.memory\.transparency\.pause'\)\}/)

  for (const locale of localeContracts) {
    assert.equal(
      readLocaleValue(locale.source, 'settings.memory.transparency.enabled_label'),
      locale.enabledLabel,
      locale.name,
    )
  }
})

test('Memory Settings V3 keeps recent companion state visible while paused', () => {
  assert.match(memoryV3Source, /return loadRecentCompanionSummary\(\)/)
  assert.match(memoryV3Source, /return loadRecentCompanionCheckInDecision\(\)/)
  assert.doesNotMatch(memoryV3Source, /if \(paused\) clearRecent\(\)/)
})

test('Memory Settings V3 leaves destructive cleanup to the real save boundary', () => {
  assert.doesNotMatch(memoryV3Source, /if \(!enabled\) clearRecent\(\)/)
  assert.doesNotMatch(memoryV3Source, /if \(draft\.contextAwarenessEnabled\) return/)
  assert.match(memoryV3Source, /onClick=\{clearRecent\}/)
})

test('Memory Settings V3 puts honest desktop transparency before long-term editing', () => {
  const continuity = memoryV3Source.indexOf("settings.memory.context.continuity_title")
  const sources = memoryV3Source.indexOf("settings.memory.context.sources_title")
  const longTerm = memoryV3Source.indexOf("memory_panel.category.long_term")
  assert.ok(continuity > 0 && sources > continuity && longTerm > sources)
  assert.match(memoryV3Source, /settings\.memory\.context\.reply_use_body/)
  assert.match(memoryV3Source, /settings\.memory\.context\.external_boundary_body/)
})

test('Memory Settings V3 resolves reduced motion before scrolling to focused memory', () => {
  const effectStart = memoryV3Source.indexOf('  useEffect(() => {\n    if (!focusedCount)')
  const effectEnd = memoryV3Source.indexOf('  }, [focusedCount])', effectStart)
  const effect = memoryV3Source.slice(effectStart, effectEnd)
  assert.ok(effectStart >= 0 && effectEnd > effectStart, 'focused memory scroll effect should remain explicit')
  assert.match(effect, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/)
  assert.match(effect, /behavior: prefersReducedMotion \? 'auto' : 'smooth'/)
})

test('Memory Settings V3 locale disclosures name all persisted categories without raw-content promises', () => {
  for (const locale of localeContracts) {
    const clearLabel = readLocaleValue(locale.source, 'settings.memory.context.clear_recent_summary')
    for (const key of [
      'settings.memory.context.local_storage_body',
      'settings.memory.context.transparency_storage',
    ]) {
      const disclosure = readLocaleValue(locale.source, key)
      assert.doesNotMatch(disclosure, /summary only|只保留摘要|僅保留摘要|短期間の要約のみ|짧게 유지되는 요약만/i, `${locale.name}:${key}`)
      assert.match(disclosure, locale.condition, `${locale.name}:${key}`)
      assert.match(disclosure, locale.summary, `${locale.name}:${key}`)
      assert.match(disclosure, locale.decision, `${locale.name}:${key}`)
      assert.match(disclosure, locale.lifecycle, `${locale.name}:${key}`)
      assert.match(disclosure, locale.raw, `${locale.name}:${key}`)
      assert.doesNotMatch(disclosure, /signalKeyPresent|signal key/i, `${locale.name}:${key}`)
    }
    assert.equal(clearLabel, locale.clear, locale.name)
  }
})
