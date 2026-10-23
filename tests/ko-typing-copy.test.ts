import assert from 'node:assert/strict'
import { test } from 'node:test'

import { koSettingsWindow } from '../src/i18n/locales/ko/settings-window.ts'

/**
 * The Korean typing awareness group is written in 해요체 throughout: the
 * toggle hint, the explanation box and every status line the desktop
 * presence layer can show. These are the approved sentences.
 */
const TYPING_COPY: Record<string, string> = {
  'settings.window.typing_awareness_hint':
    '다른 앱에서 입력하는 동안 파트너가 반응해요. 기본값은 꺼져 있어요. 끄면 Nexus는 다른 앱에서의 키보드 입력을 감지하지 않아요. 어떤 키를 눌렀는지는 저장하거나 보내지 않고, 입력 여부와 대략적인 속도만 사용해요.',
  'settings.window.typing_explain_body':
    '이 컴퓨터의 키보드 활동을 보고 입력 중인지와 대략적인 속도를 알아내요. 누른 키는 저장하지 않고, 모델이나 네트워크로 보내지도 않아요. macOS에서는 시스템 설정에서 손쉬운 사용 또는 입력 모니터링을 허용해 주세요.',
  'settings.window.typing_permission_denied': '키보드 감지가 아직 허용되지 않았어요',
  'settings.window.typing_unavailable': '이 컴퓨터에서는 타이핑 감지를 쓸 수 없어요',
  'settings.window.typing_unavailable_hint':
    '키보드 감지 기능을 불러오지 못했어요. 앱은 그대로 쓸 수 있고, 타이핑 반응만 없어요.',
  'settings.window.typing_linux_wayland': 'Wayland에서는 키보드를 감지할 수 없어요',
  'settings.window.typing_linux_wayland_hint':
    '지금은 Wayland 세션이라 키보드 입력을 감지할 수 없어요. 시선 따라가기는 계속 돼요. 타이핑 감지는 X11 세션으로 로그인하면 쓸 수 있어요.',
  'settings.window.typing_linux_permission': '타이핑 감지에는 입력 장치 접근 권한이 필요해요',
  'settings.window.typing_linux_permission_hint':
    'Linux가 키보드 감지를 막았어요. 이 사용자에게 입력 장치 접근 권한이 필요해요(보통 input 그룹). 앱은 그대로 쓸 수 있고, 타이핑 반응만 없어요.',
  'settings.window.typing_linux_unavailable': 'Linux에서 타이핑 감지를 시작하지 못했어요',
  'settings.window.typing_linux_unavailable_hint':
    '키보드 감지를 시작하지 못했어요. Wayland 세션에서는 보통 막히고, X11에서는 입력 장치 권한이 없을 수도 있어요. 앱은 그대로 쓸 수 있고, 타이핑 반응만 없어요.',
  'settings.window.typing_status_off': '타이핑 감지가 꺼져 있어요',
}

test('the Korean typing awareness group uses the approved 해요체 sentences', () => {
  for (const [key, expected] of Object.entries(TYPING_COPY)) {
    assert.equal(koSettingsWindow[key as keyof typeof koSettingsWindow], expected, key)
  }
})

test('the Korean typing awareness group has no 합쇼체 ending left', () => {
  for (const key of Object.keys(TYPING_COPY)) {
    const value = koSettingsWindow[key as keyof typeof koSettingsWindow]
    assert.doesNotMatch(value, /합니다|습니다/, key)
  }
})

test('the Korean typing awareness group avoids developer wording', () => {
  for (const key of Object.keys(TYPING_COPY)) {
    const value = koSettingsWindow[key as keyof typeof koSettingsWindow]
    assert.doesNotMatch(value, /후크|hook/i, key)
  }
})
