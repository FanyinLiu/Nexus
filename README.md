<p align="center">
  <img src="public/icon.png" alt="Nexus" width="96" />
</p>

<h1 align="center">Nexus</h1>

<p align="center">
  Windows 桌面 AI 陪伴体 · Desktop AI Companion
</p>

<p align="center">
  <a href="#简体中文">简体中文</a> · <a href="#繁體中文">繁體中文</a> · <a href="#english">English</a> · <a href="#日本語">日本語</a> · <a href="#한국어">한국어</a>
</p>

---

<a id="简体中文"></a>

## 简体中文

### 简介

Nexus 是一个面向 Windows 的桌面 AI 陪伴应用，集成 Live2D 角色渲染、全双工语音交互、长期记忆、桌面感知与自主行为能力。

### 核心功能

- **桌宠 + 面板** 双视图，Live2D 角色渲染与表情/动作/情绪联动
- **全双工语音交互** — 多引擎 STT（Sherpa、SenseVoice、FunASR、腾讯 ASR、浏览器识别）与 TTS（Edge TTS、MiniMax、火山引擎、CosyVoice2、本地 Sherpa TTS），支持唤醒词、VAD 语音活动检测、连续对话、语音打断
- **事件总线架构** — VoiceBus 统一管理语音生命周期（STT/TTS/会话），纯 reducer + effect 模式驱动状态流转
- **长期记忆** — 语义向量检索、每日自动日记、主动召回、记忆归档与整理
- **桌面感知** — 剪贴板监听、前台窗口识别、截图 OCR
- **自主行为** — 上下文调度、焦点感知、记忆整理（dream）、主动触发引擎
- **工具调用** — 网页搜索、天气查询、提醒任务、MCP 协议接入
- **多语言** — 简中/繁中/英/日/韩 界面语言

### 架构概览

```
                        ┌──────────────────────────┐
                        │     Electron Main        │
                        │  IPC · TTS · ASR · MCP   │
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │     React Frontend       │
                        ├──────────────────────────┤
                        │  useAppController        │
                        │    ├─ useVoice           │
                        │    │   └─ VoiceBus       │
                        │    ├─ useChat            │
                        │    ├─ useMemory          │
                        │    └─ usePetBehavior     │
                        ├──────────────────────────┤
                        │  features/               │
                        │    ├─ voice (bus/reducer) │
                        │    ├─ hearing (STT)      │
                        │    ├─ memory (vector)    │
                        │    ├─ autonomy (tick)    │
                        │    ├─ chat (runtime)     │
                        │    └─ harness (eval)     │
                        └──────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Electron 33 |
| 前端 | React 19 · TypeScript · Vite 6 |
| 角色 | PixiJS · pixi-live2d-display |
| 语音输入 | Sherpa-onnx · SenseVoice · FunASR · 腾讯 ASR · Web Speech API |
| 语音输出 | Edge TTS · MiniMax · 火山引擎 · CosyVoice2 · Sherpa TTS · 系统语音 |
| 本地 ML | onnxruntime-web · @huggingface/transformers |
| 打包 | electron-builder |

### 快速开始

环境要求：Windows 10/11、Node.js 20+、npm 10+

```bash
npm install
npm run electron:dev    # 开发模式
npm run build           # 构建
npm run package:win     # 打包 Windows 安装程序
```

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | Vite 开发服务器 |
| `npm run electron:dev` | Electron 联调 |
| `npm run build` | 构建前端 |
| `npm test` | 运行测试 |
| `npm run package:win` | 生成安装包 |

### 项目结构

```
electron/              桌面运行时与原生桥接
  ipc/                 IPC 通道模块（audio/chat/memory/tts/sherpa…）
  services/            后端服务（TTS、向量存储、腾讯 ASR…）
src/
  app/                 应用组装、控制器、视图
    controllers/       useAppController · useAutonomyController
    store/             设置持久化
  components/          共享 UI 组件
    settingsSections/  设置面板各分区
  features/            领域模块
    voice/             VoiceBus 事件总线 · 会话状态机 · 流式播放
    hearing/           STT 引擎适配（Sherpa/SenseVoice/FunASR/腾讯）
    memory/            语义记忆 · 向量检索 · 归档 · 召回
    autonomy/          自主行为（上下文调度/焦点感知/记忆整理）
    chat/              模型调用运行时
    harness/           执行约束 · 评估 · 收敛
    pet/               角色行为 · 表情控制
  hooks/               React 编排 Hook
    voice/             语音会话启停 · STT 转录处理 · TTS 播报 · 连续对话
    chat/              助手回复 · 提醒 · 流中止
  i18n/                多语言（zh-CN/zh-TW/en/ja/ko）
  lib/                 纯工具函数与提供者注册表
  types/               类型定义
