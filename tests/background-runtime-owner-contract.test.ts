import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

test('App selects Pet as the sole background runtime owner', () => {
  const appController = read('src/app/controllers/useAppController.ts')
  assert.match(appController, /const backgroundRuntimeOwner = view === 'pet'/)

  const schedulerCall = appController.match(/useBackgroundSchedulers\(\{[\s\S]*?\n {2}\}\)/)?.[0] ?? ''
  assert.match(schedulerCall, /enabled: backgroundRuntimeOwner/)
  assert.match(schedulerCall, /runtimeOwner: backgroundRuntimeOwner/)

  const autonomyCall = appController.match(/useAutonomyController\(\{[\s\S]*?\n {2}\}\)/)?.[0] ?? ''
  assert.match(autonomyCall, /runtimeOwner: backgroundRuntimeOwner/)
  assert.match(autonomyCall, /active: backgroundRuntimeOwner/)
})

test('non-owner notification effects return before shared IPC or cleanup', () => {
  const autonomy = read('src/app/controllers/useAutonomyController.ts')
  const notifications = read('src/hooks/useNotificationBridge.ts')

  assert.match(
    autonomy,
    /useEffect\(\(\) => \{\s*if \(!backgroundRuntimeEnabled\) return\s*void window\.desktopPet\?\.notificationWatcherSet/s,
  )
  assert.doesNotMatch(
    notifications,
    /useEffect\(\(\) => \{\s*if \(!runtimeOwner\) return\s*writeJson/s,
  )
  assert.doesNotMatch(
    notifications,
    /useEffect\(\(\) => \{\s*writeJson\(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY/s,
  )
  const remoteEffectStart = notifications.indexOf('useEffect(() => onStorageChange(')
  const remoteEffectEnd = notifications.indexOf('// Clean up expired snoozes', remoteEffectStart)
  assert.ok(remoteEffectStart >= 0)
  assert.ok(remoteEffectEnd > remoteEffectStart)
  assert.doesNotMatch(
    notifications.slice(remoteEffectStart, remoteEffectEnd),
    /writeJson|onNotification/,
  )
  assert.match(
    notifications,
    /useEffect\(\(\) => \{\s*if \(!runtimeOwner\) return\s*const intervalId = window\.setInterval/s,
  )
  assert.match(
    notifications,
    /useEffect\(\(\) => \{\s*if \(!runtimeOwner\) return\s*if \(!enabled\) return\s*void window\.desktopPet\?\.startNotificationBridge/s,
  )
})

test('explicit notification channel edits remain available to Panel settings', () => {
  const notifications = read('src/hooks/useNotificationBridge.ts')
  const channelQuery = notifications.slice(
    notifications.indexOf('// Channel configuration is a settings data query'),
    notifications.indexOf('// Functional setState', notifications.indexOf('// Channel configuration is a settings data query')),
  )
  assert.match(channelQuery, /const getNotificationChannels = window\.desktopPet\?\.getNotificationChannels/)
  assert.doesNotMatch(channelQuery, /runtimeOwner/)
  const manualActions = notifications.slice(
    notifications.indexOf('const addChannel = useCallback'),
    notifications.indexOf('// ── Bridge lifecycle'),
  )
  assert.match(manualActions, /const addChannel = useCallback[\s\S]*setNotificationChannels/)
  assert.match(manualActions, /const updateChannel = useCallback[\s\S]*setNotificationChannels/)
  assert.match(manualActions, /const removeChannel = useCallback[\s\S]*setNotificationChannels/)
  assert.doesNotMatch(manualActions, /if \(!runtimeOwner\) return/)
})

test('Telegram and Discord keep owner and feature switches separate', () => {
  for (const relativePath of ['src/hooks/useTelegramGateway.ts', 'src/hooks/useDiscordGateway.ts']) {
    const source = read(relativePath)
    assert.match(source, /runtimeOwner\?: boolean/)
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*if \(!runtimeOwner\) return\s*if \(!enabled\) \{[\s\S]*?(?:telegram|discord)Disconnect/s,
    )
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*if \(!runtimeOwner\) return\s*if \(!enabled\) return\s*const unsubscribe/s,
    )
  }
})

test('scheduler and context hooks are disabled without creating background work', () => {
  const schedulers = read('src/app/controllers/useBackgroundSchedulers.ts')
  const context = read('src/hooks/useContextScheduler.ts')
  assert.match(schedulers, /const schedulerEnabled = enabled && runtimeOwner/)
  for (const name of [
    'useAwayNotificationScheduler',
    'useBracketScheduler',
    'useLetterScheduler',
    'useErrandScheduler',
    'useFutureCapsuleScheduler',
    'useOpenArcScheduler',
    'useGuidanceAnalysisScheduler',
  ]) {
    assert.match(schedulers, new RegExp(`${name}[\\s\\S]*enabled: schedulerEnabled`))
  }
  assert.match(
    context,
    /const evaluateTriggers = useCallback\(async \(\) => \{\s*if \(!enabled\) return\s*const settings/s,
  )
})

test('background readiness gates precede cadence, prompt, and LLM work', () => {
  const dream = read('src/hooks/useMemoryDream.ts')
  const dreamRun = dream.slice(dream.indexOf('const runDream ='), dream.indexOf('\n  return {', dream.indexOf('const runDream =')))
  assert.ok(dreamRun.indexOf('getBackgroundChatGate') < dreamRun.indexOf('dreamRunningRef.current = true'))
  assert.ok(dreamRun.indexOf('dreamRunningRef.current = true') < dreamRun.indexOf('buildDreamPrompt'))
  assert.match(dreamRun, /background:dream['"][\s\S]*background:dream-skill['"][\s\S]*background:dream-reflection/)

  const v2 = read('src/app/controllers/useAutonomyV2Engine.ts')
  const considerTick = v2.slice(v2.indexOf('const considerTick ='), v2.indexOf('\n  return {', v2.indexOf('const considerTick =')))
  assert.ok(considerTick.indexOf('getBackgroundChatGate') < considerTick.indexOf('considerCounterRef.current += 1'))
  assert.ok(considerTick.indexOf('considerCounterRef.current += 1') < considerTick.indexOf('gatherAutonomyContext'))
  assert.match(considerTick, /traceId: 'background:autonomy-v2'/)

  const letter = read('src/hooks/useLetterScheduler.ts')
  const letterTick = letter.slice(letter.indexOf('const tick = async'), letter.indexOf('const id = window.setInterval'))
  assert.ok(letterTick.indexOf('getBackgroundChatGate') < letterTick.indexOf('loadActivePersona'))
  assert.ok(letterTick.indexOf('loadActivePersona') < letterTick.indexOf('callLetterLLM'))
  assert.match(letter, /traceId: 'background:letter'/)
})
