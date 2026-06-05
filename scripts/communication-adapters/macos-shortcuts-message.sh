#!/usr/bin/env bash
set -euo pipefail

# macOS Shortcuts adapter for Nexus communication-message announcements.
# Use it from a Shortcut "Run Shell Script" action, Hammerspoon, Keyboard Maestro,
# or any app-specific automation that can pass message text into stdin/args.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLI="${PROJECT_ROOT}/scripts/send-message-webhook.mjs"

SOURCE="${NEXUS_MESSAGE_SOURCE:-Local Message}"
SENDER="${NEXUS_MESSAGE_SENDER:-}"
CHAT_TITLE="${NEXUS_MESSAGE_CHAT_TITLE:-}"
CONVERSATION_ID="${NEXUS_MESSAGE_CONVERSATION_ID:-}"
MESSAGE_ID="${NEXUS_MESSAGE_ID:-}"
TOKEN="${NEXUS_NOTIFICATION_WEBHOOK_TOKEN:-}"
TEXT="${NEXUS_MESSAGE_TEXT:-}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source|--app)
      SOURCE="${2:-}"
      shift 2
      ;;
    --sender|--from)
      SENDER="${2:-}"
      shift 2
      ;;
    --chat-title|--title)
      CHAT_TITLE="${2:-}"
      shift 2
      ;;
    --conversation-id|--chat-id|--room-id)
      CONVERSATION_ID="${2:-}"
      shift 2
      ;;
    --message-id|--event-id)
      MESSAGE_ID="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --text|--message|--body)
      TEXT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: bash scripts/communication-adapters/macos-shortcuts-message.sh --source 微信 --sender 张三 --text "晚上同步一下"

Environment aliases:
  NEXUS_MESSAGE_SOURCE, NEXUS_MESSAGE_SENDER, NEXUS_MESSAGE_CHAT_TITLE
  NEXUS_MESSAGE_CONVERSATION_ID, NEXUS_MESSAGE_ID, NEXUS_MESSAGE_TEXT
  NEXUS_NOTIFICATION_WEBHOOK_TOKEN

If no --text or NEXUS_MESSAGE_TEXT is provided, the script reads stdin.
USAGE
      exit 0
      ;;
    *)
      TEXT="${TEXT:+${TEXT} }$1"
      shift
      ;;
  esac
done

if [[ -z "$TEXT" ]]; then
  TEXT="$(cat)"
fi

ARGS=(--source "$SOURCE" --text "$TEXT")

if [[ -n "$SENDER" ]]; then ARGS+=(--sender "$SENDER"); fi
if [[ -n "$CHAT_TITLE" ]]; then ARGS+=(--chat-title "$CHAT_TITLE"); fi
if [[ -n "$CONVERSATION_ID" ]]; then ARGS+=(--conversation-id "$CONVERSATION_ID"); fi
if [[ -n "$MESSAGE_ID" ]]; then ARGS+=(--message-id "$MESSAGE_ID"); fi
if [[ -n "$TOKEN" ]]; then ARGS+=(--token "$TOKEN"); fi
if [[ "$DRY_RUN" == "1" ]]; then ARGS+=(--dry-run); fi

exec node "$CLI" "${ARGS[@]}"
