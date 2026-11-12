import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function readDoc(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

const AUTHORIZED_ASSISTANCE_LINE =
  '- **授权辅助**：搜索、天气、提醒等只在你明确授权后工作，并且可确认、可停止、可审计。'

test('README installation section documents the manual Windows/Linux update path', () => {
  const readme = readDoc('README.md')

  assert.match(readme, /## 安装与更新/)
  assert.match(readme, /目前 Windows 和 Linux 没有自动更新/)
  assert.ok(!readme.includes('v0.5.2 的 Windows 和 Linux'))
  assert.match(readme, /官方 GitHub Releases 手动下载/)
  assert.match(readme, /SHA256SUMS-windows\.txt/)
  assert.match(readme, /SHA256SUMS-linux\.txt/)
  assert.match(readme, /应用不会自动下载、替换或重启安装。/)
  assert.ok(!readme.includes('latest.yml'))
  assert.ok(!readme.includes('要在同一版本里一起改'))
  assert.match(readme, /macOS arm64 未签名包同样不会自动替换应用/)
})

test('README keeps the authorized-assistance sentence unchanged', () => {
  assert.ok(readDoc('README.md').includes(AUTHORIZED_ASSISTANCE_LINE))
})

const LOCALIZED_MANUAL_UPDATE_LABELS = [
  [
    'docs/README.zh-CN.md',
    '目前 Windows 和 Linux 没有自动更新',
    'v0.5.2 的 Windows 和 Linux',
    '应用不会自动下载、替换或重启安装',
  ],
  [
    'docs/README.zh-TW.md',
    '目前 Windows 和 Linux 沒有自動更新',
    'v0.5.2 的 Windows 和 Linux',
    '應用程式不會自動下載、替換或重新啟動安裝',
  ],
  [
    'docs/README.ja.md',
    '現在、Windows と Linux には自動更新がありません',
    'v0.5.2 の Windows と Linux',
    'アプリが自動でダウンロード・置換・再起動することはありません',
  ],
  [
    'docs/README.ko.md',
    '현재 Windows와 Linux에는 자동 업데이트가 없습니다',
    'v0.5.2의 Windows와 Linux',
    '앱이 자동으로 내려받거나 교체하거나 다시 시작하지 않습니다',
  ],
] as const

for (const [file, noAutoUpdateLabel, staleVersionLabel, manualUpdateLabel] of LOCALIZED_MANUAL_UPDATE_LABELS) {
  test(`${file} documents the manual Windows/Linux update path`, () => {
    const readme = readDoc(file)

    assert.ok(readme.includes(noAutoUpdateLabel))
    assert.ok(!readme.includes(staleVersionLabel))
    assert.ok(readme.includes(manualUpdateLabel))
    assert.match(readme, /SHA256SUMS-windows\.txt/)
    assert.match(readme, /SHA256SUMS-linux\.txt/)
    assert.ok(!readme.includes('latest.yml'))
    assert.ok(!readme.includes('RELEASING.md'))
  })
}
