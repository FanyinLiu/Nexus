import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getChatAssistantMessageKey,
  shouldAnnounceChatAssistantReply,
} from '../src/features/uiV2/chatSheetAnnouncements.ts'
import { getChatSheetScrollDecision, isChatSheetNearBottom } from '../src/features/uiV2/chatSheetScroll.ts'

const panelPath = new URL('../src/features/uiV2/CompanionPanelV2.tsx', import.meta.url)
const framelessPath = new URL('../src/features/uiV2/FramelessCompanionSurface.tsx', import.meta.url)
const petPath = new URL('../src/app/views/PetView.tsx', import.meta.url)
const legacyPanelPath = new URL('../src/app/views/LegacyPanelView.tsx', import.meta.url)
const sheetPath = new URL('../src/features/uiV2/ChatSheetV2.tsx', import.meta.url)
const sheetStylesPath = new URL('../src/features/uiV2/chat-sheet-v2.css', import.meta.url)
const panelStylesPath = new URL('../src/features/uiV2/panel-v2.css', import.meta.url)
const companionStylesPath = new URL('../src/features/uiV2/companion-v2.css', import.meta.url)
const chatSettingsPath = new URL('../src/features/settingsV3/ChatSectionV3.tsx', import.meta.url)
const localePaths = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'].map(
  (locale) => new URL(`../src/i18n/locales/${locale}.ts`, import.meta.url),
)

