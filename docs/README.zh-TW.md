<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>本地優先的桌面 AI 夥伴，具備記憶、語音、Live2D 和長期關係狀態。</b></p>

<p align="center">Nexus 關注的是連續性：夥伴會記住真正重要的事，感知關係如何變化，透過桌寵形態陪在桌面上，也能替你處理一些輕量後台任務。模型請求由你選擇的 provider 承擔；記憶、語音編排、工具和安全狀態都留在本機。</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue&label=release" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
</p>

> **目前版本：** v0.3.1 穩定版（2026-04-28）。Nexus 現在已可日常使用，但仍是快速迭代中的個人專案；打包、本地語音模型和 provider 設定上，可能還有一些不夠順滑、需要手動處理的地方。

---

## 閱讀路徑

| 你想做什麼 | 去哪裡 |
|---|---|
| 安裝應用 | [下載最新版本](https://github.com/FanyinLiu/Nexus/releases/latest) |
| 理解產品 | [為什麼是 Nexus](#為什麼是-nexus) · [功能特色](#功能特色) |
| 從原始碼執行 | [快速開始](#快速開始) |
| 配置模型 | [推薦模型配置](#推薦模型配置) · [支援的供應商](#支援的供應商) |
| 查看安全與隱私 | [安全與援助](#安全與援助) |

## 為什麼是 Nexus？

大多數 AI 夥伴都在比拼模型能力、語音擬真或互動頻率。Nexus 更關心另一個問題：**一個長期陪伴者應該記住什麼，又應該怎樣讓這段歷史改變它的存在方式？**

答案不是一個單點功能，而是一組會累積的小儀式：在合適時機被輕輕提起的舊記憶，每週寫下真正發生過什麼的一封信，帶著情緒重量回來的回憶，以及在沉默更合適時選擇沉默的夥伴。

圍繞這些儀式，Nexus 提供 5 語言介面、18+ LLM provider、多引擎 STT/TTS 與故障轉移、Live2D、VTube Studio 橋接、MCP 工具、本地 Webhook/RSS 通知，以及加固過的 Electron IPC 邊界。工程系統是基礎；真正的產品，是這些能力在幾個月使用後累積出的關係感。

---

## 功能特色

- 🎙️ **常駐喚醒詞** — 說出喚醒詞即可開始對話，無需按鍵。基於 sherpa-onnx 關鍵詞偵測，主行程 Silero VAD 共享單路麥克風流。

- 🗣️ **連續語音對話** — 多引擎 STT / TTS，回聲消除自動打斷（說話時不會被自己的聲音喚醒），句級串流 TTS（第一個逗號就開始播報）。

- 🧠 **會做夢的記憶** — 熱 / 溫 / 冷三級記憶架構，BM25 + 向量混合檢索。每晚執行*夢境循環*，將對話聚類成*敘事線索*，讓夥伴逐漸建立對你的完整認知。

- 💝 **情感記憶 + 關係弧線（v0.2.9）** — 夥伴會記住每次告別時的*情緒基調*，而不僅僅記住說了什麼。5 級關係進化（陌生人 → 認識 → 朋友 → 密友 → 親密）影響語氣、用詞和行為邊界。記憶持久化到每個人格的 `memory.md` 檔案，切換人格不再丟失關係上下文。

- 🎭 **角色卡 + VTube Studio 橋接（v0.2.9）** — 匯入 Character Card v2/v3 格式（相容 chub.ai / characterhub）。透過 VTube Studio WebSocket 外掛 API 驅動外部 Live2D 模型，同時保留 Nexus 的記憶 / 自主行為堆疊。

- 🌤️ **活的場景（v0.2.9）** — 14 級天氣狀態、24 小時連續日光濾鏡、15 張 AI 生成的 日/黃昏/夜 場景變體。有氛圍深度，不是靜態桌布。

- 🤖 **自主內在生活（V2）** — 每個 tick 一次 LLM 決策呼叫，輸入是分層快照（情緒 · 關係 · 節律 · 桌面 · 最近對話），輸出過一層人格護欄。不再是模板化發言——它用自己的聲音說話，也可以選擇不說話。

- 🔧 **工具呼叫 (MCP)** — 網頁搜尋、天氣查詢、提醒任務及任何 MCP 相容工具。支援原生函式呼叫，同時為不支援 `tools` 的模型提供提示詞模式回退。

- 🔄 **供應商故障轉移** — 可串聯多個 LLM / STT / TTS 供應商。當某個供應商停機時，Nexus 自動切換到下一個，對話不中斷。

- 🖥️ **桌面感知** — 讀取剪貼簿、前台視窗標題，以及（可選的）螢幕 OCR。上下文觸發器讓它能對你正在做的事情作出反應。

- 🔔 **通知橋接** — 本地 Webhook 伺服器 + RSS 輪詢。將外部通知推送到夥伴的對話中。

- 💬 **多平台** — Discord 和 Telegram 閘道，支援按聊天路由。在手機上也能和夥伴對話。

- 🌐 **多語言** — 介面支援簡體中文、繁體中文、英語、日語和韓語。

---

## 本次更新 — v0.3.1（穩定版，2026-04-28）

> **情感主線 + 安全審計累積版。** 自 v0.3.0 起 92 個 commit；beta.1 → beta.5 在穩定版前分別關閉了一類問題。完整說明見 [RELEASE-NOTES-v0.3.1.md](RELEASE-NOTES-v0.3.1.md)（英文）。

| 主題 | 落地內容 |
|---|---|
| **🧠 伴侶的語氣會自適應** | 14 天長窗口 + 3 天短窗口的情緒基線接進每條回覆：低落卡住時少建議多承接；急性下落時節奏放慢；起伏劇烈時不主動帶話題；穩定溫暖時跟節奏。Russell 1980 + Kuppens 2015 + Trull 2008。 |
| **💔 Gottman 魯莽 / 修復** | 自動檢測批評 / 輕蔑 / 防禦 / 築牆四種 Horsemen；下一輪注入 soft start-up + accept influence 修復姿態。**全程默默改變，不彈任何「我看到你這個狀態」的提示**。 |
| **🔒 兩個 critical CVE 清零** | `pixi-live2d-display` 誤把 `gh-pages` 放進 runtime deps（原型污染）；`npm overrides` 強制升級到無 CVE 版本。 |
| **🛡️ IPC 安全審計 6/7 HIGH 關閉** | H2/H3/H5/H6/H7/H8 + M1/M2/M3/M5 + L3/L4/L6 全部修復，H4 按設計 deferred 到 v1.0。 |
| **🐛 30+ 靜態 bug 修復** | 四輪 audit + 並行 agent 靜態掃描；template-replace `$&` 漏洞、並發競態、StrictMode 純淨化、NaN 守衛、async leak、storage 驗證。 |
| **🚦 發版前檢查擴到 26 項** | `prerelease-check.mjs` 從 8 項擴到 6 stage / 26 check：流程 / 程式碼品質 / 安全 / 資產 / 文件合規 / 隱私治理。 |
| **🧹 UI 精簡** | 信件 / 時光膠囊 / 小事 / 還沒收的線 / 心情地圖 5 個 settings panel 從抽屜收回（底層 scheduler 仍在跑）。「伴侶的情感適應應該是使用者感受到的，不是去配置的」。 |

<details>
<summary>本穩定版包含的 v0.3.1-beta 線</summary>

- **beta.1** — 安裝包瘦身（1.2 GB → 250 MB）
- **beta.2** — IPC 安全 hardening（H5 / H8 / H4 緩解）
- **beta.3** — Live2D / thinking-mode / TTS / 多模態 4 個回歸修復
- **beta.4** — 審計 + 打磨（compaction race、ja/ko 翻譯）
- **beta.5** — 情感主線 M1.4-1.7 + 多日 Arc + yearbook 匯出

</details>

---

## 上一穩定版 — v0.3.0

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

## 下載與安裝

### 預先編譯安裝包（推薦）

從 [release 頁面](https://github.com/FanyinLiu/Nexus/releases/latest) 下載最新安裝包：

| 平台 | 檔案 |
|---|---|
| Windows | `Nexus-Setup-<版本>.exe`（NSIS，未簽署） |
| macOS | `.dmg` 或 `.zip`（未簽署，arm64 + x64 universal） |
| Linux | `.AppImage` / `.deb` / `.tar.gz` |

> **首次啟動會看到安全性警告，這是預期行為。**
> Nexus 的 release 不做程式碼簽署——既沒有 Apple Developer 憑證，
> 也沒有 Windows EV 憑證，這是刻意的決定（個人專案，不收費，
> 不承擔經常性基礎設施開銷）。警告的意思是「這個開發者沒付
> 簽署費」，而不是「這是病毒」。原始碼在 GitHub 公開，每個
> 版本都由公開 CI 建構，Linux 安裝包還附帶 SHA-256 和
> GPG 分離簽章，可以獨立校驗。

#### macOS 首次啟動

1. 雙擊 `.dmg`，把 `Nexus.app` 拖到 `/應用程式`。
2. 移除 Gatekeeper 的隔離屬性——打開「終端機」執行：
   ```bash
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```
   （或者：在 Nexus.app 上按右鍵 → 打開 → 在對話框中確認。）
3. 啟動 Nexus。首次執行會出現 **「安裝本地語音模型」** 精靈，點
   **一鍵下載** 把 ~280 MB 的 sherpa-onnx + VAD 模型下載到
   `~/Library/Application Support/Nexus/sherpa-models`。精靈可以
   關掉，之後從設定裡重新開啟。
4. Python 相關的選項（OmniVoice TTS / GLM-ASR）會自動偵測。
   如果沒裝 Python + `requirements.txt`，會被靜默跳過——核心
   聊天 + SenseVoice STT + Edge TTS 路徑依然可用。

#### Windows 首次啟動

1. 執行 `Nexus-Setup-<版本>.exe`。
2. SmartScreen 會顯示 **「Windows 已保護您的電腦」**。
3. 點警告下方的小字 **「其他資訊」**，然後點 **「仍要執行」**。
4. 按 NSIS 安裝精靈繼續；首次啟動同樣會出現本地語音模型精靈。

#### Linux 首次啟動

- **AppImage**：`chmod +x Nexus-<版本>.AppImage` 然後雙擊或在終端機執行。Linux 發行版不像 macOS / Windows 那樣強制應用程式層級的簽署，沒有警告。
- **.deb**：`sudo dpkg -i Nexus-<版本>.deb`（或用發行版的套件管理員打開）。
- **校驗下載**（選擇性）：每個 release 都附帶 `SHA256SUMS` 檔案和 `*.AppImage.asc` / `*.deb.asc` GPG 分離簽章。從 [release 頁面](https://github.com/FanyinLiu/Nexus/releases/latest) 匯入公鑰，執行 `gpg --verify Nexus-<版本>.AppImage.asc` 即可確認完整性。

---

## 快速開始

> 這一節是給開發者從原始碼執行的。一般使用者請看上方的「下載與安裝」。

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

## 安全與援助

Nexus 是 AI 伴侶，不是臨床工具。儲存庫自帶一個小型安全層，滿足美國加州 **SB 243**（2026-01-01 生效）、紐約州陪伴 AI 法案、以及 **EU AI Act** 嚴重事件上報條款（2026-08）的要求。

**這一層做什麼：**

- **首次啟動同意頁**——onboarding 第 0 步是唯讀的「你在和 AI 聊天，不是真人，這不是臨床諮詢」提示，確認後才進入伴侶設定。點擊時間戳記到 `localStorage` 留作稽核。
- **聊天中定期提醒**——同時滿足「自上次提醒已發 ≥30 條使用者訊息 **且** 已過 ≥3 小時牆鐘時間」後，會在聊天裡追加一條系統氣泡，提醒目前在和 AI 對話。雙閘確保短時密集與長時低頻都不會過度觸發。
- **危機話語偵測**——當使用者輸入匹配各 locale 危機模式（「我想死」、「I want to kill myself」、「死にたい」等）時，一個獨立的非角色面板會浮出，列出真人援助專線：
  - **1925**（zh-TW）衛生福利部 安心專線，24/7
  - **988**（en-US）美國自殺與危機生命線，24/7 通話或簡訊
  - **12356** + **800-810-1117**（zh-CN）國家統一線（2025+）+ 北京 24h 熱線
  - **0120-279-338**（ja）よりそいホットライン，24/7 免費
  - **109**（ko）保健福祉部統一自殺預防線（2024+），24/7
- **角色降調**——觸發面板的那一輪回覆，會透過一段一次性 system prompt 讓伴侶留在角色但切換到驗證情緒、不開玩笑、不討論手段、回覆簡短、溫和提到面板的狀態。

**這一層不做什麼：**

- **危機事件不會上傳到任何伺服器。** 偵測在本機執行，面板在本機渲染，沒有任何「誰說了什麼」的遙測會被傳輸。
- 不做年齡驗證，不做使用者畫像，不呼叫任何第三方資料介面。

**程式碼可以在哪裡獨立檢查：**

| 模組 | 檔案 |
|---|---|
| 偵測模式 + 各 locale 反向詞典 | `src/features/safety/crisisDetect.ts` |
| 熱線目錄（每條帶 `sourceUrl`） | `src/features/safety/hotlines.ts` |
| 熱線面板 UI | `src/features/safety/CrisisHotlinePanel.tsx` |
| 角色降調注入 | `src/features/safety/crisisGuidance.ts` |
| 同意 + 定期提醒持久化 | `src/features/safety/disclosureState.ts` 等 |
| 測試 | `tests/safety-*.test.ts` |

每次發版前會對所有熱線號碼逐條向權威源（衛福部 / WHO / IASP / 各部委）重新核驗。號碼錯了等於把求助的人導到空號——這條比其他文件嚴苛。

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
