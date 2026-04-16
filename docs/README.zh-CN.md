<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <b>简体中文</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a>
</p>

---

## 简介

Nexus 是一个跨平台的桌面 AI 陪伴应用，集成 Live2D 角色渲染、连续语音对话、长期记忆、桌面感知、自主行为与多平台集成能力。支持 18+ LLM 提供商，可完全本地运行或使用云端模型。

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **桌宠 + 面板双视图** | Live2D 角色渲染，表情 / 动作 / 情绪联动 |
| **连续语音对话** | 多引擎 STT / TTS，常驻唤醒词（sherpa-onnx KWS）、**主进程 Silero VAD**（共享音频无 mic 冲突）、连续对话、语音打断 |
| **长期记忆** | 语义向量检索（BM25 + 向量混合）、每日自动日记、主动召回、记忆衰减与归档 |
| **自主行为** | 内心独白、情绪模型、意图预测、关系追踪、节律学习、技能蒸馏 |
| **桌面感知** | 剪贴板监听、前台窗口识别、截图 OCR、上下文触发器 |
| **工具调用** | 网页搜索（自动正文提取）、天气查询、提醒任务、MCP 协议接入 |
| **多平台集成** | Discord / Telegram 网关、插件系统、技能商店 |
| **多语言** | 简中 / 繁中 / 英 / 日 / 韩界面语言 |

---

## 推荐模型配置

> 此推荐针对**简体中文用户**。其他语言请查看 [English](../README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)。

### 对话模型（LLM）

| 场景 | 推荐提供商 | 推荐模型 | 说明 |
|------|-----------|---------|------|
| **日常陪伴（首选）** | DeepSeek | `deepseek-chat` | 中文能力强、价格极低，适合长时间陪伴对话 |
| **日常陪伴（备选）** | DashScope Qwen | `qwen-plus` | 阿里通义千问，中文自然，长上下文支持好 |
| **深度推理** | DeepSeek | `deepseek-reasoner` | 需要复杂推理、数学、代码时使用 |
| **最强综合** | Anthropic | `claude-sonnet-4-6` | 综合能力最强，工具调用稳定 |
| **高性价比（海外）** | OpenAI | `gpt-5.4-mini` | 速度快、便宜，适合高频对话 |
| **免费体验** | Google Gemini | `gemini-2.5-flash` | 免费额度大，适合入门体验 |

### 语音输入（STT）

| 场景 | 推荐提供商 | 推荐模型 | 说明 |
|------|-----------|---------|------|
| **本地高精度** | GLM-ASR-Nano | `glm-asr-nano` | 中文识别准确率高，RTX 3060 可流畅运行，完全离线 |
| **本地流式** | Paraformer | `paraformer-trilingual` | 边说边出字，延迟低，中英粤三语，适合连续对话 |
| **本地备选** | SenseVoice | `sensevoice-zh-en` | 比 Whisper 快 15 倍，中英双语离线识别 |
| **云端首选** | 智谱 GLM-ASR | `glm-asr-2512` | 中文最佳，支持热词纠正 |
| **云端备选** | 火山引擎 | `bigmodel` | 字节跳动大模型语音识别，中文优秀 |
| **云端备选** | 腾讯云 ASR | `16k_zh` | 实时流式识别，延迟低 |

### 语音输出（TTS）

| 场景 | 推荐提供商 | 推荐音色 | 说明 |
|------|-----------|---------|------|
| **免费首选** | Edge TTS | 晓晓 (`zh-CN-XiaoxiaoNeural`) | 微软免费，音质好，无需 API Key |
| **本地离线** | OmniVoice | 内置音色 | 完全离线，本地端口 8000，RTX 3060 可运行 |
| **最自然** | MiniMax | 少女音色 (`female-shaonv`) | 情感表现力强，适合陪伴角色 |
| **中文指令化** | DashScope Qwen-TTS | `Cherry` | 阿里 Qwen3-TTS，支持方言和指令化播报 |
| **高性价比** | 火山引擎 | 灿灿 (`BV700_streaming`) | 自然度高，价格低 |

---

## 开发机配置参考

| 组件 | 型号 |
|------|------|
| CPU | Intel Core i5-12400F (6C12T) |
| GPU | NVIDIA GeForce RTX 3060 12GB |
| 内存 | 32GB DDR4 |

> RTX 3060 12GB 可以流畅运行大部分本地模型（8B 参数以下），包括本地 STT 和 TTS。如果你的显卡 VRAM < 8GB，建议优先使用云端模型。

---

## 许可证

[MIT](../LICENSE)
