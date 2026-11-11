import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBatchPluginApprovalDialog,
  buildExternalLinkConfirmDialog,
  buildMcpStartApprovalDialog,
  buildMcpToolApprovalDialog,
  buildPluginApprovalDialog,
  externalLinkCancelledMessage,
  externalLinkOpenedMessage,
} from '../electron/services/approvalDialogCopy.js'

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'] as const

type Copy = Record<string, string>

const MCP_START: Record<string, Copy> = {
  'zh-CN': {
    title: '要启动 MCP 服务吗',
    message: '允许 Nexus 启动「server-x」吗？',
    suffix: '允许后，它会在你的电脑上运行，能读写你的文件、上网，权限和你自己一样。只批准你自己配的、或者完全信得过的。之后可以在「设置 → 外部集成」里撤销。',
    deny: '拒绝',
    allow: '允许',
    commandLabel: '命令：',
    argsLabel: '参数：',
    noArgs: '无参数',
  },
  'zh-TW': {
    title: '要啟動 MCP 服務嗎',
    message: '允許 Nexus 啟動「server-x」嗎？',
    suffix: '允許後，它會在你的電腦上執行，能讀寫你的檔案、上網，權限跟你自己一樣。只批准你自己設定的、或完全信得過的。之後可以在「設定 → 外部整合」裡撤銷。',
    deny: '拒絕',
    allow: '允許',
    commandLabel: '指令：',
    argsLabel: '參數：',
    noArgs: '無參數',
  },
  'en-US': {
    title: 'Start this MCP service?',
    message: 'Allow Nexus to start "server-x"?',
    suffix: 'Once allowed, it runs on your computer and can read and change your files and use the internet, just like you can. Only allow ones you set up yourself or fully trust. You can take this back anytime in Settings → External integrations.',
    deny: "Don't allow",
    allow: 'Allow',
    commandLabel: 'Command:',
    argsLabel: 'Arguments:',
    noArgs: '(no arguments)',
  },
  ja: {
    title: 'MCP サービスを起動しますか',
    message: '「server-x」の起動を許可しますか？',
    suffix: '許可すると、このパソコン上で動き、あなたと同じようにファイルの読み書きやネット接続ができます。自分で設定したもの、または十分信頼できるものだけ許可してください。あとから「設定 → 外部連携」で取り消せます。',
    deny: '許可しない',
    allow: '許可',
    commandLabel: 'コマンド:',
    argsLabel: '引数:',
    noArgs: '(引数なし)',
  },
  ko: {
    title: 'MCP 서비스를 시작할까요?',
    message: 'Nexus가 "server-x"을(를) 시작해도 될까요?',
    suffix: '허용하면 이 컴퓨터에서 실행되고, 당신처럼 파일을 읽고 바꾸거나 인터넷을 쓸 수 있어요. 직접 설정했거나 충분히 믿을 수 있는 것만 허용하세요. 나중에 설정 → 외부 통합에서 취소할 수 있어요.',
    deny: '허용 안 함',
    allow: '허용',
    commandLabel: '명령:',
    argsLabel: '인수:',
    noArgs: '(인수 없음)',
  },
}

const MCP_TOOL: Record<string, Copy> = {
  'zh-CN': {
    title: '有新工具要用',
    message: '「server-x」多了一个新工具：「tool-y」',
    suffix: '这个工具是你上次批准之后才出现的，一般是服务更新了。如果你最近更新过它，可以允许；如果没有，先别允许，可能被人改过。',
    descriptionLabel: '工具说明（来自服务）：',
  },
  'zh-TW': {
    title: '有新工具要用',
    message: '「server-x」多了一個新工具：「tool-y」',
    suffix: '這個工具是你上次批准之後才出現的，通常是服務更新了。如果你最近更新過它，可以允許；如果沒有，先別允許，可能被人改過。',
    descriptionLabel: '工具說明（來自服務）：',
  },
  'en-US': {
    title: 'A new tool wants in',
    message: '"server-x" has a new tool: "tool-y"',
    suffix: "This tool showed up after you last approved this service, which usually means it was updated. If you updated it recently, it's fine to allow. If you didn't, don't allow it; it may have been tampered with.",
    descriptionLabel: 'Description (from server):',
  },
  ja: {
    title: '新しいツールがあります',
    message: '「server-x」に新しいツール「tool-y」が増えました',
    suffix: 'このツールは前回の許可のあとに現れました。たいていはサービスの更新によるものです。最近更新したなら許可して大丈夫です。心当たりがなければ、書き換えられた可能性があるので許可しないでください。',
    descriptionLabel: '説明（サーバーから）:',
  },
  ko: {
    title: '새 도구가 생겼어요',
    message: '"server-x"에 새 도구 "tool-y"이(가) 생겼어요',
    suffix: '지난번 허용 이후에 생긴 도구예요. 보통은 서비스가 업데이트된 거예요. 최근에 업데이트했다면 허용해도 괜찮아요. 아니라면 누가 바꿨을 수도 있으니 허용하지 마세요.',
    descriptionLabel: '설명(서버 제공):',
  },
}

