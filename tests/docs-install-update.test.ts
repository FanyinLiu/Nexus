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
  assert.ok(!readme.includes('v0.5.1 的 Windows 和 Linux'))
  assert.match(readme, /官方 GitHub Releases 手动下载/)
  assert.match(readme, /SHA256SUMS-windows\.txt/)
  assert.match(readme, /SHA256SUMS-linux\.txt/)
  assert.match(readme, /macOS arm64 未签名包同样不会自动替换应用/)
})

test('README keeps the authorized-assistance sentence unchanged', () => {
  assert.ok(readDoc('README.md').includes(AUTHORIZED_ASSISTANCE_LINE))
})

const LOCALIZED_MANUAL_UPDATE_LABELS = [
  ['docs/README.zh-CN.md', '目前 Windows 和 Linux 没有自动更新', 'v0.5.1 的 Windows 和 Linux'],
  ['docs/README.zh-TW.md', '目前 Windows 和 Linux 沒有自動更新', 'v0.5.1 的 Windows 和 Linux'],
  ['docs/README.ja.md', '現在、Windows と Linux には自動更新がありません', 'v0.5.1 の Windows と Linux'],
  ['docs/README.ko.md', '현재 Windows와 Linux에는 자동 업데이트가 없습니다', 'v0.5.1의 Windows와 Linux'],
] as const

for (const [file, noAutoUpdateLabel, staleVersionLabel] of LOCALIZED_MANUAL_UPDATE_LABELS) {
  test(`${file} documents the manual Windows/Linux update path`, () => {
    const readme = readDoc(file)

    assert.ok(readme.includes(noAutoUpdateLabel))
    assert.ok(!readme.includes(staleVersionLabel))
    assert.match(readme, /SHA256SUMS-windows\.txt/)
    assert.match(readme, /SHA256SUMS-linux\.txt/)
  })
}
