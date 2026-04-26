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

- 💝 **情感記憶 + 關係弧線（v0.2.9）** — 夥伴會記住每次告別時的*情緒基調*，而不僅僅記住說了什麼。5 級關係進化（陌生人 → 認識 → 朋友 → 密友 → 親密）影響語氣、用詞和行為邊界。記憶持久化到每個人格的 `memory.md` 檔案，切換人格不再丟失關係上下文。

- 🎭 **角色卡 + VTube Studio 橋接（v0.2.9）** — 匯入 Character Card v2/v3 格式（相容 chub.ai / characterhub）。透過 VTube Studio WebSocket 外掛 API 驅動外部 Live2D 模型，同時保留 Nexus 的記憶 / 自主行為堆疊。

- 🌤️ **活的場景（v0.2.9）** — 14 級天氣狀態、24 小時連續日光濾鏡、15 張 AI 生成的 日/黃昏/夜 場景變體。有氛圍深度，不是靜態桌布。

- 🤖 **自主內在生活（V2）** — 每個 tick 一次 LLM 決策呼叫，輸入是分層快照（情緒 · 關係 · 節律 · 桌面 · 最近對話），輸出過一層人格護欄。不再是模板化發言——它用自己的聲音說話，也可以選擇不說話；v0.2.7 起還能主動派後台研究子代理替你查資料。

- 🧰 **子代理派發（v0.2.7）** — 夥伴可以在後台跑一個受限的研究循環（Web 搜尋 / MCP 工具），把結果總結後織進下一句回覆。容量與日預算可控；預設關閉，`設定` 裡開啟。

- 🔧 **工具呼叫 (MCP)** — 網頁搜尋、天氣查詢、提醒任務及任何 MCP 相容工具。支援原生函式呼叫，同時為不支援 `tools` 的模型提供提示詞模式回退。

- 🔄 **供應商故障轉移** — 可串聯多個 LLM / STT / TTS 供應商。當某個供應商停機時，Nexus 自動切換到下一個，對話不中斷。

- 🖥️ **桌面感知** — 讀取剪貼簿、前台視窗標題，以及（可選的）螢幕 OCR。上下文觸發器讓它能對你正在做的事情作出反應。

- 🔔 **通知橋接** — 本地 Webhook 伺服器 + RSS 輪詢。將外部通知推送到夥伴的對話中。

- 💬 **多平台** — Discord 和 Telegram 閘道，支援按聊天路由。在手機上也能和夥伴對話。

- 🌐 **多語言** — 介面支援簡體中文、繁體中文、英語、日語和韓語。

---

## 本次更新 — v0.3.1-beta.3（預發布）

> **bug 修復 patch（無新功能）。** 主要修：dmg/exe 用戶的 Live2D 桌寵（CSP 缺 `unsafe-eval` 導致 pixi.js 渲染失敗 — P0）；thinking-mode 模型多輪對話（DeepSeek-R1 / QwQ / Hunyuan-thinking 的 reasoning_content 全鏈路保留 + 舊歷史兜底）；TTS 讀完後 voiceState 卡 speaking 三層防護；多模態發圖後續輪丟失；in-app 診斷面板自動捕獲 console + dev 模式 tail 到 `.dev/runtime.log`。完整說明見 [RELEASE-NOTES-v0.3.1-beta.3.md](RELEASE-NOTES-v0.3.1-beta.3.md)（英文）。

---

## 當前穩定版 — v0.3.0

> **穩定版發布。** v0.2.9 → v0.3.0 累計 100+ commit、約 12,000 行變更、
> +361 個單元測試。所有變更都向後相容，舊資料自動遷移。完整開發者視角說明見
> [RELEASE-NOTES-v0.3.0.md](RELEASE-NOTES-v0.3.0.md)（英文）。