const PLUGIN_LABELS: Record<string, Copy> = {
  'zh-CN': {
    id: '插件 ID：',
    version: '版本：',
    description: '描述：',
    command: '命令：',
    allow: '允许',
    deny: '拒绝',
  },
  'zh-TW': {
    id: '外掛 ID：',
    version: '版本：',
    description: '描述：',
    command: '指令：',
    allow: '允許',
    deny: '拒絕',
  },
  'en-US': {
    id: 'Plugin ID:',
    version: 'Version:',
    description: 'Description:',
    command: 'Command:',
    allow: 'Allow',
    deny: "Don't allow",
  },
  ja: {
    id: 'プラグイン ID:',
    version: 'バージョン:',
    description: '説明:',
    command: 'コマンド:',
    allow: '許可',
    deny: '許可しない',
  },
  ko: {
    id: '플러그인 ID:',
    version: '버전:',
    description: '설명:',
    command: '명령:',
    allow: '허용',
    deny: '허용 안 함',
  },
}

const PLUGIN_SINGLE: Record<string, Copy> = {
  'zh-CN': {
    titleNew: '新插件',
    titleReauth: '插件有变化',
    messageNew: '要让插件「plugin-x」运行吗？',
    messageReauth: '插件「plugin-x」的启动方式变了，要重新允许吗？',
    detailNew: '允许后，它会在你的电脑上运行，权限和你自己一样，还能给 Nexus 加工具。只允许信得过的。',
    detailReauth: '它这次要跑的命令和上次不一样了。确认是你自己更新的再允许。',
  },
  'zh-TW': {
    titleNew: '新外掛',
    titleReauth: '外掛有變化',
    messageNew: '要讓外掛「plugin-x」執行嗎？',
    messageReauth: '外掛「plugin-x」的啟動方式變了，要重新允許嗎？',
    detailNew: '允許後，它會在你的電腦上執行，權限跟你自己一樣，還能幫 Nexus 加工具。只允許信得過的。',
    detailReauth: '它這次要執行的指令跟上次不一樣。確認是你自己更新的再允許。',
  },
  'en-US': {
    titleNew: 'New plugin',
    titleReauth: 'Plugin changed',
    messageNew: 'Let the plugin "plugin-x" run?',
    messageReauth: '"plugin-x" changed how it starts. Allow it again?',
    detailNew: 'Once allowed, it runs on your computer with the same access you have, and can add tools to Nexus. Only allow ones you trust.',
    detailReauth: 'The command it wants to run is different from last time. Allow it only if you updated it yourself.',
  },
  ja: {
    titleNew: '新しいプラグイン',
    titleReauth: 'プラグインが変わりました',
    messageNew: 'プラグイン「plugin-x」を動かしますか？',
    messageReauth: '「plugin-x」の起動方法が変わりました。もう一度許可しますか？',
    detailNew: '許可すると、このパソコン上であなたと同じ権限で動き、Nexus にツールを追加できます。信頼できるものだけ許可してください。',
    detailReauth: '前回と違うコマンドを実行しようとしています。自分で更新した場合だけ許可してください。',
  },
  ko: {
    titleNew: '새 플러그인',
    titleReauth: '플러그인이 바뀌었어요',
    messageNew: '플러그인 "plugin-x"을(를) 실행할까요?',
    messageReauth: '"plugin-x"의 시작 방식이 바뀌었어요. 다시 허용할까요?',
    detailNew: '허용하면 이 컴퓨터에서 당신과 같은 권한으로 실행되고, Nexus에 도구를 추가할 수 있어요. 믿을 수 있는 것만 허용하세요.',
    detailReauth: '지난번과 다른 명령을 실행하려고 해요. 직접 업데이트한 경우에만 허용하세요.',
  },
}

