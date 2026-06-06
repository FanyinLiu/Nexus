param(
  [string]$Source = $env:NEXUS_MESSAGE_SOURCE,
  [string]$Sender = $env:NEXUS_MESSAGE_SENDER,
  [string]$Text = $env:NEXUS_MESSAGE_TEXT,
  [string]$ChatTitle = $env:NEXUS_MESSAGE_CHAT_TITLE,
  [string]$ConversationId = $env:NEXUS_MESSAGE_CONVERSATION_ID,
  [string]$MessageId = $env:NEXUS_MESSAGE_ID,
  [string]$Token = $env:NEXUS_NOTIFICATION_WEBHOOK_TOKEN,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptRoot '..\..')
$Cli = Join-Path $ProjectRoot 'scripts\send-message-webhook.mjs'

if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = 'Local Message'
}

if ([string]::IsNullOrWhiteSpace($Text)) {
  $stdinText = [Console]::In.ReadToEnd()
  if (-not [string]::IsNullOrWhiteSpace($stdinText)) {
    $Text = $stdinText
  }
}

if ([string]::IsNullOrWhiteSpace($Text)) {
  Write-Error 'Message text is required. Pass -Text or pipe text into this script.'
}

$ArgsList = @('--source', $Source, '--text', $Text)

if (-not [string]::IsNullOrWhiteSpace($Sender)) { $ArgsList += @('--sender', $Sender) }
if (-not [string]::IsNullOrWhiteSpace($ChatTitle)) { $ArgsList += @('--chat-title', $ChatTitle) }
if (-not [string]::IsNullOrWhiteSpace($ConversationId)) { $ArgsList += @('--conversation-id', $ConversationId) }
if (-not [string]::IsNullOrWhiteSpace($MessageId)) { $ArgsList += @('--message-id', $MessageId) }
if (-not [string]::IsNullOrWhiteSpace($Token)) { $ArgsList += @('--token', $Token) }
if ($DryRun) { $ArgsList += '--dry-run' }

& node $Cli @ArgsList
exit $LASTEXITCODE