| 主題 | 落地內容 |
|---|---|
| **🧠 記憶開始做事** | 顯著性加權召回；dream cycle 生成 1–3 條關於你的反思；callback 佇列（下次聊天溫柔提一個舊記憶）；30 / 100 / 365 天周年里程碑。 |
| **💝 關係有了形狀** | 心情感知召回（3 種模式）；五級里程碑首次跨越觸發；四維子分數；重逢 framing 更豐富。 |
| **🤝 關係有了類型** | onboarding 與設定裡選擇 *開放 / 朋友 / 導師 / 安靜的陪伴*，單行偏置 system prompt 而不覆蓋 `SOUL.md`。 |
| **💭 「想著你」通知** | 長時間無聊天時，按你設的關係類型推送系統通知。23–08 點靜默不打擾。 |
| **🎬 角落裡的存在感** | autonomy V2 第 4 個 action（`idle_motion` 靜默手勢）；動態 cadence；早期回覆中的好奇追問。 |
| **🌅 平滑場景過渡** | 早 5–7 / 16–18 / 19–21 三個 2 小時過渡窗，smoothstep 緩動；色彩對比拉強 —— 黎明粉、金時刻深琥珀、深夜冷淡藍。 |
| **🪟 Liquid Glass UI** | 紫色 accent 重塑；工具列整理；時間感知 emoji 招呼；視窗大小 / 位置跨啟動持久化。 |
| **🌤️ 天氣更精準** | 小時級預報、體感溫度 + 濕度、後天預報。 |
| **🧹 工程精簡** | i18n.ts 1842 → 588 行；共享 SettingsField 元件；正則編譯快取；async-lock 去重；安裝包瘦身約 30–60 MB。 |

<details>
<summary>已折疊到本穩定版的 beta 線</summary>

beta 線奠定了基礎，本穩定版做最後打磨：

