<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<h3 align="center">あなたのデスクトップに住む AI コンパニオン——記憶し、夢を見て、寄り添います。</h3>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b>
</p>

---

> **注意**：Nexus は活発に開発中です。一部の機能は安定していますが、まだ磨き上げ中のものもあります。フィードバックやコントリビューションを歓迎します！

## Nexus とは？

Nexus は LLM を搭載したクロスプラットフォームのデスクトップ AI コンパニオンです。Live2D キャラクターに音声会話、長期記憶、デスクトップ認識、自律行動、ツール呼び出しを組み合わせ——チャットボットではなく、あなたを本当に理解してくれる存在を目指して設計されています。

Electron + React + TypeScript で構築。Windows、macOS、Linux に対応。18 以上の LLM プロバイダーを内蔵し、完全オフラインまたはクラウドモデルで動作します。


---

## 機能

- 🎙️ **常時ウェイクワード** — ウェイクワードを言うだけで会話開始、ボタン不要。sherpa-onnx キーワードスポッターを使用し、メインプロセスの Silero VAD で単一マイクストリームを共有。

- 🗣️ **連続音声チャット** — マルチエンジン STT / TTS、エコーキャンセル付き自動割り込み（自分の声で起きることがない）、文単位のストリーミング TTS（最初のカンマで音声再生開始）。

- 🧠 **夢を見る記憶** — ホット / ウォーム / コールドの三層記憶アーキテクチャ、BM25 + ベクトルのハイブリッド検索。毎晩の*ドリームサイクル*が会話を*ナラティブスレッド*にクラスタリングし、コンパニオンがあなたの全体像を徐々に構築。