const PLUGIN_BATCH: Record<string, Copy> = {
  'zh-CN': {
    titleOne: '有 1 个插件等你允许',
    titleOther: '有 2 个插件等你允许',
    messageOne: '这个插件要运行，要允许吗？',
    messageOther: '这 2 个插件要运行，要全部允许吗？',
    detail: '允许后，它们都会在你的电脑上运行，权限和你自己一样。不确定的话先全部拒绝。',
    denyAll: '全部拒绝',
    allowAll: '全部允许',
  },
  'zh-TW': {
    titleOne: '有 1 個外掛等你允許',
    titleOther: '有 2 個外掛等你允許',
    messageOne: '這個外掛要執行，要允許嗎？',
    messageOther: '這 2 個外掛要執行，要全部允許嗎？',
    detail: '允許後，它們都會在你的電腦上執行，權限跟你自己一樣。不確定的話先全部拒絕。',
    denyAll: '全部拒絕',
    allowAll: '全部允許',
  },
  'en-US': {
    titleOne: '1 plugin needs your OK',
    titleOther: '2 plugins need your OK',
    messageOne: 'Let this plugin run?',
    messageOther: 'Let all 2 plugins run?',
    detail: "Once allowed, they all run on your computer with the same access you have. If you're not sure, don't allow any yet.",
    denyAll: "Don't allow any",
    allowAll: 'Allow all',
  },
  ja: {
    titleOne: '1 個のプラグインが許可を待っています',
    titleOther: '2 個のプラグインが許可を待っています',
    messageOne: 'このプラグインを動かしますか？',
    messageOther: '2 個すべて動かしますか？',
    detail: '許可すると、すべてこのパソコン上であなたと同じ権限で動きます。迷ったら一度すべて許可しないでください。',
    denyAll: 'すべて許可しない',
    allowAll: 'すべて許可',
  },
  ko: {
    titleOne: '플러그인 1개가 허용을 기다려요',
    titleOther: '플러그인 2개가 허용을 기다려요',
    messageOne: '이 플러그인을 실행할까요?',
    messageOther: '2개 모두 실행할까요?',
    detail: '허용하면 모두 이 컴퓨터에서 당신과 같은 권한으로 실행돼요. 잘 모르겠으면 일단 모두 허용하지 마세요.',
    denyAll: '모두 허용 안 함',
    allowAll: '모두 허용',
  },
}

const EXTERNAL_OPEN: Record<string, Copy> = {
  'zh-CN': {
    title: '打开这个链接？',
    message: 'Nexus 会在浏览器里打开它。',
    open: '打开',
    cancel: '取消',
    cancelled: '没有打开外部链接。',
    opened: '已在系统浏览器中打开 https://example.com/',
  },
  'zh-TW': {
    title: '開啟這個連結？',
    message: 'Nexus 會在瀏覽器裡開啟它。',
    open: '開啟',
    cancel: '取消',
    cancelled: '沒有開啟外部連結。',
    opened: '已在系統瀏覽器中開啟 https://example.com/',
  },
  'en-US': {
    title: 'Open this link?',
    message: 'Nexus will open it in your browser.',
    open: 'Open',
    cancel: 'Cancel',
    cancelled: 'The external link was not opened.',
    opened: 'Opened https://example.com/ in your browser.',
  },
  ja: {
    title: 'このリンクを開きますか？',
    message: 'ブラウザで開きます。',
    open: '開く',
    cancel: 'キャンセル',
    cancelled: '外部リンクは開きませんでした。',
    opened: 'https://example.com/ をブラウザで開きました。',
  },
  ko: {
    title: '이 링크를 열까요?',
    message: '브라우저에서 엽니다.',
    open: '열기',
    cancel: '취소',
    cancelled: '외부 링크를 열지 않았어요.',
    opened: 'https://example.com/을(를) 브라우저에서 열었어요.',
  },
}

const DROPPED_BATCH_POINTERS = [
  '一个个开',
  '一個個開',
  'one by one',
  'ひとつずつ',
  '하나씩',
  '设置 → 外部集成',
  '設定 → 外部整合',
  'Settings → External integrations',
  '設定 → 外部連携',
  '설정 → 외부 통합',
]

type DialogOptions = {
  type?: string
  title?: string
  message?: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}

function optionsOf(options: unknown): DialogOptions {
  return options as DialogOptions
}

