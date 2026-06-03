#!/usr/bin/env bash
# ============================================
#   Nexus 本地可选环境一键配置（macOS / Linux）
# ============================================
#
# 处理两件 setup.sh 没覆盖的事：
#   1. 下载 Silero VAD v5 模型（更准的说话结束检测）
#   2. 把 NEXUS_PYTHON 写进 shell rc，让本地 Python 服务
#      （OmniVoice TTS / GLM-ASR）用 3.10+ 而不是 macOS 系统自带的 3.9
#
# 云端 Z.ai / 智谱 路径不需要 Python，只下 VAD 即可。
#
# Usage:
#   bash scripts/setup-local-env.sh
#
# 幂等：重复跑不会重复写 rc 文件，已有模型会跳过。
set -e

cd "$(dirname "$0")/.."

echo
echo "============================================"
echo "  Nexus 本地可选环境配置"
echo "============================================"
echo

# ── 第 1 步：下载 Silero VAD ───────────────────
echo "[1/2] 下载 Silero VAD 模型（≈2 MB）..."
node scripts/download-models.mjs
echo

# ── 第 2 步：定位 python3.10+ 并写 NEXUS_PYTHON ─
echo "[2/2] 配置 NEXUS_PYTHON..."

PY=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" &>/dev/null; then
    PY="$(command -v "$candidate")"
    break
  fi
done

if [ -z "$PY" ]; then
  cat <<'EOF'
[跳过] 没找到 python3.10 / 3.11 / 3.12。
       云端 Z.ai / 智谱 方案不需要 Python，可以直接忽略这步。
       如果想用本地 OmniVoice TTS / GLM-ASR，安装一个 Python 3.11：
         macOS:  brew install python@3.11
         Linux:  见发行版文档
       装完重新跑: bash scripts/setup-local-env.sh
EOF
  echo
  echo "============================================"
  echo "  完成（仅 VAD 部分）"
  echo "============================================"
  exit 0
fi

echo "[发现] $PY ($("$PY" --version 2>&1))"

# 选对应 shell 的 rc 文件
SHELL_NAME="$(basename "${SHELL:-sh}")"
case "$SHELL_NAME" in
  zsh)   RC="$HOME/.zshrc" ;;
  bash)  RC="$HOME/.bash_profile"; [ -f "$RC" ] || RC="$HOME/.bashrc" ;;
  fish)  RC="$HOME/.config/fish/config.fish" ;;
  *)     RC="$HOME/.profile" ;;
esac

mkdir -p "$(dirname "$RC")"
touch "$RC"

if grep -qE '^[^#]*NEXUS_PYTHON=' "$RC"; then
  echo "[跳过] $RC 已存在 NEXUS_PYTHON 设置，保留现有配置。"
  CURRENT_LINE="$(grep -E '^[^#]*NEXUS_PYTHON=' "$RC" | head -1)"
  echo "       当前: $CURRENT_LINE"
else
  {
    echo ''
    echo '# Nexus — 让本地 Python 服务用 3.10+ 而不是系统默认 3.9'
    if [ "$SHELL_NAME" = "fish" ]; then
      echo "set -gx NEXUS_PYTHON \"$PY\""
    else
      echo "export NEXUS_PYTHON=\"$PY\""
    fi
  } >> "$RC"
  echo "[写入] $RC"
  echo "       export NEXUS_PYTHON=\"$PY\""
fi

echo
echo "============================================"
echo "  全部完成！"
echo "============================================"
echo
echo "  下一步："
echo "    1. 重开一个终端窗口，或执行：source \"$RC\""
echo "    2. 验证：echo \$NEXUS_PYTHON"
echo "    3. 自检：npm run doctor"
echo "    4. 重启：npm run electron:dev"
echo "       网页预览看：http://127.0.0.1:47821/"
echo "       Ollama API 是：http://127.0.0.1:11434/v1，不是网页预览"
echo