tests/                 测试
```

---

<a id="繁體中文"></a>

## 繁體中文

### 簡介

Nexus 是一個面向 Windows 的桌面 AI 陪伴應用，整合 Live2D 角色渲染、全雙工語音互動、長期記憶、桌面感知與自主行為能力。

### 核心功能

- **桌寵 + 面板** 雙視圖，Live2D 角色渲染與表情/動作/情緒聯動
- **全雙工語音互動** — 多引擎 STT（Sherpa、SenseVoice、FunASR、騰訊 ASR、瀏覽器識別）與 TTS（Edge TTS、MiniMax、火山引擎、CosyVoice2、本地 Sherpa TTS），支援喚醒詞、VAD、連續對話、語音打斷
- **事件匯流排架構** — VoiceBus 統一管理語音生命週期，純 reducer + effect 模式驅動狀態流轉
- **長期記憶** — 語義向量檢索、每日自動日記、主動召回、記憶歸檔
- **桌面感知** — 剪貼簿監聽、前台視窗識別、截圖 OCR
- **自主行為** — 上下文排程、焦點感知、記憶整理、主動觸發引擎
- **工具調用** — 網頁搜尋、天氣、提醒任務、MCP 協議接入
- **多語言** — 簡中/繁中/英/日/韓 介面語言

### 快速開始

```bash
npm install
npm run electron:dev    # 開發模式
npm run build           # 建置
npm run package:win     # 打包 Windows 安裝程式
```

---

<a id="english"></a>

## English

### Overview

Nexus is a Windows desktop AI companion app featuring Live2D character rendering, full-duplex voice interaction, long-term memory, desktop awareness, and autonomous behavior.

### Features

- **Pet + Panel** dual-view with Live2D character expressions, motion, and mood
- **Full-duplex voice** — multi-engine STT (Sherpa, SenseVoice, FunASR, Tencent ASR, Web Speech API) & TTS (Edge TTS, MiniMax, Volcengine, CosyVoice2, local Sherpa TTS); wake word, VAD, continuous conversation, speech interruption
- **Event bus architecture** — VoiceBus manages voice lifecycle (STT/TTS/session) with a pure reducer + effect pattern
- **Long-term memory** — semantic vector search, auto daily diary, proactive recall, archive
- **Desktop awareness** — clipboard, foreground window, screenshot OCR
- **Autonomous behavior** — context scheduling, focus awareness, memory consolidation, proactive engine
- **Tool calling** — web search, weather, reminders, MCP protocol
- **Multilingual** — Simplified Chinese / Traditional Chinese / English / Japanese / Korean

### Quick Start

Requirements: Windows 10/11, Node.js 20+, npm 10+

```bash
npm install
npm run electron:dev    # dev mode
npm run build           # build
npm run package:win     # package Windows installer
```

---

<a id="日本語"></a>

## 日本語

### 概要

Nexus は Windows 向けのデスクトップ AI コンパニオンアプリです。Live2D キャラクターレンダリング、全二重音声インタラクション、長期記憶、デスクトップ認識、自律的行動機能を備えています。

### 主な機能

- **ペット + パネル** のデュアルビュー、Live2D キャラクターの表情・モーション・感情連動
- **全二重音声** — マルチエンジン STT（Sherpa・SenseVoice・FunASR・テンセント ASR・Web Speech API）& TTS（Edge TTS・MiniMax・火山エンジン・CosyVoice2・ローカル Sherpa TTS）、ウェイクワード・VAD・連続会話・音声割り込み対応
- **イベントバスアーキテクチャ** — VoiceBus が音声ライフサイクルを統一管理、純粋な reducer + effect パターンで状態遷移
- **長期記憶** — セマンティック検索、デイリー日記自動生成、プロアクティブリコール、アーカイブ
- **デスクトップ認識** — クリップボード、前面ウィンドウ、スクリーンショット OCR
- **自律的行動** — コンテキストスケジューリング、フォーカス認識、記憶整理、プロアクティブエンジン
- **ツール連携** — Web 検索、天気、リマインダー、MCP プロトコル
- **多言語** — 簡体字中国語 / 繁体字中国語 / 英語 / 日本語 / 韓国語

### クイックスタート

```bash
npm install
npm run electron:dev    # 開発モード
npm run build           # ビルド
npm run package:win     # Windows インストーラーのパッケージング
```

---

<a id="한국어"></a>

## 한국어

### 개요

Nexus는 Windows용 데스크톱 AI 컴패니언 앱입니다. Live2D 캐릭터 렌더링, 전이중 음성 상호작용, 장기 기억, 데스크톱 인식, 자율 행동 기능을 갖추고 있습니다.

### 주요 기능

- **펫 + 패널** 듀얼 뷰, Live2D 캐릭터 표정/모션/감정 연동
- **전이중 음성** — 멀티엔진 STT(Sherpa·SenseVoice·FunASR·텐센트 ASR·Web Speech API) & TTS(Edge TTS·MiniMax·화산엔진·CosyVoice2·로컬 Sherpa TTS), 웨이크워드·VAD·연속 대화·음성 인터럽트
- **이벤트 버스 아키텍처** — VoiceBus가 음성 라이프사이클을 통합 관리, 순수 reducer + effect 패턴으로 상태 전환
- **장기 기억** — 시맨틱 벡터 검색, 데일리 다이어리 자동 생성, 능동적 리콜, 아카이브
- **데스크톱 인식** — 클립보드, 포그라운드 윈도우, 스크린샷 OCR
- **자율 행동** — 컨텍스트 스케줄링, 포커스 인식, 기억 정리, 프로액티브 엔진
- **도구 연동** — 웹 검색, 날씨, 리마인더, MCP 프로토콜
- **다국어** — 간체/번체 중국어 / 영어 / 일본어 / 한국어

### 빠른 시작

```bash
npm install
npm run electron:dev    # 개발 모드
npm run build           # 빌드
npm run package:win     # Windows 설치 프로그램 패키징
```

---

## License

MIT