test('MCP start dialog copy matches product copy in all five locales', () => {
  for (const locale of LOCALES) {
    const expected = MCP_START[locale]
    const options = optionsOf(buildMcpStartApprovalDialog({
      serverId: 'server-x',
      command: 'npx',
      args: ['-y', '@scope/server'],
      locale,
    }))

    assert.equal(options.type, 'warning', locale)
    assert.equal(options.title, expected.title, locale)
    assert.equal(options.message, expected.message, locale)
    assert.deepEqual(options.buttons, [expected.deny, expected.allow], locale)
    assert.equal(options.defaultId, 0, `${locale}: Deny must stay the default`)
    assert.equal(options.cancelId, 0, locale)
    assert.equal(options.noLink, true, locale)
    assert.ok(
      options.detail.startsWith(
        `${expected.commandLabel}\n  npx\n\n${expected.argsLabel}\n  -y @scope/server\n\n`,
      ),
      `${locale}: command and args must stay verbatim in front of the suffix`,
    )
    assert.ok(options.detail.endsWith(expected.suffix), `${locale}: missing product suffix`)
    assert.ok(options.detail.includes('npx'), locale)
    assert.ok(options.detail.includes('@scope/server'), locale)
  }
})

test('MCP start dialog localizes the empty-arguments placeholder', () => {
  for (const locale of LOCALES) {
    const expected = MCP_START[locale]
    const options = optionsOf(buildMcpStartApprovalDialog({
      serverId: 'server-x',
      command: 'npx',
      args: [],
      locale,
    }))
    assert.ok(
      options.detail.includes(`${expected.argsLabel}\n  ${expected.noArgs}`),
      `${locale}: expected localized no-arguments text`,
    )
  }
})

test('MCP new-tool dialog copy, placeholders and defaults match product copy', () => {
  for (const locale of LOCALES) {
    const expected = MCP_TOOL[locale]
    const options = optionsOf(buildMcpToolApprovalDialog({
      serverId: 'server-x',
      toolName: 'tool-y',
      toolDescription: 'Reads a folder.',
      locale,
    }))

    assert.equal(options.type, 'warning', locale)
    assert.equal(options.title, expected.title, locale)
    assert.equal(options.message, expected.message, locale)
    assert.equal(options.buttons[0], MCP_START[locale].deny, locale)
    assert.equal(options.buttons[1], MCP_START[locale].allow, locale)
    assert.equal(options.defaultId, 0, `${locale}: Deny must stay the default`)
    assert.equal(options.cancelId, 0, locale)
    assert.ok(
      options.detail.startsWith(`${expected.descriptionLabel}\n  Reads a folder.\n\n`),
      `${locale}: tool description must stay verbatim in front of the suffix`,
    )
    assert.ok(options.detail.endsWith(expected.suffix), `${locale}: missing product suffix`)
  }
})

test('MCP new-tool dialog skips the description block when the server sends none', () => {
  for (const locale of LOCALES) {
    const options = optionsOf(buildMcpToolApprovalDialog({
      serverId: 'server-x',
      toolName: 'tool-y',
      locale,
    }))
    assert.ok(options.detail.endsWith(MCP_TOOL[locale].suffix), locale)
    assert.ok(!options.detail.includes(MCP_TOOL[locale].descriptionLabel), locale)
  }
})

test('single-plugin dialog copy and metadata match product copy in all five locales', () => {
  const plugin = {
    id: 'plugin-x',
    name: 'plugin-x',
    version: '1.2.3',
    description: 'Adds a helper.',
    command: 'node',
    args: ['server.js', '--flag'],
  }

  for (const locale of LOCALES) {
    const expected = PLUGIN_SINGLE[locale]
    const labels = PLUGIN_LABELS[locale]

    for (const isReapproval of [false, true]) {
      const options = optionsOf(buildPluginApprovalDialog({ plugin, isReapproval, locale }))
      assert.equal(options.type, 'question', locale)
      assert.equal(options.title, isReapproval ? expected.titleReauth : expected.titleNew, locale)
      assert.equal(options.message, isReapproval ? expected.messageReauth : expected.messageNew, locale)
      assert.deepEqual(options.buttons, [labels.allow, labels.deny], locale)
      assert.equal(options.defaultId, 1, `${locale}: Deny must stay the default`)
      assert.equal(options.cancelId, 1, locale)

      const metadata = options.detail.split('\n\n')[0]
      assert.ok(metadata.includes(`${labels.id}plugin-x`), locale)
      assert.ok(metadata.includes(`${labels.version}1.2.3`), locale)
      assert.ok(metadata.includes(`${labels.description}Adds a helper.`), locale)
      assert.ok(metadata.includes(`${labels.command}node server.js --flag`), locale)
      assert.ok(
        options.detail.endsWith(isReapproval ? expected.detailReauth : expected.detailNew),
        `${locale}: missing product suffix`,
      )
    }
  }
})