test('V2 companion menus expose one auxiliary chat destination', async () => {
  const [panelSource, framelessSource, panelStyles, companionStyles] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(framelessPath, 'utf8'),
    readFile(panelStylesPath, 'utf8'),
    readFile(companionStylesPath, 'utf8'),
  ])

  const panelMenu = panelSource.match(
    /<div\s+ref=\{utilityMenuRef\}[\s\S]*?className="nexus-panel-v2__menu"[\s\S]*?>([\s\S]*?)<\/div>/,
  )?.[1]
  assert.ok(panelMenu, 'the panel utility menu should remain explicit')
  const firstPanelButton = panelMenu.match(/<button[\s\S]*?<\/button>/)?.[0]
  assert.ok(firstPanelButton, 'the panel More menu should expose a first action')
  assert.match(firstPanelButton, /ui_v2\.text_input/)
  assert.doesNotMatch(panelMenu, /voiceActionLabel|handleVoiceMenuAction/)
  assert.match(panelMenu, /ui_v2\.text_input/)
  assert.doesNotMatch(panelMenu, /ui_v2\.recent_conversation/)

  const framelessMenu = framelessSource.match(
    /const menuItems: MenuItem\[\] = \[([\s\S]*?)\n {2}\]/,
  )?.[1]
  assert.ok(framelessMenu, 'the frameless utility menu should remain explicit')
  assert.match(framelessMenu, /ui_v2\.text_input/)
  assert.doesNotMatch(framelessMenu, /ui_v2\.recent_conversation|id: 'recent'/)

  assert.doesNotMatch(panelSource, /nexus-panel-v2__voice/)
  assert.match(framelessSource, /className=\{`nexus-companion-v2__voice/)
  assert.match(framelessSource, /phase === 'thinking'[\s\S]{0,180}chat\.cancelActiveTurn/)

  const panelTrigger = panelSource.match(/className="nexus-panel-v2__utility"[\s\S]{0,320}?<\/button>/)?.[0]
  const framelessTrigger = framelessSource.match(/className="nexus-companion-v2__utility-trigger nexus-v2-control nexus-v2-interactive"[\s\S]{0,320}?<\/button>/)?.[0]
  assert.ok(panelTrigger, 'the panel more-menu trigger should remain explicit')
  assert.ok(framelessTrigger, 'the frameless more-menu trigger should remain explicit')
  assert.match(panelTrigger, /PetControlIcon name="menu"/)
  assert.match(panelTrigger, /aria-controls="nexus-panel-v2-utility-menu"/)
  assert.match(panelSource, /id="nexus-panel-v2-utility-menu"[\s\S]*?role="group"/)
  assert.match(panelSource, /aria-label=\{ti\('ui_v2\.more'\)\}/)
  assert.doesNotMatch(panelSource, /role="menu"/)
  assert.match(framelessTrigger, /PetControlIcon name="menu"/)
  assert.doesNotMatch(panelTrigger, /PetControlIcon name="settings"/)
  assert.doesNotMatch(framelessTrigger, /PetControlIcon name="settings"/)
  assert.match(panelStyles, /\.nexus-panel-v2__menu\s*\{[\s\S]*?width:\s*176px/)
  assert.match(companionStyles, /\.nexus-companion-v2__utility-menu\s*\{[\s\S]*?inline-size:\s*min\(176px,/)
})

test('companion identity copy stays separate from the advanced system prompt', async () => {
  const source = await readFile(chatSettingsPath, 'utf8')
  const identityStart = source.indexOf("title={ti('settings.chat.companion_name')}")
  const modelStart = source.indexOf("title={ti('settings.chat.live2d_model')}", identityStart)

  assert.ok(identityStart >= 0 && modelStart > identityStart, 'the identity and model sections should remain ordered')
  assert.doesNotMatch(
    source.slice(identityStart, modelStart),
    /settings\.chat\.system_prompt_hint/,
    'the companion-name section must not reuse the system-prompt hint',
  )
  assert.match(
    source,
    /<SettingsV3Disclosure\s+title=\{ti\('settings\.chat\.system_prompt'\)\}\s+description=\{ti\('settings\.chat\.system_prompt_hint'\)\}/,
    'the advanced system prompt should remain in its own collapsed disclosure',
  )
})

test('V2 chat sheet keeps history and input in one dialog', async () => {
  const source = await readFile(sheetPath, 'utf8')

  assert.match(source, /useState\(\(\) => messages\.length === 0\)/)
  assert.match(source, /data-empty=\{messages\.length === 0 \? 'true' : 'false'\}/)
  assert.match(source, /aria-labelledby=\{titleId\}/)
  assert.match(source, /role="log"[\s\S]{0,120}aria-label=\{labels\.messageList\}/)
  assert.match(source, /role="log"[\s\S]{0,220}aria-relevant="additions text"/)
  assert.match(source, /aria-label=\{labels\.messageInput\}/)
  assert.match(source, /handleComposerKeyDown[\s\S]{0,320}event\.stopPropagation\(\)/)
  assert.match(source, /if \(busy\) return/)
  assert.match(source, /const composerVisible = composerExpanded \|\| busy/)
  assert.match(source, /if \(!inputValue\.trim\(\) \|\| inputValue === latestUserMessage\.content\)/)
  assert.match(source, /ref=\{collapsedComposerRef\}[\s\S]{0,220}labels\.messageInput/)
  assert.match(source, /labels\.starterPrompts\.map\(/)
  assert.match(source, /labels\.busyStatus/)
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(source, /role="alert" aria-atomic="true"/)
  assert.match(source, /onClick=\{handleEditRetry\}/)
  assert.match(source, /busy \? \(/)
  assert.match(source, /PetControlIcon name="close"/)
  assert.match(source, /aria-label=\{labels\.cancel\}/)
  assert.match(source, /onClick=\{onCancel\}/)
  assert.match(source, /getChatSheetScrollDecision/)
  assert.match(source, /setHasNewMessages\(true\)/)
  assert.match(source, /labels\.viewNewMessages/)
  assert.match(source, /completedReplyAnnouncement/)
  assert.match(source, /busyStartAssistantKeyRef/)
  assert.match(source, /shouldAnnounceChatAssistantReply/)
  assert.match(source, /scheduledFrameIdsRef/)
  assert.match(source, /if \(!shouldFollowLatestRef\.current\) return/)
  assert.doesNotMatch(source, /initialComposerExpanded/)
})

test('empty chat guidance has exactly two starter prompts and every locale supplies the closure copy', async () => {
  const [panelSource, sheetSource, ...localeSources] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(sheetPath, 'utf8'),
    ...localePaths.map((path) => readFile(path, 'utf8')),
  ])
  const labelsBlock = panelSource.match(/labels=\{\{([\s\S]*?)\n\s{10}\}\}/)?.[1] ?? ''
  const starterPromptBlock = labelsBlock.match(/starterPrompts:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  assert.equal((starterPromptBlock.match(/ui_v2\.chat\.prompt_/g) ?? []).length, 2)
  assert.match(sheetSource, /onInputChange\(prompt\)/)
  assert.doesNotMatch(panelSource, /starterPrompts:[\s\S]{0,260}onSend\(\)/)
  for (const localeSource of localeSources) {
    assert.match(localeSource, /'ui_v2\.chat\.empty_guidance':\s*(?:'[^']*'|"[^"]*")/)
    assert.match(localeSource, /'ui_v2\.chat\.prompt_today':\s*(?:'[^']*'|"[^"]*")/)
    assert.match(localeSource, /'ui_v2\.chat\.prompt_clarify':\s*(?:'[^']*'|"[^"]*")/)
    assert.match(localeSource, /'ui_v2\.chat\.busy':\s*(?:'[^']*\{companionName\}[^']*'|"[^"]*\{companionName\}[^"]*")/)
    assert.match(localeSource, /'ui_v2\.chat\.open_reply':\s*(?:'[^']*\{reply\}[^']*'|"[^"]*\{reply\}[^"]*")/)
  }
})

test('chat sheet scroll policy follows user turns and exposes assistant updates after upward scrolling', () => {
  assert.equal(isChatSheetNearBottom(500, 428, 0), true)
  assert.equal(isChatSheetNearBottom(500, 427, 0), false)
  const userMessage = [{ id: 'u1', role: 'user' as const, content: 'hello' }]
  const assistantMessage = [{ id: 'a1', role: 'assistant' as const, content: 'hi' }]
  const nextAssistantMessage = [{ id: 'a2', role: 'assistant' as const, content: 'hello again' }]
  assert.equal(getChatSheetScrollDecision(assistantMessage, userMessage, false), 'follow')
  assert.equal(getChatSheetScrollDecision(assistantMessage, nextAssistantMessage, true), 'follow')
  assert.equal(getChatSheetScrollDecision(assistantMessage, assistantMessage, false), 'none')
  assert.equal(
    getChatSheetScrollDecision(
      [{ id: 'a1', role: 'assistant' as const, content: 'hi' }],
      [{ id: 'a1', role: 'assistant' as const, content: 'hi there' }],
      false,
    ),
    'announce',
  )
})

test('panel reply captions include the visible reply in the chat button accessible name', async () => {
  const source = await readFile(panelPath, 'utf8')
  assert.match(source, /aria-label=\{ti\('ui_v2\.chat\.open_reply',\s*\{\s*reply:\s*latestCaption\s*\}\)\}/)
})

test('completed reply announcements only speak a new reply once after a busy turn', async () => {
  const source = await readFile(sheetPath, 'utf8')
  assert.match(source, /if \(!wasBusy && busy\)[\s\S]{0,180}busyStartAssistantKeyRef\.current = latestAssistantKey/)
  assert.match(source, /if \(!wasBusy \|\| busy \|\| !latestAssistantKey[\s\S]{0,180}shouldAnnounceChatAssistantReply/)

  const oldReply = getChatAssistantMessageKey({ id: 'a1', content: 'old reply' })
  const newReply = getChatAssistantMessageKey({ id: 'a2', content: 'new reply' })
  assert.equal(shouldAnnounceChatAssistantReply(oldReply, oldReply, ''), false)
  assert.equal(shouldAnnounceChatAssistantReply(oldReply, null, ''), false)
  assert.equal(shouldAnnounceChatAssistantReply(oldReply, newReply, ''), true)
  assert.equal(shouldAnnounceChatAssistantReply(oldReply, newReply, newReply ?? ''), false)
})

test('outer companion status is silent while the chat sheet owns live status', async () => {
  const source = await readFile(panelPath, 'utf8')
  assert.match(source, /!chatSheetOpen \? \(\s*<span className="nexus-v2-sr-only" role="status" aria-live="polite" aria-atomic="true">/)
})

test('chat sheet overlays a fixed Live2D sibling without owning a relationship anchor', async () => {
  const [source, sheetSource, styles, framelessSource, petSource, legacyPanelSource, panelStyles] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(sheetPath, 'utf8'),
    readFile(sheetStylesPath, 'utf8'),
    readFile(framelessPath, 'utf8'),
    readFile(petPath, 'utf8'),
    readFile(legacyPanelPath, 'utf8'),
    readFile(panelStylesPath, 'utf8'),
  ])
  assert.doesNotMatch(sheetSource, /relationshipAnchor|chat-sheet-v2__relationship/)
  assert.doesNotMatch(styles, /chat-sheet-v2__relationship/)
  assert.match(source, /\{stage\}[\s\S]*?chatSheetOpen \? \(/)
  assert.doesNotMatch(source, /useRendererVisibility|rendererVisible/)
  assert.match(source, /paused=\{panelCollapsed \|\| hasModalOverlay\}/)
  assert.match(panelStyles, /nexus-panel-v2__experience--collapsed[\s\S]*?visibility: hidden[\s\S]*?pointer-events: none/)
  const experienceBlock = panelStyles.match(/\.nexus-panel-v2__experience\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(experienceBlock, /container-type:\s*inline-size/)
  const chatRootBlock = styles.match(/\.chat-sheet-v2\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.doesNotMatch(chatRootBlock, /container-type/)
  assert.match(styles, /\.chat-sheet-v2\s*\{[\s\S]*?position: absolute[\s\S]*?pointer-events: none/)
  assert.match(styles, /\.chat-sheet-v2__sheet\s*\{[\s\S]*?pointer-events: auto/)
  assert.match(framelessSource, /paused\?: boolean/)
  assert.match(framelessSource, /paused=\{paused\}/)
  assert.doesNotMatch(petSource, /useRendererVisibility|rendererVisible \? <FramelessCompanionSurface/)
  assert.match(petSource, /<FramelessCompanionSurface[\s\S]*?paused=\{hasModalOverlay\}/)
  assert.match(legacyPanelSource, /<Live2DCanvas[\s\S]*?paused=\{Boolean\(onboardingGuide\)\}/)
  assert.match(source, /!chatSheetOpen && latestCaption \? \(/)
  assert.match(source, /aria-label=\{ti\('ui_v2\.chat\.open_reply',\s*\{\s*reply:\s*latestCaption\s*\}\)\}/)
  assert.match(source, /onClick=\{\(\) => openChatSheet\(captionButtonRef\.current\)\}/)
})

test('ChatSheet isolates only the visible stage while preserving stage layout and focus return', async () => {
  const [panelSource, sheetSource, panelStyles] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(sheetPath, 'utf8'),
    readFile(panelStylesPath, 'utf8'),
  ])
  const stageRule = panelStyles.match(/(?:^|\n)\.nexus-panel-v2__stage\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(
    panelSource,
    /className="nexus-panel-v2__stage"[\s\S]*?aria-hidden=\{chatSheetOpen \? true : undefined\}[\s\S]*?inert=\{chatSheetOpen \? true : undefined\}/,
  )
  assert.match(panelSource, /\{stage\}[\s\S]*?chatSheetOpen \? \([\s\S]*?<ChatSheetV2/)
  assert.match(sheetSource, /useModalFocusTrap\(dialogRef, true\)/)
  assert.match(sheetSource, /if \(initiallyEmptyRef\.current\) inputRef\.current\?\.focus\(\)/)
  assert.match(sheetSource, /else backButtonRef\.current\?\.focus\(\)/)
  assert.match(panelSource, /const closeChatSheet = \(\) => \{[\s\S]{0,500}target\?\.isConnected\) target\.focus\(\)/)
  assert.match(stageRule, /inset:\s*0/)
  assert.doesNotMatch(stageRule, /display:\s*none|visibility:\s*hidden/)
  assert.match(panelStyles, /\.nexus-panel-v2__live2d\s*\{[\s\S]*?width:\s*min\(480px, calc\(100% - 32px\)\)/)
  assert.match(panelStyles, /\.nexus-panel-v2__live2d \.live2d-shell,[\s\S]*?height:\s*100%/)
})

test('empty medium-width chat sheet stays compact without changing non-empty history height', async () => {
  const styles = await readFile(sheetStylesPath, 'utf8')

  assert.match(styles, /@container \(min-width: 400px\) and \(max-width: 719px\)/)
  assert.doesNotMatch(styles, /@container \(min-width: 440px\) and \(max-width: 719px\)/)
  assert.match(styles, /height:\s*min\(66%, 450px\)/)
  assert.match(
    styles,
    /\.chat-sheet-v2\[data-empty='true'\] \.chat-sheet-v2__sheet\s*\{\s*height:\s*min\(50%, 320px\)/,
  )
  const mediumRulesStart = styles.indexOf('@container (min-width: 400px) and (max-width: 719px)')
  const wideRulesStart = styles.indexOf('@container (min-width: 720px)')
  const mediumRules = styles.slice(mediumRulesStart, wideRulesStart)
  assert.match(mediumRules, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(mediumRules, /\.chat-sheet-v2__history\s*\{\s*padding: 4px 12px 8px/)
  assert.match(mediumRules, /\.chat-sheet-v2__composer\s*\{\s*min-height: 72px/)
  assert.match(mediumRules, /\.chat-sheet-v2__input\s*\{\s*min-height: 52px/)
  assert.match(
    styles.slice(wideRulesStart),
    /@container \(min-width: 720px\)[\s\S]*?\.chat-sheet-v2\s*\{[\s\S]*?grid-template-columns:\s*minmax\(300px, 1fr\) minmax\(360px, 380px\)/,
  )
  assert.match(styles, /\.chat-sheet-v2__send\s*\{[\s\S]*?background: var\(--chat-sheet-v2-accent-strong\)/)
  assert.match(styles, /\.chat-sheet-v2__input::placeholder\s*\{\s*color: var\(--chat-sheet-v2-placeholder\)/)

  const sheetRule = styles.match(/(?:^|\n)\.chat-sheet-v2__sheet\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const headerRule = styles.match(/(?:^|\n)\.chat-sheet-v2__header\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const historyRule = styles.match(/(?:^|\n)\.chat-sheet-v2__history\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const composerZoneRule = styles.match(/(?:^|\n)\.chat-sheet-v2__composer-zone\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(sheetRule, /overflow:\s*hidden/)
  assert.match(headerRule, /flex:\s*0 0 52px/)
  assert.match(historyRule, /flex:\s*1 1 auto/)
  assert.match(historyRule, /min-height:\s*0/)
  assert.match(historyRule, /overflow:\s*auto/)
  assert.match(composerZoneRule, /flex:\s*0 0 auto/)
})

test('V2 companion surfaces do not render a decorative presence halo', async () => {
  const [panelSource, framelessSource] = await Promise.all([
    readFile(panelPath, 'utf8'),
    readFile(framelessPath, 'utf8'),
  ])

  assert.doesNotMatch(panelSource, /PresenceHalo|nexus-v2-halo/)
  assert.doesNotMatch(framelessSource, /PresenceHalo|nexus-v2-halo/)
})
