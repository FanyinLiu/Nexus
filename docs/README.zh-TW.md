<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="README.ja.md">日本語</a>
</p>

---

## 簡介

Nexus 是一款跨平台的桌面 AI 陪伴應用，整合 Live2D 角色渲染、連續語音對話、長期記憶、桌面感知、自主行為與多平台整合能力。支援 18+ LLM 供應商，可完全本地運行或使用雲端模型。

---

## 核心功能

| 功能 | 說明 |
|------|------|
| **桌寵 + 面板雙視圖** | Live2D 角色渲染，表情 / 動作 / 情緒聯動 |
| **連續語音對話** | 多引擎 STT / TTS，喚醒詞、VAD 語音活動檢測、連續對話、語音打斷 |
| **長期記憶** | 語義向量檢索（BM25 + 向量混合）、每日自動日記、主動召回、記憶衰減與歸檔 |
| **自主行為** | 內心獨白、情緒模型、意圖預測、關係追蹤、節律學習、技能蒸餾 |
| **桌面感知** | 剪貼簿監聽、前台視窗識別、截圖 OCR、上下文觸發器 |
| **工具呼叫** | 網頁搜尋（自動正文提取）、天氣查詢、提醒任務、MCP 協定接入 |
| **多平台整合** | Discord / Telegram 閘道、外掛系統、技能商店 |
| **多語言** | 簡中 / 繁中 / 英 / 日 / 韓介面語言 |

---

## 推薦模型配置

### 對話模型（LLM）

| 場景 | 推薦供應商 | 推薦模型 | 說明 |
|------|-----------|---------|------|
| **日常陪伴（首選）** | DeepSeek | `deepseek-chat` | 中文能力強、價格極低，適合長時間陪伴對話 |
| **日常陪伴（備選）** | DashScope Qwen | `qwen-plus` | 阿里通義千問，中文自然，長上下文支援好 |
| **深度推理** | DeepSeek | `deepseek-reasoner` | 需要複雜推理、數學、程式碼時使用 |
| **最強綜合** | Anthropic | `claude-sonnet-4-6` | 綜合能力最強，工具呼叫穩定 |
| **高性價比（海外）** | OpenAI | `gpt-5.4-mini` | 速度快、便宜，適合高頻對話 |
| **免費體驗** | Google Gemini | `gemini-2.5-flash` | 免費額度大，適合入門體驗 |
| **本地運行** | Ollama | `qwen3:8b` | RTX 3060 12GB 可流暢運行，完全離線 |

### 語音輸入（STT）

| 場景 | 推薦供應商 | 推薦模型 | 說明 |
|------|-----------|---------|------|
| **本地高精度** | GLM-ASR-Nano | `glm-asr-nano` | 中文識別準確率高，RTX 3060 可流暢運行，完全離線 |
| **本地串流** | Paraformer | `paraformer-trilingual` | 邊說邊出字，延遲低，中英粵三語 |
| **雲端首選** | OpenAI | `gpt-4o-mini-transcribe` | 多語言識別，已有 OpenAI Key 可直接使用 |
| **雲端高品質** | ElevenLabs Scribe | `scribe_v1` | 99 種語言，自動加標點，說話人檢測 |

### 語音輸出（TTS）

| 場景 | 推薦供應商 | 推薦音色 | 說明 |
|------|-----------|---------|------|
| **免費首選** | Edge TTS | `zh-TW-HsiaoChenNeural` | 微軟免費，音質好，無需 API Key |
| **本地離線** | CosyVoice | SFT 預設音色 | 完全離線，RTX 3060 可運行 |
| **最自然（全球）** | ElevenLabs | 自選 `voice_id` | 全球頂級語音合成，支援聲音複製 |
| **海外通用** | OpenAI TTS | `alloy` | 已有 OpenAI Key 可直接使用，`gpt-4o-mini-tts` 模型 |

---

## 開發機配置參考

| 組件 | 型號 |
|------|------|
| CPU | Intel Core i5-12400F (6C12T) |
| GPU | NVIDIA GeForce RTX 3060 12GB |
| 記憶體 | 32GB DDR4 |
| 系統 | Windows 11 Pro |

> RTX 3060 12GB 可以流暢運行大部分本地模型（8B 參數以下）。如果你的顯示卡 VRAM < 8GB，建議優先使用雲端模型。

---

## 授權條款

[MIT](../LICENSE)
