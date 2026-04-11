import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  collectSearchContentBodyLines,
  extractPagePreviewFromHtml,
  extractRelevantSegmentsFromHtml,
} from '../electron/searchContentExtract.js'

test('extractRelevantSegmentsFromHtml prefers query-matching body content over boilerplate blocks', () => {
  const html = `
    <html>
      <head>
        <meta name="description" content="Contact Microsoft Support for account help and customer service." />
      </head>
      <body>
        <header>Contact Microsoft Support</header>
        <main>
          <p>《黄昏》是周传雄演唱的代表作，歌词开头是“过完整个夏天”。</p>
          <p>这首歌围绕黄昏、回忆与失落感展开，是很多人熟悉的经典情歌。</p>
        </main>
        <footer>Privacy Policy</footer>
      </body>
    </html>
  `

  const segments = extractRelevantSegmentsFromHtml(html, '周传雄黄昏 歌词')

  assert.ok(segments.length >= 1)
  assert.ok(segments.some((segment) => segment.includes('周传雄')))
  assert.ok(segments.some((segment) => segment.includes('过完整个夏天')))
  assert.ok(segments.every((segment) => !/Contact Microsoft Support|Privacy Policy/i.test(segment)))
})

test('extractPagePreviewFromHtml joins the best正文 segments with line breaks', () => {
  const html = `
    <html>
      <body>
        <article>
          <p>Nexus 的浏览器工具会自动打开候选页，并从页面正文里提取可展示内容。</p>
          <p>这样返回给界面的不是一串链接，而是和搜索标题更贴合的内容摘要。</p>
        </article>
      </body>
    </html>
  `

  const preview = extractPagePreviewFromHtml(html, 'nexus 搜索结果展示')

  assert.match(preview, /自动打开候选页/)
  assert.match(preview, /不是一串链接/)
  assert.match(preview, /\n/)
})

test('collectSearchContentBodyLines deduplicates extracted preview lines and falls back to snippet', () => {
  const lines = collectSearchContentBodyLines([
    {
      contentPreview: '第一段正文\n第二段正文',
      snippet: '第一段正文',
    },
    {
      snippet: '第三段正文，来自摘要回退。',
    },
  ], 5)

  assert.deepEqual(lines, [
    '第一段正文',
    '第二段正文',
    '第三段正文，来自摘要回退。',
  ])
})
