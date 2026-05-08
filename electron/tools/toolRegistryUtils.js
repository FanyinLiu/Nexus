import { checkUrlSafety } from '../services/urlSafety.js'

export function normalizeExternalUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) {
    throw new Error('链接不能为空。')
  }

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  const targetUrl = new URL(normalized)

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('目前只支持打开 http 或 https 链接。')
  }

  const safety = checkUrlSafety(targetUrl.toString(), { allowHttp: true })
  if (!safety.ok) {
    throw new Error(`拒绝打开不安全链接：${safety.reason}`)
  }

  return targetUrl.toString()
}