- 🤖 **自律的な内面生活（V2）** — tick ごとに 1 回の LLM 判断呼び出し。入力は階層化スナップショット（感情・関係・リズム・デスクトップ・直近の会話）、出力はペルソナ・ガードレールを通過。テンプレート的な発話ではなく、キャラクター自身の声で話し、黙ることもできます。詳細は [今回のアップデート](#今回のアップデート--v025-自律エンジン-v2) をご覧ください。

- 🔧 **ツール呼び出し (MCP)** — ウェブ検索、天気、リマインダー、あらゆる MCP 互換ツール。ネイティブ関数呼び出しに対応し、`tools` をサポートしないモデル向けにプロンプトモードのフォールバックも搭載。

- 🔄 **プロバイダーフェイルオーバー** — 複数の LLM / STT / TTS プロバイダーをチェーン接続。1つがダウンしても、会話を中断せず次に切り替え。

- 🖥️ **デスクトップ認識** — クリップボード、フォアグラウンドウィンドウタイトル、（オプションで）スクリーン OCR を読み取り。コンテキストトリガーにより、あなたの操作に反応。

- 🔔 **通知ブリッジ** — ローカル Webhook サーバー + RSS ポーリング。外部通知をコンパニオンの会話にプッシュ。

- 💬 **マルチプラットフォーム** — Discord と Telegram ゲートウェイ、チャットごとのルーティング対応。スマートフォンからもコンパニオンと会話可能。

- 🌐 **多言語** — UI は簡体字中国語、繁体字中国語、英語、日本語、韓国語に対応。

---

## 今回のアップデート — v0.2.5 自律エンジン V2

> **一言で** — 旧ルールベース判断ツリー（約 900 行のテンプレート）を、tick ごとに 1 回の LLM 呼び出しに置き換え、ペルソナ・ガードレールで外側を包みました。自発的な発話がテンプレートではなく、キャラクター本人の声に聞こえるようになりました。本リリースでデフォルト有効です。
>
> このセクションは**リリースごとに新バージョンの内容で上書きされます**。過去の内容は [Releases](https://github.com/FanyinLiu/Nexus/releases) でご確認ください。

### なぜ書き直したか

v1 の自律行動は、ハードコードされた 3 つのロジックを繋ぎ合わせたものでした：

- `proactiveEngine.ts` — ルールツリー + テンプレート選択
- `innerMonologue.ts` — 「コンパニオンは何を考えているか」を別の LLM で生成
- `intentPredictor.ts` — 「ユーザーが次に何を言うか」をさらに別の LLM で予測

感情・関係・リズムのデータは忠実に追跡されていたものの、最終層がテンプレート・ピッカーであってライターではなかったため、内面状態が出力文字に届きませんでした。ユーザーからは「幼稚」「型通り」というフィードバック。v2 はこの部分を修正します。

### V2 で何が変わったか

```
tick（発話可能？）→ contextGatherer → decisionEngine → personaGuardrail → 出力
      │                  │                 │                   │              │
      └─ 既存のゲート     └─ 純粋な信号      └─ 1 回の LLM       └─ 禁止語 +   └─ 手動会話と
         （覚醒・VAD・      集約（IO・        呼び出しで返す       密度チェック    同じストリー
          静音時間帯・      React なし）      {speak, text,       + 任意の LLM    ミング TTS
          コスト上限）                       silence_reason}     ジャッジ        経路を使用
```

V1 → V2 の主な変化：

| | V1 | V2 |
|---|---|---|
| 判断面 | ルールツリーがテンプレートを選択 | 1 回の LLM がフル・センテンスを書く |
| コンテキスト | 判断ツリー内で散発的に読み取り | 純粋な `contextGatherer` スナップショット |
| ペルソナの声 | プロンプト接着のみ、強制なし | 複数ファイル形式のペルソナ + ガードレール層 |
| 黙る選択 | 「どのルールも発火せず」 | ファーストクラスの `silence_reason` |
| コスト | 2〜3 回の LLM 呼び出し（独白 + 予測 + 発話） | 1 回の LLM 呼び出し、主モデル共用または専用指定 |
| テスト容易性 | React と結合 | 純粋モジュール、Node で直接実行可能 |

### ペルソナ・ファイル

ペルソナ設定は 1 つの JSON フィールドに詰め込まずに、複数ファイル構成に変わりました。参照レイアウトは `src/features/autonomy/v2/personas/xinghui/`：

```
soul.md       — 一人称の背景、声のトーン、価値観
style.json    — トーンのツマミ（温度傾向、絵文字ポリシー、文体）
examples.md   — 判断プロンプトが読む few-shot の例
voice.json    — このペルソナ専用の TTS ボイス / プロバイダー上書き
tools.json    — このペルソナが呼び出しを許可されているツール
memory.md     — このペルソナが「覚えている」長期的な事実
```

ガードレールは `style.json` の禁止フレーズと密度上限を読み取り、必要に応じて LLM ジャッジでトーンの逸脱を再チェックします。厳密さは調整可能（`autonomyPersonaStrictnessV2`：`loose | med | strict`）。

### チューニング

設定 → **自律行動**：

- **V2 を有効化**（`autonomyEngineV2`）— 本リリースでデフォルト ON。OFF にすると V1 ルールツリーへフォールバック（移行期間中は両経路併存）。
- **アクティビティレベル**（`autonomyLevelV2`）— `off | low | med | high`。tick 頻度と「発話」が選ばれる割合の両方を制御。
- **判断モデル**（`autonomyModelV2`）— 空欄なら主対話モデルを共用。より安い/速いモデルを指定することも可。
- **ガードレール厳密度**（`autonomyPersonaStrictnessV2`）— `loose | med | strict`。

### V1 のままの部分

感情モデル、関係追跡、リズム学習、フォーカス認識、ドリームサイクル、ゴール追跡 —— いずれも変更なしで、V2 のコンテキスト・スナップショットへデータを供給し続けます。V1 の判断 3 点セット（`proactiveEngine.ts` / `innerMonologue.ts` / `intentPredictor.ts`）は、両経路の並行検証が完了する Phase 6 まで保持されます。

内部のレイヤリング規則は `src/features/autonomy/README.md`、ソースは `src/features/autonomy/v2/` を参照。

---

## 対応プロバイダー

| カテゴリ | プロバイダー |
|----------|-------------|
| **LLM (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **ウェブ検索** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

---

## おすすめモデル構成

> このおすすめは**日本語ユーザー向け**です。他の言語は [English](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) をご覧ください。

### 対話モデル（LLM）

| 用途 | プロバイダー | モデル | 備考 |
|------|------------|--------|------|
| **日常コンパニオン（おすすめ）** | DeepSeek | `deepseek-chat` | コスパ最強、日本語対応も良好、長時間の会話に最適 |
| **総合最強** | Anthropic | `claude-sonnet-4-6` | 日本語の自然さとツール呼び出しの安定性が最高クラス |
| **コスパ重視** | OpenAI | `gpt-5.4-mini` | 高速・低価格、日本語表現も自然 |
| **無料枠** | Google Gemini | `gemini-2.5-flash` | 無料枠が大きく、日本語対応も良好 |
| **深い推論** | DeepSeek | `deepseek-reasoner` | 複雑な推論・数学・コードが必要な場合 |

### 音声入力（STT）

| 用途 | プロバイダー | モデル | 備考 |
|------|------------|--------|------|
| **最高精度** | OpenAI | `whisper-large-v3` | 業界標準、日本語認識精度が最高クラス |
| **コスパ重視** | OpenAI | `gpt-4o-mini-transcribe` | 多言語対応、既存の OpenAI Key で利用可能 |
| **高精度クラウド** | ElevenLabs Scribe | `scribe_v1` | 99 言語対応、日本語の句読点・話者検出も精度高 |
| **ローカルストリーミング** | Paraformer | `paraformer-trilingual` | 話しながらリアルタイム変換、低遅延 |
| **ローカル高速** | SenseVoice | `sensevoice-zh-en` | Whisper の 15 倍高速、オフライン |

### 音声出力（TTS）

| 用途 | プロバイダー | ボイス | 備考 |
|------|------------|--------|------|
| **無料おすすめ** | Edge TTS | 七海 (`ja-JP-NanamiNeural`) | Microsoft 無料、自然な日本語女性ボイス、API Key 不要 |
| **無料（男性）** | Edge TTS | 圭太 (`ja-JP-KeitaNeural`) | 落ち着いた日本語男性ボイス、無料 |
| **最高品質** | ElevenLabs | カスタム `voice_id` | 世界トップクラスの音声合成、声クローン対応 |
| **クラウド汎用** | OpenAI TTS | `nova` / `alloy` | 既存の OpenAI Key で利用、`gpt-4o-mini-tts` モデル |
| **ローカルオフライン** | OmniVoice | 内蔵ボイス | 完全オフライン、ローカルポート 8000、RTX 3060 で動作 |

---

## クイックスタート

**必要環境**：Node.js 22+ · npm 10+

```bash
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus
npm install
npm run electron:dev
```

ビルドとパッケージング：

```bash
npm run build
npm run package:win     # または package:mac / package:linux
```

---

## 技術スタック

| レイヤー | テクノロジー |
|----------|-------------|
| ランタイム | Electron 36 |
| フロントエンド | React 19 · TypeScript · Vite 8 |
| キャラクター | PixiJS · pixi-live2d-display |
| ローカル ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| パッケージング | electron-builder |

---

## コントリビューション

コントリビューションを歓迎します！バグ修正、新機能、翻訳、ドキュメントなど——お気軽に PR を送るか、Issues でディスカッションを始めてください。

---

## Star 履歴

<a href="https://star-history.com/#FanyinLiu/Nexus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
 </picture>
</a>

---

## ライセンス

[MIT](../LICENSE)
