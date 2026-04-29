// Localized crisis-helpline catalogue.
//
// ───────────────────────────────────────────────────────────────────
// VERIFY BEFORE EVERY RELEASE
// ───────────────────────────────────────────────────────────────────
// Crisis hotlines change. Numbers retire, services get renamed, hours
// shift. A wrong number in this file is more harmful than a missing
// one — someone reaching out for help and getting a dead line is the
// failure case we cannot afford.
//
// Each entry below documents (1) the canonical service name in the
// local language, (2) a primary contact number, (3) operating hours,
// and (4) the authoritative source URL where the entry was verified.
// On every release: re-fetch each `sourceUrl` and confirm the number
// + hours are unchanged. The release prerelease-check should grow a
// hotline-staleness check that opens an issue if the last verification
// timestamp is older than 90 days.
//
// Last manual verification pass: 2026-04-28 (Tier 1.1 build-out).
// ───────────────────────────────────────────────────────────────────

import type { AppLocale } from '../../types/i18n.ts'
import type { Hotline } from './types.ts'

/**
 * Hotlines per locale. The first entry is the primary one (24/7 where
 * available, government-affiliated where possible). Secondary entries
 * exist for regional coverage or fallbacks when the primary line is
 * busy / out of hours.
 */
export const HOTLINES: Record<AppLocale, Hotline[]> = {
  'en-US': [
    {
      // Federally administered, replaced 1-800-273-8255 in July 2022.
      // Three-digit dial, free, English + Spanish + 200+ languages via
      // interpreters, 24/7/365. Call or text 988; web chat available.
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      url: 'https://chat.988lifeline.org/',
      hoursLabel: '24/7, free, call or text',
      sourceUrl: 'https://988lifeline.org/',
    },
    {
      // EU-wide harmonised emotional-support number (Samaritans in UK,
      // partner orgs in other EU member states). Listed as the
      // fallback for English-speaking users physically in EU/UK who
      // cannot reach 988.
      name: 'Samaritans (UK / EU 116 123)',
      phone: '116 123',
      hoursLabel: '24 hours, every day',
      sourceUrl: 'https://www.samaritans.org/',
    },
  ],

  'zh-CN': [
    {
      // 国家卫生健康委 + 工信部 联合设置的全国统一心理援助热线，
      // 2025-01 起在 31 个省份分批开通；北京等地提供 24 小时服务。
      // 替代了之前各地分散的多条热线。
      name: '12356 全国统一心理援助热线',
      phone: '12356',
      hoursLabel: '每日 ≥18 小时（北京等地 24 小时）',
      sourceUrl: 'https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml',
    },
    {
      // 北京回龙观医院运行的心理援助热线，2002 年开通，公益免费。
      // 是 12356 出现之前最有公信力的全国可拨号码，目前仍在运营。
      name: '北京心理援助热线',
      phone: '800-810-1117',
      hoursLabel: '24 小时（座机；手机请拨 010-82951332）',
      sourceUrl: 'https://www.crisis.org.cn/',
    },
  ],

  'zh-TW': [
    {
      // 衛生福利部 24 小時免付費安心專線。2019-12-20 起單一使用 1925
      // （諧音「依舊愛我」），原 0800-788-995 已停用。
      name: '1925 安心專線（依舊愛我）',
      phone: '1925',
      hoursLabel: '24 小時，全年無休，免費',
      sourceUrl: 'https://www.mohw.gov.tw/cp-16-19209-1.html',
    },
  ],

  'ja': [
    {
      // 厚生労働省「まもろうよ こころ」で紹介されている 24 時間
      // フリーダイヤル。一般社団法人 社会的包摂サポートセンターが
      // 運営。死にたい・消えたい・生きることに疲れた等の感情に
      // 専門相談員が対応する。
      name: 'よりそいホットライン',
      phone: '0120-279-338',
      hoursLabel: '24 時間対応、無料',
      sourceUrl: 'https://www.mhlw.go.jp/mamorouyokokoro/soudan/tel/',
    },
    {
      // 全国の「いのちの電話」を統合するナビダイヤル。フリー
      // ダイヤル 0120-783-556 は時間限定（毎日 16:00–21:00）
      // のため、24h の場合はナビダイヤルを案内する。
      name: 'いのちの電話（ナビダイヤル）',
      phone: '0570-783-556',
      hoursLabel: '毎日 10:00 – 22:00（通話料金が発生）',
      sourceUrl: 'https://www.inochinodenwa.org/',
    },
  ],

  'ko': [
    {
      // 2024-01-01 자살예방상담전화는 1393 / 1577-0199 등이 109
      // 단일 번호로 통합되었다. 119 (응급) 와 같이 "긴급한 구조"
      // 의 의미로 자리매김.
      name: '109 자살예방상담전화',
      phone: '109',
      hoursLabel: '24 시간 무료 상담',
      sourceUrl: 'https://www.mohw.go.kr/board.es?mid=a10503010100&bid=0027&act=view&list_no=1479607',
    },
    {
      // 보건복지상담센터의 종합 상담 라인. 자살예방을 포함해 다양한
      // 복지 상담 가능. 109 가 통화 중일 때 대안.
      name: '보건복지상담센터 129',
      phone: '129',
      hoursLabel: '24 시간 운영',
      sourceUrl: 'https://www.129.go.kr/',
    },
  ],
}

/**
 * Convenience accessor — returns the first (primary) hotline for the
 * given locale, or `null` if the locale isn't covered.
 *
 * Most callers (panel, regulator-facing reminder text) want the
 * canonical entry; surfacing the full list is the panel UI's job.
 */
export function primaryHotline(locale: AppLocale): Hotline | null {
  const list = HOTLINES[locale]
  if (!list || list.length === 0) return null
  return list[0]
}