test('batch-plugin dialog copy uses the shortened suffix and Deny-all default', () => {
  const plugins = [
    { id: 'plugin-a', name: 'Plugin A', version: '1.0.0' },
    { id: 'plugin-b', name: 'Plugin B', version: '2.0.0' },
  ]

  for (const locale of LOCALES) {
    const expected = PLUGIN_BATCH[locale]
    const options = optionsOf(buildBatchPluginApprovalDialog({ plugins, locale }))

    assert.equal(options.type, 'question', locale)
    assert.equal(options.title, expected.titleOther, locale)
    assert.equal(options.message, expected.messageOther, locale)
    assert.deepEqual(options.buttons, [expected.allowAll, expected.denyAll], locale)
    assert.equal(options.defaultId, 1, `${locale}: Deny-all must stay the default`)
    assert.equal(options.cancelId, 1, locale)

    assert.ok(options.detail.includes('  • Plugin A (plugin-a v1.0.0)'), locale)
    assert.ok(options.detail.includes('  • Plugin B (plugin-b v2.0.0)'), locale)
    assert.ok(options.detail.endsWith(expected.detail), `${locale}: missing shortened suffix`)

    for (const pointer of DROPPED_BATCH_POINTERS) {
      assert.ok(
        !options.detail.includes(pointer),
        `${locale}: batch detail still points at turning plugins on one by one (${pointer})`,
      )
    }
  }
})

test('batch-plugin dialog uses the singular _one wording instead of "1 plugins"', () => {
  for (const locale of LOCALES) {
    const expected = PLUGIN_BATCH[locale]
    const options = optionsOf(buildBatchPluginApprovalDialog({
      plugins: [{ id: 'plugin-a', name: 'Plugin A', version: '1.0.0' }],
      locale,
    }))

    assert.equal(options.title, expected.titleOne, locale)
    assert.equal(options.message, expected.messageOne, locale)
    assert.ok(!options.title.includes('{count}'), locale)
    assert.ok(!options.message.includes('{count}'), locale)
    assert.ok(!options.title.includes('1 plugins'), locale)
  }
})

test('AI-tool external-link confirm uses the five-locale window-open copy', () => {
  const url = 'https://example.com/'

  for (const locale of LOCALES) {
    const expected = EXTERNAL_OPEN[locale]
    const options = optionsOf(buildExternalLinkConfirmDialog({ url, locale }))

    assert.equal(options.type, 'question', locale)
    assert.equal(options.title, expected.title, locale)
    assert.equal(options.message, expected.message, locale)
    assert.deepEqual(options.buttons, [expected.open, expected.cancel], locale)
    assert.equal(options.defaultId, 1, `${locale}: Cancel must stay the default`)
    assert.equal(options.cancelId, 1, locale)
    assert.equal(options.detail, url, locale)
    assert.equal(options.noLink, true, locale)

    assert.equal(externalLinkCancelledMessage(locale), expected.cancelled, locale)
    assert.equal(externalLinkOpenedMessage(url, locale), expected.opened, locale)
  }
})

test('AI-tool external-link confirm no longer hardcodes Chinese-only copy', () => {
  const url = 'https://example.com/'
  const chinese = optionsOf(buildExternalLinkConfirmDialog({ url, locale: 'zh-CN' }))

  for (const locale of ['en-US', 'ja', 'ko']) {
    const options = optionsOf(buildExternalLinkConfirmDialog({ url, locale }))
    assert.notEqual(options.title, chinese.title, locale)
    assert.notEqual(options.message, chinese.message, locale)
    assert.notEqual(options.buttons[0], chinese.buttons[0], locale)
    assert.notEqual(options.buttons[1], chinese.buttons[1], locale)
    assert.notEqual(externalLinkCancelledMessage(locale), externalLinkCancelledMessage('zh-CN'), locale)
  }
})
