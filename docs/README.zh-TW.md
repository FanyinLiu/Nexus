<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<h3 align="center">一個住在你桌面上的 AI 夥伴——會記憶、會做夢、會陪伴。</h3>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

---

> **注意**：Nexus 正在積極開發中。部分功能已經穩定，部分仍在打磨。歡迎回饋與貢獻！

## Nexus 是什麼？

Nexus 是一個跨平台的桌面 AI 夥伴，基於大型語言模型驅動。它將 Live2D 角色與語音對話、長期記憶、桌面感知、自主行為和工具呼叫相結合——設計目標不是做一個聊天機器人，而是一個真正了解你的夥伴。

使用 Electron + React + TypeScript 建構，支援 Windows、macOS 和 Linux。內建 18+ LLM 供應商，可完全離線運行或使用雲端模型。


---

## 功能特色

- 🎙️ **常駐喚醒詞** — 說出喚醒詞即可開始對話，無需按鍵。基於 sherpa-onnx 關鍵詞偵測，主行程 Silero VAD 共享單路麥克風流。

- 🗣️ **連續語音對話** — 多引擎 STT / TTS，回聲消除自動打斷（說話時不會被自己的聲音喚醒），句級串流 TTS（第一個逗號就開始播報）。

- 🧠 **會做夢的記憶** — 熱 / 溫 / 冷三級記憶架構，BM25 + 向量混合檢索。每晚執行*夢境循環*，將對話聚類成*敘事線索*，讓夥伴逐漸建立對你的完整認知。

- 🤖 **自主內在生活（V2）** — 每個 tick 一次 LLM 決策呼叫，輸入是分層快照（情緒 · 關係 · 節律 · 桌面 · 最近對話），輸出過一層人格護欄。不再是模板化發言——它用自己的聲音說話，也可以選擇不說話；v0.2.7 開始還能主動派後台研究子代理替你查資料。

