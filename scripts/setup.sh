#!/usr/bin/env bash
# ============================================
#   Nexus 一键安装脚本（macOS / Linux）
# ============================================
set -e

echo
echo "============================================"
echo "  Nexus 一键安装脚本"
echo "============================================"
echo

# ── 检查 Node.js ──
if ! command -v node &>/dev/null; then
  echo "[错误] 未检测到 Node.js，请先安装："
  echo "  macOS:  brew install node"
  echo "  Ubuntu: sudo apt install nodejs npm"
  echo "  或访问: https://nodejs.org"
  exit 1
fi
echo "[信息] Node.js 版本: $(node -v)"

# ── 检查 git ──
if ! command -v git &>/dev/null; then
  echo "[错误] 未检测到 git，请先安装："
  echo "  macOS:  brew install git"
  echo "  Ubuntu: sudo apt install git"
  exit 1
fi

# ── 第1步：安装 npm 依赖 ──
echo
echo "[1/4] 安装 npm 依赖..."
npm install
echo "[完成] npm 依赖安装成功"

# ── 第1.5步：验证 sherpa-onnx-node 可加载 ──
# sherpa-onnx-node 用 optionalDependencies 分发平台原生二进制 (darwin-arm64 /
# darwin-x64 / linux-x64 / linux-arm64 / win-x64 / win-ia32)。如果 npm 选了错
# 误的 optional 包或平台没有对应二进制，require() 会在启动时抛错 —— 提前检
# 测更友好。
echo
echo "[验证] 检查 sherpa-onnx-node 原生模块..."
if node -e "require('sherpa-onnx-node')" 2>/dev/null; then
  echo "[完成] sherpa-onnx-node 加载成功"
else
  echo "[警告] sherpa-onnx-node 加载失败。当前平台: $(node -p 'process.platform + \"-\" + process.arch')"
  echo "       STT / 语音合成相关功能可能不可用。"
  echo "       修复提示: rm -rf node_modules package-lock.json && npm install"
fi

# ── 第2步：构建项目 ──
echo
echo "[2/4] 构建项目..."
npm run build
echo "[完成] 构建成功"

# ── 第3步：下载语音模型 ──
echo
echo "[3/4] 下载语音模型..."
node scripts/download-models.mjs
echo "[完成] 模型下载完成"

# ── 第4步：Python 依赖（可选） ──
echo
echo "[4/4] 检查 Python AI 服务依赖（可选）..."

install_python_deps() {
  local PY=""
  if command -v python3 &>/dev/null; then
    PY=python3
  elif command -v python &>/dev/null; then
    PY=python
  fi

  if [ -z "$PY" ]; then
    echo "[跳过] 未检测到 Python，OmniVoice TTS 和 GLM-ASR 将不可用"
    echo "       安装 Python 3.10+ 后运行: pip install -r requirements.txt"
    return
  fi

  echo "[信息] Python: $($PY --version)"

  # Check if torch is already installed
  if $PY -c "import torch" 2>/dev/null; then
    echo "[信息] PyTorch 已安装"
  else
    echo "[提示] PyTorch 未安装。推荐手动安装以选择 CPU/CUDA 版本："
    echo "  CPU:  pip install torch torchaudio"
    echo "  CUDA: pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126"
    echo
    read -p "是否安装 CPU 版 PyTorch？[y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      $PY -m pip install torch torchaudio
    else
      echo "[跳过] PyTorch 未安装，AI 语音服务将不可用"
      return
    fi
  fi

  echo "[安装] 其他 Python 依赖..."
  $PY -m pip install -r requirements.txt
  echo "[完成] Python 依赖安装成功"
}

install_python_deps

echo
echo "============================================"
echo "  安装完成！"
echo "============================================"
echo
echo "  启动开发模式:    npm run electron:dev"
echo "  快速自检:        npm run doctor"
echo "  网页预览地址:    http://127.0.0.1:47821/"
echo "  Ollama API:      http://127.0.0.1:11434/v1  (不是网页预览)"
echo "  打包 macOS:      npm run package:mac"
echo "  打包 Linux:      npm run package:linux"
echo
