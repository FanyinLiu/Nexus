export const SURFACE_EVIDENCE = {
  chat: {
    docs: ['docs/CHAT_SURFACE_REFERENCE_REVIEW.md', 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'],
    sourceFiles: [
      'src/app/views/PanelView.tsx',
      'src/components/MessageBubble.tsx',
      'src/hooks/chat/useChatPersistence.ts',
    ],
    commands: [
      'npm run chat:surface:audit',
      'npm run ui:references:audit -- --surface=chat --pro-prompt --evidence',
    ],
    browserChecks: [
      'Open an active chat state and confirm message density, streaming boundaries, and composer continuity.',
    ],
  },
  composer: {
    docs: ['docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md', 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'],
    sourceFiles: [
      'src/app/views/PanelView.tsx',
      'src/app/styles/panel-companion-chat.css',
      'src/app/App.css',
    ],
    commands: [
      'npm run composer:surface:audit',
      'npm run ui:references:audit -- --surface=composer --pro-prompt --evidence',
      'node --experimental-strip-types --test tests/composer-cross-surface-audit.test.ts tests/open-source-ui-reference-audit.test.ts',
    ],
    browserChecks: [
      'Compare normal chat composer and Image4 composer alignment without changing button sizes.',
      'In Image4 warm-day, attachment, mic, and send should read as embedded input tools by default; hover or focus may reveal lightweight button feedback.',
    ],
  },
  settings: {
    docs: ['docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md', 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'],
    sourceFiles: [
      'src/components/SettingsDrawer.tsx',
      'src/components/SettingsDrawerActiveSection.tsx',
      'src/app/styles/settings.css',
      'src/app/styles/settings-home.css',
      'src/app/styles/settings-themes.css',
      'src/app/styles/settings-chat-aligned.css',
    ],
    commands: [
      'npm run settings:surface:audit',
      'npm run ui:references:audit -- --surface=settings --pro-prompt --evidence',
    ],
    browserChecks: [
      'Review normal and narrow drawer widths for compact repeated rows, focus order, and text fit.',
    ],
  },
  'image4-presence': {
    docs: [
      'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
      'docs/IMAGE4_UI_REFERENCE_PATTERNS.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
    ],
    sourceFiles: [
      'src/app/views/Image4CompanionField.tsx',
      'src/app/views/Image4Signal.tsx',
      'src/app/views/image4CompanionState.ts',
      'src/app/styles/panel-companion-layout.css',
      'src/app/styles/panel-companion-motion.css',
    ],
    commands: [
      'npm run image4:visual-contract:audit',
      'npm run image4:contract:report',
      'npm run ui:references:audit -- --surface=image4-presence --pro-prompt --evidence',
      'node --experimental-strip-types --test tests/image4-companion-state.test.ts tests/image4-visual-contract-audit.test.ts tests/open-source-ui-reference-audit.test.ts',
    ],
    browserChecks: [
      'Open ?view=panel&image4Preview=1&image4Grid=1 and inspect idle, attentive, speaking, and resting states.',
      'Confirm the visible identity is only 星绘, with no leading orb, right-side orbit dot, expanded title badge, or always-on equalizer.',
      'Confirm idle voice bars stay quiet and only the speaking state animates the existing bars.',
    ],
  },
  dial: {
    docs: [
      'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
      'docs/IMAGE4_UI_REFERENCE_PATTERNS.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
    ],
    sourceFiles: [
      'src/app/views/Image4CompanionField.tsx',
      'src/app/views/image4CompanionState.ts',
      'src/app/styles/panel-companion-layout.css',
      'src/app/styles/panel-companion-motion.css',
    ],
    commands: [
      'npm run image4:visual-contract:audit',
      'npm run image4:contract:report',
      'npm run ui:references:audit -- --surface=dial --pro-prompt --evidence',
      'node --experimental-strip-types --test tests/image4-visual-contract-audit.test.ts tests/open-source-ui-reference-audit.test.ts',
    ],
    browserChecks: [
      'Open ?view=panel&image4Preview=1&image4Grid=1 and confirm time, date, and weather stay inside the ring without overlap.',
    ],
  },
  'companion-tone': {
    docs: [
      'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
    ],
    sourceFiles: [
      'src/app/styles/panel-companion-shell.css',
      'src/app/styles/panel-companion-layout.css',
      'src/app/styles/panel-companion-composer.css',
    ],
    commands: [
      'npm run image4:color:audit',
      'npm run ui:references:audit -- --surface=companion-tone --pro-prompt --evidence',
      'node --experimental-strip-types --test tests/image4-companion-color-audit.test.ts tests/open-source-ui-reference-patterns.test.ts tests/open-source-ui-reference-audit.test.ts',
    ],
    researchNotes: [
      'Color-emotion research supports a light warm base plus blue-green support for positive low-arousal comfort and relaxation.',
      'Peach/apricot should stay a restrained warmth accent because yellow/orange families can raise arousal when overused.',
      'W3C non-text contrast guidance keeps embedded plus, mic, send-ready, focus, and speaking cues legible through companion tokens before adding button backplates or larger controls.',
    ],
    browserChecks: [
      'Open ?view=panel&image4Preview=1 and confirm warm-day reads as light, companion-like, and token-governed instead of dark or workbench-like.',
      'Compare idle and speaking states; color should clarify state without adding detached glow, sampled reference palettes, or decorative mood lighting.',
    ],
  },
  forms: {
    docs: ['docs/FORMS_SURFACE_REFERENCE_REVIEW.md', 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md', 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'],
    sourceFiles: [
      'src/components/settingsSections',
      'src/app/styles/settings.css',
      'src/app/styles/settings-home.css',
    ],
    commands: [
      'npm run forms:surface:audit',
      'npm run ui:references:audit -- --surface=forms --pro-prompt --evidence',
    ],
    browserChecks: [
      'Review repeated label/control/description rows for scanability and compact spacing.',
    ],
  },
  'focus-management': {
    docs: [
      'docs/FOCUS_MANAGEMENT_REFERENCE_REVIEW.md',
      'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
    ],
    sourceFiles: [
      'src/components/SettingsDrawer.tsx',
      'src/components/SettingsDrawerActiveSection.tsx',
      'src/hooks/useModalFocusTrap.ts',
      'src/components/settingsSections',
    ],
    commands: [
      'npm run focus:surface:audit',
      'node --experimental-strip-types --test tests/settings-ui-scale.test.ts tests/open-source-ui-reference-audit.test.ts',
      'npm run ui:references:audit -- --surface=focus-management --pro-prompt --evidence',
    ],
    browserChecks: [
      'Keyboard through drawer sections and modal-like controls; focus should remain visible and predictable.',
    ],
  },
  streaming: {
    docs: [
      'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md',
      'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
    ],
    sourceFiles: [
      'src/app/views/PanelView.tsx',
      'src/components/MessageBubble.tsx',
      'src/features/chat/systemPromptBuilder.ts',
    ],
    commands: [
      'npm run streaming:surface:audit',
      'node --experimental-strip-types --test tests/open-source-ui-reference-audit.test.ts',
      'npm run ui:references:audit -- --surface=streaming --pro-prompt --evidence',
    ],
    browserChecks: [
      'Review active assistant output for append-only streaming feel and clear tool/result boundaries.',
    ],
  },
  'agent-activity': {
    docs: [
      'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
      'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md',
      'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
    ],
    sourceFiles: [
      'src/features/context/companionAwareness.ts',
      'src/features/context/companionCheckInPolicy.ts',
      'src/app/views/PanelView.tsx',
      'src/app/views/image4CompanionState.ts',
    ],
    commands: [
      'npm run agent-activity:surface:audit',
      'node --experimental-strip-types --test tests/open-source-ui-reference-audit.test.ts tests/companion-awareness.test.ts tests/companion-check-in-policy.test.ts',
      'npm run ui:references:audit -- --surface=agent-activity --pro-prompt --evidence',
    ],
    browserChecks: [
      'Review Nexus while idle and during assistant activity; activity should read as companion state, not an autonomous workbench.',
    ],
  },
}

export const SURFACE_REVIEW_QUEUE = [
  {
    surface: 'image4-presence',
    priority: 1,
    phase: 'Image4 companion identity',
    focus: 'Presence must feel alive without becoming an audio widget or mascot.',
    whyNow: 'This is the most visible new UI direction and drives the companion-first identity.',
  },
  {
    surface: 'dial',
    priority: 2,
    phase: 'Image4 environment lens',
    focus: 'Time, date, and weather must stay ambient, contained, and non-dashboard-like.',
    whyNow: 'Dial polish has been a repeated visual concern and shares the same companion field.',
  },
  {
    surface: 'companion-tone',
    priority: 3,
    phase: 'Companion emotional color',
    focus: 'Warm-day color should feel like low-arousal companionship without copying reference palettes or turning into a dark workbench.',
    whyNow: 'Color is a current product concern and affects whether the main dialog feels like companionship or a generic tool.',
  },
  {
    surface: 'composer',
    priority: 4,
    phase: 'Input control system',
    focus: 'Mic, send, attachment, and textarea alignment should remain shared across surfaces.',
    whyNow: 'Composer regressions are easy to introduce while tuning Image4 and chat polish.',
  },
  {
    surface: 'chat',
    priority: 5,
    phase: 'Conversation density',
    focus: 'Streaming, message density, and tool boundaries should not turn into card stacks.',
    whyNow: 'After the primary companion field, normal chat must keep the app usable.',
  },
  {
    surface: 'settings',
    priority: 6,
    phase: 'Configuration structure',
    focus: 'Settings should stay compact, predictable, and separate from Image4 rhythm variables.',
    whyNow: 'Settings carry many 0.3 safety and memory foundations and should not become visually noisy.',
  },
  {
    surface: 'forms',
    priority: 7,
    phase: 'Repeated control rows',
    focus: 'Labels, inputs, descriptions, toggles, and validation states need one compact grammar.',
    whyNow: 'Form consistency makes later settings growth cheaper and easier to review.',
  },
  {
    surface: 'focus-management',
    priority: 8,
    phase: 'Keyboard and modal behavior',
    focus: 'Focus should remain visible and predictable across drawers, sections, and modal controls.',
    whyNow: 'Accessibility behavior should be stable before adding more settings depth.',
  },
  {
    surface: 'streaming',
    priority: 9,
    phase: 'Future tool/result flow',
    focus: 'Streaming and tool-result areas should preserve composer reachability and message clarity.',
    whyNow: 'It is a lower-risk follow-up once chat density and composer rules are stable.',
  },
  {
    surface: 'agent-activity',
    priority: 10,
    phase: 'Codex-like activity boundary',
    focus: 'Observation, processing, and completion states should be visible without turning Nexus into a coding-agent workbench.',
    whyNow: 'The user wants Codex-like clarity, but Nexus must stay companion-first rather than becoming a Codex-like product shell.',
  },
]

export const SURFACE_CRITICAL_QUESTIONS = {
  'image4-presence': [
    'Image4 presence 应该借鉴 LobeChat 的哪一种抽象身份层级，而不是复制它的头像、卡片或品牌 chrome？',
    '当前 presence 如何在 idle、attentive、speaking、resting 之间表达时间流动，同时避免变成音频 widget？',
    '在硬性保留“星绘”两个字、不要“星绘在身边”、不要前置圆球和右侧轨道点的前提下，presence 还能通过哪些低噪声细节表达陪伴？',
    '声纹只在星绘说话时动，idle 时保持安静；这种状态语法怎样既可感知又不变成音频控件？',
    '如果只能保留一个视觉节奏判断，应该优先保护 presence、dial、greeting、actions、composer 中的哪一层，为什么？',
    '哪些建议会破坏 Nexus 的 companion-first 身份，应该直接拒绝？',
  ],
  dial: [
    '时间、日期、天气应该作为环境线索还是信息组件存在，怎样避免 dashboard 感？',
    '圆环、内环和轨道的关系应该怎样组织，才能容纳日期/天气而不穿模？',
    '哪些动画可以表达流逝感，哪些动画会抢走聊天和陪伴主体？',
    '如果窗口高度变短，dial 应该优先收起哪些细节？',
  ],
  'companion-tone': [
    '陪伴型 warm-day 应该借鉴 LobeChat/Jan/Chatbox 的哪种情绪角色，而不是复制它们的 palette、暗色皮肤或产品 chrome？',
    '暖白、奶杏、桃杏、鼠尾草绿/雾蓝分别应该承担哪些界面角色，哪些颜色只能作为小面积状态提示？',
    '晨光、白天、夜间三档陪伴色应该怎样区分？早安/白天状态为什么不能默认偏黑或偏冷，如果保留夜间主题，应该怎样和 warm-day 的陪伴感分开？',
    '说话、idle、attentive、resting 状态的颜色变化应该如何克制，才能让状态可感知但不变成 mood-light 效果？',
    '哪些色彩判断应该进入 `image4:color:audit`，哪些仍然应该留给截图和人工 review？',
  ],
  composer: [
    'composer 应该更像 intent gateway 还是普通聊天输入框，具体差别体现在哪些控件层级？',
    '麦克风、发送、附件和文本区怎样对齐，才能跨 Image4 和普通 chat 共享一套尺寸节奏？',
    '内嵌工具默认无底板、hover/focus 才出现按钮反馈时，怎样保持可发现性而不让对话框变成一排小按钮？',
    '从 Chatbox 和 Vercel AI Chatbot 只能借鉴哪些交互范式，哪些桌面/网页 chrome 必须避开？',
    '从 LibreChat 这类成熟通用聊天产品里，只能借鉴哪些能力入口边界，哪些 ChatGPT-like 输入框或平台导航必须避开？',
    'disabled、streaming、voice 三种状态下，主操作和次操作应该怎样保持清晰？',
  ],
  chat: [
    '聊天区应该借鉴 Open WebUI / Vercel AI Chatbot 的哪些密度和 streaming 分层，而不是复制页面式布局？',
    '消息、工具结果和 composer 的视觉权重应该怎样分配，才能避免 card stack 感？',
    'LibreChat 的 agents、artifacts、MCP/tools、resumable streams 说明了哪些能力边界，哪些不应该出现在 Nexus 的默认聊天 chrome？',
    '长对话、等待中、错误态分别需要哪些最小但可见的反馈？',
    '哪些地方应该人工判断 polish，哪些地方适合变成审计规则？',
  ],
  settings: [
    '设置页应该借鉴 Cherry Studio 的哪些信息架构，而不是复制桌面设置应用外观？',
    '哪些 shadcn/ui / Radix 行为范式适合 Nexus 的紧凑设置行？',
    'LibreChat 的 provider、agent、tool、file、admin 边界里，哪些能帮助 Nexus 表达桌面感知/记忆/权限，哪些会让设置变成平台后台？',
    '安全、记忆、桌面感知这些高信任设置应该怎样分组，才能减少视觉噪声？',
    '哪些控件尺寸或文案密度会让设置页重新变得臃肿？',
  ],
  forms: [
    '重复表单行应该如何统一 label、description、control、validation 的节奏？',
    '哪些 Radix primitive 行为契约应该进入表单行，比如 label/control 关系、controlled state、focus-visible、Escape/Tab 行为？',
    '哪些控件应该用 toggle、segmented control、slider、select，而不是普通文字按钮？',
    '错误、保存中、禁用态应该怎样表达，不增加新的视觉层级？',
    '哪些行适合合并，哪些行必须拆开以保护可读性？',
  ],
  'focus-management': [
    'drawer、section、modal-like controls 的焦点顺序应该怎样设计，才能接近 Radix 的可预测性？',
    '键盘导航时哪些状态必须可见，哪些 hover-only 反馈必须避免？',
    '关闭、返回、保存、危险操作之间需要哪些焦点和确认边界？',
    '哪些视觉改动可能让焦点环、滚动位置或可达性退化？',
  ],
  streaming: [
    'streaming 和 tool/result 区域应该借鉴 Vercel AI Chatbot 的哪种 append-only 结构？',
    '等待中、局部完成、工具返回、最终回答之间应该怎样分层？',
    'streaming 时 composer 可达性和消息可读性哪个优先，冲突时怎么取舍？',
    '哪些 loading/typing 动画会让 companion 感变弱或变成网页聊天感？',
  ],
  'agent-activity': [
    'Nexus 可以借鉴 OpenHands 哪些 activity boundary，让用户知道“正在观察/正在处理/完成”，但不变成 coding-agent cockpit？',
    'Cline 的 plan/act、approval、checkpoint、command-output 状态里，哪些可转译成桌面感知陪伴的确认和进度语法，哪些必须因为 coding-agent 语境而拒绝？',
    'LibreChat 的 agents/tools/MCP/artifacts 边界怎样帮助 Nexus 说明“我用了什么上下文”，同时避免变成通用 agent 平台？',
    '哪些状态应该出现在 Image4 / chat / settings 中，哪些状态必须保持后台或日志级别？',
    '如果借鉴 Codex-like clarity，哪些视觉元素属于可借鉴的状态语法，哪些会让 Nexus 看起来像 Codex-like product shell？',
    '桌面感知触发陪伴时，应该怎样表达时间流动和系统正在陪伴，而不是表达“agent 正在执行任务”？',
  ],
}

export const PRO_REVIEW_DECISION_CHECKS = [
  'Every recommendation maps to the selected Nexus surface before implementation.',
  'The answer names at least one abstract pattern to borrow and one concrete skin/detail to avoid.',
  'The route is small enough to prototype without rewriting adjacent surfaces.',
  'Manual polish checks and automatic audit/test checks are separated.',
  'The answer preserves companion-first identity and does not turn Nexus into a generic chat dashboard.',
]
