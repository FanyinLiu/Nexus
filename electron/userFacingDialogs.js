/**
 * Copy for native dialogs the main process shows on its own.
 * These strings are what the person sees. Diagnostics stay in the log.
 */

const DIALOG_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']

const CRASH_DIALOG_COPY = Object.freeze({
  'zh-CN': Object.freeze({
    title: 'Nexus 需要关闭',
    message: '出了点问题。聊天和设置还在这台电脑上。',
  }),
  'zh-TW': Object.freeze({
    title: 'Nexus 需要關閉',
    message: '出了點問題。聊天和設定還在這台電腦上。',
  }),
  'en-US': Object.freeze({
    title: 'Nexus needs to close',
    message: 'Something went wrong. Your chats and settings are still on this computer.',
  }),
  ja: Object.freeze({
    title: 'Nexus を終了します',
    message: '問題が起きました。チャットと設定はこのパソコンに残っています。',
  }),
  ko: Object.freeze({
    title: 'Nexus를 닫아야 해요',
    message: '문제가 생겼어요. 대화와 설정은 이 컴퓨터에 남아 있어요.',
  }),
})

const RENDERER_STUCK_DIALOG_COPY = Object.freeze({
  'zh-CN': Object.freeze({
    title: '这个窗口没有恢复',
    message: '聊天和设置还在这台电脑上。',
  }),
  'zh-TW': Object.freeze({
    title: '這個視窗沒有恢復',
    message: '聊天和設定還在這台電腦上。',
  }),
  'en-US': Object.freeze({
    title: 'This window did not recover',
    message: 'Your chats and settings are still on this computer.',
  }),
  ja: Object.freeze({
    title: 'このウィンドウは復旧できませんでした',
    message: 'チャットと設定はこのパソコンに残っています。',
  }),
  ko: Object.freeze({
    title: '이 창을 되돌리지 못했어요',
    message: '대화와 설정은 이 컴퓨터에 남아 있어요.',
  }),
})

const EXTERNAL_OPEN_DIALOG_COPY = Object.freeze({
  'zh-CN': Object.freeze({
    title: '打开这个链接？',
    message: 'Nexus 会在浏览器里打开它。',
    open: '打开',
    cancel: '取消',
  }),
  'zh-TW': Object.freeze({
    title: '開啟這個連結？',
    message: 'Nexus 會在瀏覽器裡開啟它。',
    open: '開啟',
    cancel: '取消',
  }),
  'en-US': Object.freeze({
    title: 'Open this link?',
    message: 'Nexus will open it in your browser.',
    open: 'Open',
    cancel: 'Cancel',
  }),
  ja: Object.freeze({
    title: 'このリンクを開きますか？',
    message: 'ブラウザで開きます。',
    open: '開く',
    cancel: 'キャンセル',
  }),
  ko: Object.freeze({
    title: '이 링크를 열까요?',
    message: '브라우저에서 엽니다.',
    open: '열기',
    cancel: '취소',
  }),
})

/**
 * Map an OS or app locale onto the five dialog languages.
 * Unknown values fall back to English.
 * @param {unknown} locale
 * @returns {'zh-CN'|'zh-TW'|'en-US'|'ja'|'ko'}
 */
export function normalizeDialogLocale(locale) {
  const value = String(locale ?? '').trim().toLowerCase().replace(/_/g, '-')
  if (value === 'zh-tw' || value === 'zh-hk' || value.startsWith('zh-hant')) return 'zh-TW'
  if (value.startsWith('zh')) return 'zh-CN'
  if (value.startsWith('ja')) return 'ja'
  if (value.startsWith('ko')) return 'ko'
  if (value === 'en' || value.startsWith('en-')) return 'en-US'
  if (DIALOG_LOCALES.includes(value)) return /** @type {'zh-CN'|'zh-TW'|'en-US'|'ja'|'ko'} */ (value)
  return 'en-US'
}

/**
 * @param {unknown} locale
 * @returns {{ title: string, message: string }}
 */
export function crashDialogCopy(locale) {
  return CRASH_DIALOG_COPY[normalizeDialogLocale(locale)]
}

/**
 * Shown when a window keeps failing and we stop reloading it.
 * The rest of the app stays open.
 * @param {unknown} locale
 * @returns {{ title: string, message: string }}
 */
export function rendererStuckDialogCopy(locale) {
  return RENDERER_STUCK_DIALOG_COPY[normalizeDialogLocale(locale)]
}

/**
 * @param {unknown} locale
 * @returns {{ title: string, message: string, open: string, cancel: string }}
 */
export function externalOpenDialogCopy(locale) {
  return EXTERNAL_OPEN_DIALOG_COPY[normalizeDialogLocale(locale)]
}
