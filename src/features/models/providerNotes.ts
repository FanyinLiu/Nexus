import { normalizeUiLanguage, resolveLocalizedText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import type { ApiProviderPreset } from './providerCatalog'

function fillTemplate(template: string, params: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`)
}

function baseProviderNote(provider: ApiProviderPreset, uiLanguage: UiLanguage) {
  if (normalizeUiLanguage(uiLanguage) === 'en-US') {
    return provider.notes
  }

  const copy = provider.id === 'ollama'
    ? {
        'zh-CN': '{provider} 本地预设。默认本地服务不需要接口密钥。',
        'zh-TW': '{provider} 本地預設。預設本地服務不需要介面密鑰。',
        'en-US': '{provider} local preset. The default local server does not require an API key.',
        ja: '{provider} のローカルプリセット。デフォルトのローカルサービスは API キー不要です。',
        ko: '{provider} 로컬 프리셋입니다. 기본 로컬 서버는 API 키가 필요 없습니다.',
      }
    : provider.id === 'custom'
      ? {
          'zh-CN': '可接入任意 OpenAI 兼容网关、代理或本地服务。',
          'zh-TW': '可接入任意 OpenAI 相容閘道、代理或本地服務。',
          'en-US': 'Use any OpenAI-compatible gateway, proxy, or local server.',
          ja: 'OpenAI 互換のゲートウェイ、プロキシ、ローカルサーバーを接続できます。',
          ko: 'OpenAI 호환 게이트웨이, 프록시 또는 로컬 서버를 연결할 수 있습니다.',
        }
      : provider.region === 'china'
        ? {
            'zh-CN': '{provider} 预设，适合国内网络环境。',
            'zh-TW': '{provider} 預設，適合中國大陸網路環境。',
            'en-US': '{provider} preset for mainland China network environments.',
            ja: '{provider} プリセット。中国本土のネットワーク環境に向いています。',
            ko: '{provider} 프리셋입니다. 중국 본토 네트워크 환경에 적합합니다.',
          }
        : {
            'zh-CN': '{provider} 预设，适合官方云端接口。',
            'zh-TW': '{provider} 預設，適合官方雲端介面。',
            'en-US': '{provider} preset for the official cloud API.',
            ja: '{provider} プリセット。公式クラウド API 向けです。',
            ko: '{provider} 프리셋입니다. 공식 클라우드 API에 적합합니다.',
          }

  return fillTemplate(resolveLocalizedText(uiLanguage, copy), { provider: provider.label })
}

function providerEndpointNote(endpoint: string, uiLanguage: UiLanguage) {
  return fillTemplate(
    resolveLocalizedText(uiLanguage, {
      'zh-CN': '默认接口：{endpoint}。',
      'zh-TW': '預設介面：{endpoint}。',
      'en-US': 'Default endpoint: {endpoint}.',
      ja: 'デフォルトエンドポイント: {endpoint}。',
      ko: '기본 엔드포인트: {endpoint}.',
    }),
    { endpoint },
  )
}

function providerModelNote(model: string, uiLanguage: UiLanguage) {
  return fillTemplate(
    resolveLocalizedText(uiLanguage, {
      'zh-CN': '推荐模型：{model}。',
      'zh-TW': '建議模型：{model}。',
      'en-US': 'Recommended model: {model}.',
      ja: '推奨モデル: {model}。',
      ko: '권장 모델: {model}.',
    }),
    { model },
  )
}

export function getLocalizedApiProviderNote(provider: ApiProviderPreset, uiLanguage: UiLanguage) {
  return [
    baseProviderNote(provider, uiLanguage),
    provider.baseUrl ? providerEndpointNote(provider.baseUrl, uiLanguage) : '',
    provider.defaultModel ? providerModelNote(provider.defaultModel, uiLanguage) : '',
  ].filter(Boolean).join(' ')
}