- **v0.3.0-beta.1** —— 三軸關係系統：心情感知召回（VAD 投影 + 共情 / 修復 / 強化模式）、一次性升級指令、四維子分數。[Notes](RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** —— 穩定 + 留存批次：顯著性記憶、dream-cycle reflection、callback queue、周年里程碑、idle motion、動態 cadence、Liquid Glass UI、天氣精度、托盤 + dock 圖示、7 項安全修復。[Notes](RELEASE-NOTES-v0.3.0-beta.2.md)

</details>

---

## 上一版本 — v0.2.9

> 情感記憶與關係進化是頭條 —— 夥伴現在會追蹤你們的關係發展，並記住每次對話的情感。天氣與場景系統從零重寫，14 種天氣狀態 + AI 生成場景。角色卡匯入、VTube Studio 橋接、全 5 語言 i18n。
>
> 這一塊**每次發版都會替換成新版本的說明**，舊內容請到 [Releases](https://github.com/FanyinLiu/Nexus/releases) 查閱。

### 🧠 情感記憶與關係進化 — 頭條

夥伴現在會跨會話攜帶情感上下文。上次分別時氣氛溫馨，它就會溫暖地接上；你上次很疲憊，它會關心你的狀態。五級關係階段 —— 陌生人 → 熟人 → 朋友 → 密友 → 親密 —— 影響夥伴的語氣、用詞風格和行為邊界。進化是隱式的，由累積互動驅動，沒有可見的進度條。

離線感知：夥伴會注意到你離開了多久。短暫離開會收到溫柔的歡迎；長時間不在會引發真正的好奇（「你去哪了？」）。對話記憶現在持久化到每個角色的 `memory.md` 檔案，跨會話不遺失。

### 🌦️ 天氣與場景系統重寫

舊天氣掛件被替換為完整的大氣系統：

- **14 種強度分級天氣狀態**，帶全場景視覺效果 —— 天空色調、密集粒子層、發光的雨雪。
- **連續日光系統**，亮度 / 飽和度 / 色相濾鏡。真正的夜晚、細膩的白天色階 —— 不只是「白天」和「黑夜」。
- **15 張 AI 生成動漫場景**（5 地點 × 日 / 黃昏 / 夜），手工編寫提示詞以保證視覺一致性。
- **14 態寵物時間預覽**，可鎖定到目前時刻檢視各天氣效果。
- **多語言天氣地點解析**，基於 Nominatim 地理編碼 —— 用任何語言輸入城市名。

### 📇 角色卡匯入

支援匯入 Character Card v2 / v3 格式（PNG 內嵌 + JSON）—— 相容 chub.ai、characterhub 等社群的角色卡。在 設定 → 角色 裡拖入 `.png` 卡片檔案即可自動填充角色資訊。

### 🎭 VTube Studio 橋接

透過 WebSocket 驅動 VTube Studio 中的外部 Live2D 模型。夥伴的情感狀態即時同步到 VTS 模型的表情和動作。

### 🌐 全面 i18n

所有 UI 介面現在支援 5 種語言（EN / ZH-CN / ZH-TW / JA / KO）的完整翻譯：設定、對話、引導、語音棧、系統提示詞、錯誤訊息和資料登錄表。設定裡提供地球圖示 + 彈出式語言切換器。

### 🐾 寵物系統增強

- **內聯表情覆蓋**：夥伴可以在回覆中寫 `[expr:name]` 標籤，在說話過程中觸發特定 Live2D 表情。
- **擴展觸摸反應池** —— 戳角色時有更多樣的反應。
- **按模型加權的待機小動作** —— 不同角色的待機動畫各有風格。
- **滑鼠拖曳調整**寵物角色視窗大小。
- **13 種精細寵物心情狀態**，驅動表情選擇。

### 🔧 其他改進和修復

- Lorebook 語義混合檢索，在關鍵詞比對之上增加向量搜尋。
- 使用者可配置的正規表示式對 LLM 回覆做變換。
- 引導語音步驟新增本地語音模型健康狀態條。
- Sherpa 模型打包進 Mac + Linux 安裝包。
- 修復跨視窗 BroadcastChannel 同步儲存迴圈和訊息覆蓋。
- 修復執行時狀態橋自餵渲染風暴。
- 修復 TTS 逾時渲染風暴。
- 修復喚醒詞暫態裝置錯誤被當作永久錯誤處理。
- 刪除 Autonomy V1 程式碼（Phase 6 清理）。

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
| 執行環境 | Electron 41 |
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

## 社群

Nexus 目前由個人維護，issue 和 PR 的處理速度取決於分流是否精準：

- 🐛 **發現 Bug？** → [Bug 回報](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml)
- 💡 **有明確的功能想法？** → [功能請求](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml)
- 🧠 **更大或開放性的想法？** → 先到 [Ideas 討論](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas)，讓大家一起評估
- ❓ **安裝或使用遇到問題？** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- 🎨 **想分享你的使用方式？** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- 💬 **隨便聊聊？** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)
- 📣 **版本發布和路線更新** → [Announcements](https://github.com/FanyinLiu/Nexus/discussions/categories/announcements)

---

## 參與貢獻

歡迎各種形式的貢獻——Bug 修復、新 Provider、UI 調整、翻譯、Live2D 模型或新的自主行為。哪怕一句話的 issue 或一個 typo 修復的 PR 也能推動專案前進。

快速入門：

- 閱讀完整的 [**貢獻指南**](../CONTRIBUTING.md) 瞭解開發環境、專案結構、程式碼規範和 PR 流程。
- 使用 [issue 範本](https://github.com/FanyinLiu/Nexus/issues/new/choose) 提交 Bug 和功能請求——統一的格式有助於快速分流。
- 推送前執行 `npm run verify:release`（lint + 測試 + 建構）——這正是 CI 執行的流程。
- 提交訊息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`refactor:` 等。
- 每個 PR 只做一件事。不相關的修復請拆分為單獨的 PR。

所有參與受 [行為準則](../CODE_OF_CONDUCT.md) 約束——簡而言之：**善待他人，假設善意，專注於工作**。

### 安全問題

如果你發現安全漏洞，請**不要**公開提交 issue。請透過 [私有安全諮詢](https://github.com/FanyinLiu/Nexus/security/advisories/new) 回報。

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
