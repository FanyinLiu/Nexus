# Communication Message Webhook

Nexus can announce communication-app messages through the local notification bridge.
Telegram and Discord use first-party bot/gateway integrations. Apps such as WeChat,
QQ, WeCom, DingTalk, Feishu/Lark, Slack, Teams, and custom tools can post a local
message payload into Nexus instead of requiring Nexus to read private app databases.

## Enable

In Nexus settings:

1. Open Presence.
2. Enable External Notification Bridge.
3. Enable Announce webhook chat messages.
4. Enable Read webhook message previews aloud only if speaking message text is acceptable.

The settings panel shows:

- `POST http://127.0.0.1:47830/webhook`
- `Authorization: Bearer ...`

The webhook is bound to `127.0.0.1` and requires the bearer token stored in the
Nexus user-data directory as `notification-webhook-token.txt`.

## Payload

Send ordinary notifications with:

```json
{
  "title": "Build finished",
  "body": "green",
  "source": "CI"
}
```

Send communication messages with explicit `kind: "message"`:

```json
{
  "kind": "message",
  "source": "微信",
  "sender": "张三",
  "chatTitle": "项目群",
  "text": "晚上同步一下进展",
  "conversationId": "wechat-room-1",
  "messageId": "wechat-msg-123"
}
```

Supported aliases:

- source: `sourceName`, `source`, `app`, `application`
- sender: `sender`, `fromUser`, `from`, `author`
- text: `body`, `text`, `message`
- conversation: `conversationId`, `chatId`, `roomId`, `channelId`, `threadId`
- message id: `messageId`, `id`, `eventId`
- title: `title`, `conversationTitle`, `chatTitle`, `roomName`, `channelName`

Use stable `conversationId` and `messageId` when the adapter can provide them.
Nexus uses them to dedupe repeated announcements.

## CLI Helper

For local automation scripts, use:

```bash
npm run message:send -- \
  --source 微信 \
  --sender 张三 \
  --chat-title 项目群 \
  --conversation-id wechat-room-1 \
  --message-id wechat-msg-123 \
  --text "晚上同步一下进展"
```

The CLI tries to read the Nexus webhook token from common user-data locations.
You can also pass a token copied from settings:

```bash
node scripts/send-message-webhook.mjs \
  --token "Bearer nexus_..." \
  --source 企业微信 \
  --sender 李四 \
  --chat-title 发布群 \
  --text "麻烦看下发布清单"
```

Packaged builds unpack these helper scripts under the application resources
directory as `app.asar.unpacked/scripts/...`, so external automation can still
call them without depending on the source checkout.

Direct `curl` works too:

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer nexus_...' \
  -d '{"kind":"message","source":"QQ","sender":"王五","chatTitle":"同学群","text":"到了吗","conversationId":"qq-room-1","messageId":"qq-msg-1"}' \
  http://127.0.0.1:47830/webhook
```

## Platform Adapter Helpers

The repository includes small adapters that call the same CLI contract.

macOS Shortcuts / Keyboard Maestro / shell automation:

```bash
bash scripts/communication-adapters/macos-shortcuts-message.sh \
  --source 微信 \
  --sender 张三 \
  --chat-title 项目群 \
  --conversation-id wechat-room-1 \
  --message-id wechat-msg-1 \
  --text "晚上同步一下进展"
```

In Shortcuts, add a "Run Shell Script" step, paste the command above, and map
the Shortcut input or matched notification text to `--text`.

Hammerspoon:

```lua
local nexus = dofile("/path/to/Nexus/scripts/communication-adapters/hammerspoon-nexus-message.lua")
nexus.configure({ projectRoot = "/path/to/Nexus" })
nexus.send({
  source = "微信",
  sender = "张三",
  chatTitle = "项目群",
  text = "晚上同步一下进展",
  conversationId = "wechat-room-1",
  messageId = "wechat-msg-1",
})
```

macOS Notification Center watcher:

```bash
node scripts/communication-adapters/macos-notification-center-watch.mjs \
  --once \
  --dry-run
```

Remove `--once --dry-run` to keep watching and send matching notifications to Nexus:

```bash
node scripts/communication-adapters/macos-notification-center-watch.mjs
```

The watcher auto-detects common macOS notification databases and filters for
WeChat, WeCom, QQ, Telegram, Discord, DingTalk, Feishu/Lark, Slack, and Teams.
If auto-detection fails, pass a known database path:

```bash
node scripts/communication-adapters/macos-notification-center-watch.mjs \
  --db "$HOME/Library/Application Support/NotificationCenter/<id>/db" \
  --apps "微信|WeChat|QQ|Telegram|Discord"
```

The process running the watcher may need Full Disk Access in macOS System
Settings. The watcher reads Notification Center history only; it does not read
private app chat databases.

Windows PowerShell / AutoHotkey bridge:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\communication-adapters\windows-message-webhook.ps1 `
  -Source "企业微信" `
  -Sender "李四" `
  -ChatTitle "发布群" `
  -ConversationId "wecom-room-1" `
  -MessageId "wecom-msg-1" `
  -Text "麻烦看下发布清单"
```

## Adapter Notes

- Prefer public APIs or user-owned automation sources.
- Do not scrape private local databases unless the user explicitly owns the data and accepts the privacy risk.
- For Chinese desktop apps, the practical path is a small per-app adapter that observes system notifications,
  automation events, or exported message events, then calls this webhook contract.
- Keep message text out of speech by leaving Read webhook message previews aloud disabled.
