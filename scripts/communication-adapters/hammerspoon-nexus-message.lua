-- Hammerspoon helper for sending communication-app messages to Nexus.
--
-- Example ~/.hammerspoon/init.lua:
--
--   local nexus = dofile("/path/to/Nexus/scripts/communication-adapters/hammerspoon-nexus-message.lua")
--   nexus.configure({ projectRoot = "/path/to/Nexus" })
--   nexus.send({
--     source = "微信",
--     sender = "张三",
--     chatTitle = "项目群",
--     text = "晚上同步一下进展",
--     conversationId = "wechat-room-1",
--     messageId = "wechat-msg-123",
--   })

local M = {}

local config = {
  projectRoot = nil,
  node = "node",
  token = nil,
}

local function shellQuote(value)
  local text = tostring(value or "")
  return "'" .. text:gsub("'", "'\\''") .. "'"
end

local function appendArg(parts, name, value)
  if value ~= nil and tostring(value) ~= "" then
    table.insert(parts, name)
    table.insert(parts, shellQuote(value))
  end
end

function M.configure(opts)
  opts = opts or {}
  if opts.projectRoot then config.projectRoot = opts.projectRoot end
  if opts.node then config.node = opts.node end
  if opts.token then config.token = opts.token end
end

function M.buildCommand(message)
  if not config.projectRoot or config.projectRoot == "" then
    error("Nexus projectRoot is required")
  end
  if not message or not message.text or tostring(message.text) == "" then
    error("message.text is required")
  end

  local cli = config.projectRoot .. "/scripts/send-message-webhook.mjs"
  local parts = { shellQuote(config.node), shellQuote(cli) }

  appendArg(parts, "--source", message.source or "Local Message")
  appendArg(parts, "--sender", message.sender)
  appendArg(parts, "--chat-title", message.chatTitle)
  appendArg(parts, "--conversation-id", message.conversationId)
  appendArg(parts, "--message-id", message.messageId)
  appendArg(parts, "--token", message.token or config.token)
  appendArg(parts, "--text", message.text)

  if message.dryRun then
    table.insert(parts, "--dry-run")
  end

  return table.concat(parts, " ")
end

function M.send(message)
  local command = M.buildCommand(message)
  local output, ok, exitType, rc = hs.execute(command, true)
  return ok, output, exitType, rc
end

return M