- 🧰 **子代理派發（v0.2.7）** — 夥伴可以在後台跑一個受限的研究循環（Web 搜尋 / MCP 工具），把結果總結後織進下一句回覆。容量與日預算可控；預設關閉，`設定` 裡開啟。詳見 [本次更新說明](#本次更新--v027)。

- 🔧 **工具呼叫 (MCP)** — 網頁搜尋、天氣查詢、提醒任務及任何 MCP 相容工具。支援原生函式呼叫，同時為不支援 `tools` 的模型提供提示詞模式回退。

- 🔄 **供應商故障轉移** — 可串聯多個 LLM / STT / TTS 供應商。當某個供應商停機時，Nexus 自動切換到下一個，對話不中斷。

- 🖥️ **桌面感知** — 讀取剪貼簿、前台視窗標題，以及（可選的）螢幕 OCR。上下文觸發器讓它能對你正在做的事情作出反應。

- 🔔 **通知橋接** — 本地 Webhook 伺服器 + RSS 輪詢。將外部通知推送到夥伴的對話中。

- 💬 **多平台** — Discord 和 Telegram 閘道，支援按聊天路由。在手機上也能和夥伴對話。

- 🌐 **多語言** — 介面支援簡體中文、繁體中文、英語、日語和韓語。

---

## 本次更新 — v0.2.7

> 子代理派發是頭條；語音打斷升級成「隨時都能打斷」（包括打字觸發的 TTS）；修復了一個讓語音訊息在聊天面板裡看不見的渲染風暴 Bug。
>
> 這一塊**每次發版都會替換成新版本的說明**，舊內容請到 [Releases](https://github.com/FanyinLiu/Nexus/releases) 查閱。

### 🧰 子代理派發 — 頭條

> **一句話版本** — 夥伴現在可以在後台跑一個受限的研究子代理（Web 搜尋 / MCP 工具），把結果織進下一句回覆。兩種入口：自主引擎可以用 `spawn` 替代 `speak`；主聊天 LLM 也能透過 `spawn_subagent` 工具在回答過程中呼叫。狀態會用一條浮在訊息列表上方的條顯示；完成後總結會被主 LLM 編進最終回覆裡。預設關閉，使用者自行開啟。

開啟方式：

```
設定 → Subagents → Enable
  maxConcurrent:    1–3（硬上限 3）
  perTaskBudgetUsd: 每個任務的軟上限
  dailyBudgetUsd:   當日所有任務累計軟上限
  modelOverride:    可選 —— 把研究指向更便宜的模型
```

三級模型回退：`subagentSettings.modelOverride → autonomyModelV2 → settings.model`。所以可以把研究路徑指向一個小的快模型（Haiku / Flash / 便宜的 OpenRouter 入口），主對話繼續用你原本的設定。

決策引擎整合：自主 prompt 每次 tick 都會看到即時的 `subagentAvailability`（開關 + 目前佔用 + 今日剩餘預算），只有門開著的時候才會把 `spawn` 動作暴露給 LLM。LLM 選擇 `spawn` 時，orchestrator 可以選擇先走一遍短句播報（「讓我查一下」）透過正常 TTS 路徑，**同時**派發研究 —— 沒有串列等待。

聊天工具整合：開啟子代理時，`spawn_subagent` 會被加入主 LLM 的工具列表。該工具呼叫會阻塞一個研究回合（通常 10-30 秒）後回傳摘要，主 LLM 把它織進最終回覆。使用者全程能看到即時狀態條，等待不是靜默的。

UI：`SubagentTaskStrip` 以玻璃擬態的薄片形式顯示在訊息列表頂部，帶一個脈衝指示點顯示「排隊中 / 正在處理」。完成的任務不在這裡顯示 —— 它們的總結會作為普通對話氣泡出現。失敗任務會保留 60 秒以便看清原因。

原始碼位置：`src/features/autonomy/subagents/`（`subagentRuntime.ts` 狀態機、`subagentDispatcher.ts` LLM 迴圈、`spawnSubagentTool.ts` + `dispatcherRegistry.ts` 橋接 chat、`src/components/SubagentTaskStrip.tsx` UI）。六個單元測試涵蓋 runtime 狀態機（admit / budget / concurrency / onChange）。

### 🎙️ 隨時都能打斷

之前：語音打斷 monitor 只在目前回合來自連續語音會話時啟動。打字觸發的 TTS 播報不可打斷 —— 這不合理，你既然能對夥伴說話，就應該能在它說話時插入。

- 只要開了 `voiceInterruptionEnabled`，**任何** TTS 播放期間 monitor 都會啟動，不再侷限於語音來源的回合。
- 當喚醒詞 listener 已在執行時，monitor 現在透過 `subscribeMicFrames` **複用**它的麥克風幀，不再開第二路 `getUserMedia`。macOS 偶爾會把兩路預設輸入串列化產生間歇性靜音 —— KWS 開著時預設走複用路徑。
- 打斷成功後，非喚醒詞模式會強制重啟 VAD 捕捉你的繼續發言，不用重新喚醒。喚醒詞 + 常駐 KWS 模式保持原行為（讓 KWS 自己重新接管 —— 強制開第二路 VAD 會和 listener 搶麥）。

### 🐛 渲染風暴 + 跨視窗同步

頭條 Bug 其實藏得很深，分兩層。

**渲染風暴**：父元件每次 render 都會給 `useChat` / `useMemory` / `usePetBehavior` / `useVoice` 的消費者遞一個新的字面量物件。下游 memo（`chatWithAutonomy` / `petView` / `overlays` / `panelView`）每次 render 都失效，連鎖觸發子元件的 useEffect 回寫 state —— 經典「Maximum update depth exceeded」迴圈。肉眼可見的症狀：對話完成那一刻 log 瘋狂刷屏；第二句 STT 卡住是因為 renderer 被餓死，VAD 的 `speech_end` 回呼進不了 microtask 佇列。修復：每個 hook 回傳值都包 useMemo；`useVoice` 裡明確把 `lifecycle.*` / `bindings.*` / `testEntries.*` 從 deps 裡剝離（這些 factory 每次 render 重建，但內部都走穩定 refs，舊引用呼叫起來也能拿到最新實作）。

**跨視窗同步**：pet 視窗和聊天面板是兩個獨立的 Electron renderer，各有獨立的 React state。它們透過 localStorage 的 `storage` 事件在 `CHAT_STORAGE_KEY`（`nexus:chat`）上同步對話。但 `useChat` 的儲存 effect 只呼叫了 `upsertChatSession`，這個函式寫的是 `CHAT_SESSIONS_STORAGE_KEY`（`nexus:chat-sessions`）—— `nexus:chat` 從來沒人寫。結果：pet 視窗裡發生的語音回合（setMessages 都在 pet 裡）永遠不會被面板視窗看到。修復：`useChat` 儲存 effect 裡同時呼叫 `saveChatMessages(messages)`，真的去寫面板監聽的那個 key。

### 🔧 啟動期修復

- **Silero VAD 現在真的能跑了**。`browserVad.ts` 把 `onnxWASMBasePath` 指向 `public/vendor/ort/`，但這個目錄**從來不存在** —— `setup-vendor.mjs` 只複製 Live2D 相關資源。沒有 ORT runtime，vad-web 回退到 CJS `require()`，Vite 的 ESM 環境下直接失敗，整條 Silero 路徑降級到 legacy 錄音兜底。現在 `setup-vendor.mjs` 在 postinstall 裡把 vad-web 需要的四個 wasm + mjs bundle 從 `node_modules` 複製過來。
- **`mcp:sync-servers` 處理器現在急載入**。這個處理器之前是 deferred 載入（app-ready 之後 1.5 秒），但 `useMcpServerSync` 在首次 render 就呼叫，競爭到還沒註冊 → "No handler registered"。`sherpaIpc` / `notificationIpc` 之前就因為同樣問題被挪出過 deferred 列表；`mcpIpc` 這次一起挪進 eager 路徑。

---

## 支援的供應商

| 類別 | 供應商 |
|------|--------|
| **LLM (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **網頁搜尋** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

---

## 推薦模型配置

> 此推薦針對**繁體中文使用者**。其他語言請查看 [English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)。

### 對話模型（LLM）

| 場景 | 推薦供應商 | 推薦模型 | 說明 |
|------|-----------|---------|------|
| **日常陪伴（首選）** | DeepSeek | `deepseek-chat` | 中文能力強、價格極低，適合長時間陪伴對話 |
| **日常陪伴（備選）** | DashScope Qwen | `qwen-plus` | 阿里通義千問，中文自然，長上下文支援良好 |
| **深度推理** | DeepSeek | `deepseek-reasoner` | 需要複雜推理、數學、程式碼時使用 |
| **最強綜合** | Anthropic | `claude-sonnet-4-6` | 綜合能力最強，工具呼叫穩定 |
| **高性價比（海外）** | OpenAI | `gpt-5.4-mini` | 速度快、便宜，適合高頻對話 |
| **免費體驗** | Google Gemini | `gemini-2.5-flash` | 免費額度大，適合入門體驗 |

### 語音輸入（STT）

| 場景 | 推薦供應商 | 推薦模型 | 說明 |
|------|-----------|---------|------|
| **本地高精度** | GLM-ASR-Nano | `glm-asr-nano` | 中文識別準確率高，RTX 3060 可流暢運行，完全離線 |
| **本地串流** | Paraformer | `paraformer-trilingual` | 邊說邊出字，延遲低，中英粵三語，適合連續對話 |
| **本地備選** | SenseVoice | `sensevoice-zh-en` | 比 Whisper 快 15 倍，中英雙語離線識別 |
| **雲端首選** | 智譜 GLM-ASR | `glm-asr-2512` | 中文最佳，支援熱詞糾正 |
| **雲端備選** | 火山引擎 | `bigmodel` | 位元組跳動大模型語音識別，中文優秀 |
| **雲端備選** | 騰訊雲 ASR | `16k_zh` | 即時串流識別，延遲低 |

### 語音輸出（TTS）

| 場景 | 推薦供應商 | 推薦音色 | 說明 |
|------|-----------|---------|------|
| **免費首選** | Edge TTS | 曉臻 (`zh-TW-HsiaoChenNeural`) | 微軟免費，台灣腔自然，無需 API Key |
| **免費備選** | Edge TTS | 雲哲 (`zh-TW-YunJheNeural`) | 男聲，台灣腔，免費 |
| **本地離線** | OmniVoice | 內建音色 | 完全離線，本地連接埠 8000，RTX 3060 可運行 |
| **最自然** | MiniMax | 少女音色 (`female-shaonv`) | 情感表現力強，適合陪伴角色 |
| **中文指令化** | DashScope Qwen-TTS | `Cherry` | 阿里 Qwen3-TTS，支援方言和指令化播報 |

---

## 快速開始

**前置需求**：Node.js 22+ · npm 10+

```bash
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus
npm install
npm run electron:dev
```

建構和打包：

```bash
npm run build
npm run package:win     # 或 package:mac / package:linux
```

---

## 技術棧

| 層級 | 技術 |
|------|------|
| 執行環境 | Electron 36 |
| 前端 | React 19 · TypeScript · Vite 8 |
| 角色渲染 | PixiJS · pixi-live2d-display |
| 本地 ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| 打包 | electron-builder |

---

## 開發路線

### 待升級

- [ ] **螢幕感知主動對話** — 定期讀取螢幕上下文（前台應用、可見文字），主動發起與你正在做的事相關的對話，而不僅僅是被動回應。
- [ ] **決策 / 角色扮演 / Agent 三層分離** — 將意圖分類（快速）、角色扮演（保持人設純淨）和後台 Agent 任務分開。角色扮演層永遠看不到工具元資料；Agent 結果由角色以自己的聲音「轉述」。
- [ ] **角色日記與自主時間線** — 夥伴每天自動生成第一人稱日記，記錄當天發生了什麼；可選發布「動態」到可瀏覽的時間線，營造獨立生活的感覺。
- [ ] **日程表與活動狀態** — 夥伴遵循日常作息（工作 / 吃飯 / 睡覺 / 通勤），影響可用性、語氣和精力。深夜對話和早晨對話感覺不同。
- [ ] **Mini 模式 / 停靠隱藏** — 把角色拖到螢幕邊緣，自動隱藏並在懸停時探頭。「一直在，但不打擾。」
- [ ] **攝影機感知** — 使用 MediaPipe 面部網格偵測疲勞訊號（打哈欠、閉眼、皺眉），注入夥伴的上下文，讓它能主動關心你的狀態。

### 進行中

- [ ] Pipecat 風格影格管線取代單體串流 TTS 控制器（Phase 2-6；Phase 1 已在 v0.2.4 發布）。
- [ ] 透過 electron-updater + 簽署二進位實現自動更新。
- [ ] 行動端伴侶應用（桌面實例的純語音遙控器）。

---

## 參與貢獻

歡迎各種形式的貢獻！無論是修復 Bug、新增功能、翻譯還是文件——請隨時提交 PR 或在 Issues 中發起討論。

---

## Star 趨勢

<a href="https://star-history.com/#FanyinLiu/Nexus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
 </picture>
</a>

---

## 授權條款

[MIT](../LICENSE)
