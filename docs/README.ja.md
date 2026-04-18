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
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b> · <a href="README.ko.md">한국어</a>
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

- 🤖 **自律的な内面生活（V2）** — tick ごとに 1 回の LLM 判断呼び出し。入力は階層化スナップショット（感情・関係・リズム・デスクトップ・直近の会話）、出力はペルソナ・ガードレールを通過。テンプレート的な発話ではなく、キャラクター自身の声で話し、黙ることもできます；v0.2.7 からは、必要に応じてバックグラウンド調査のサブエージェントを派遣することも可能に。

- 🧰 **サブエージェント派遣（v0.2.7）** — コンパニオンが背後で制限付きの調査ループ（Web 検索 / MCP ツール）を走らせ、結果のサマリーを次の返信に織り込みます。並列数・日次予算の制御付き、デフォルト OFF、`設定` から有効化。詳細は [今回のアップデート](#今回のアップデート--v027) を参照。

- 🔧 **ツール呼び出し (MCP)** — ウェブ検索、天気、リマインダー、あらゆる MCP 互換ツール。ネイティブ関数呼び出しに対応し、`tools` をサポートしないモデル向けにプロンプトモードのフォールバックも搭載。

- 🔄 **プロバイダーフェイルオーバー** — 複数の LLM / STT / TTS プロバイダーをチェーン接続。1つがダウンしても、会話を中断せず次に切り替え。

- 🖥️ **デスクトップ認識** — クリップボード、フォアグラウンドウィンドウタイトル、（オプションで）スクリーン OCR を読み取り。コンテキストトリガーにより、あなたの操作に反応。

- 🔔 **通知ブリッジ** — ローカル Webhook サーバー + RSS ポーリング。外部通知をコンパニオンの会話にプッシュ。

- 💬 **マルチプラットフォーム** — Discord と Telegram ゲートウェイ、チャットごとのルーティング対応。スマートフォンからもコンパニオンと会話可能。

- 🌐 **多言語** — UI は簡体字中国語、繁体字中国語、英語、日本語、韓国語に対応。

---

## 今回のアップデート — v0.2.7

> サブエージェント派遣がヘッドライン；音声割り込み（バージイン）を強化して「いつでも割り込める」に（タイピング発信の TTS も含む）；音声メッセージがチャット面板に表示されない原因だったレンダーストーム・バグを修正。
>
> このセクションは**リリースごとに新バージョンの内容で上書きされます**。過去の内容は [Releases](https://github.com/FanyinLiu/Nexus/releases) でご確認ください。

### 🧰 サブエージェント派遣 — ヘッドライン

> **一言で** — コンパニオンが背後で制限付きの調査サブエージェント（Web 検索 / MCP ツール）を起動し、結果を次の返信に織り込めるようになりました。エントリは 2 つ：自律エンジンが `speak` の代わりに `spawn` を選ぶケース、メイン・チャット LLM がターンの途中で `spawn_subagent` ツールを呼ぶケース。状態はメッセージ列表上部のストリップでリアルタイムに見え、完了後のサマリーはメイン LLM が最終返信に編み込みます。デフォルト OFF、ユーザー側で有効化。

有効化手順：

```
設定 → Subagents → Enable
  maxConcurrent:    1–3（ハード上限 3）
  perTaskBudgetUsd: タスクごとのソフト上限
  dailyBudgetUsd:   当日のタスク合計のソフト上限
  modelOverride:    任意 —— 調査を安価なモデルに向ける
```

3 段階のモデル・フォールバック：`subagentSettings.modelOverride → autonomyModelV2 → settings.model`。メイン対話はそのままの設定で、調査だけを小型高速モデル（Haiku / Flash / 安価な OpenRouter エントリ）に逃がすことも可能です。

判断エンジン統合：自律プロンプトは tick ごとにライブの `subagentAvailability`（有効化フラグ + 現在の使用量 + 当日の残り予算）を参照し、ゲートが開いているときだけ `spawn` アクションを LLM に公開します。LLM が `spawn` を選択すると、オーケストレーターは必要に応じて短いアナウンス（「調べてみますね」）を通常の TTS 経路で発話しつつ、**並行して**調査を派遣します —— 直列の待ち時間はありません。

チャットツール統合：サブエージェント有効時、`spawn_subagent` がメイン LLM のツールリストに追加されます。ツール呼び出しは調査ターン（通常 10〜30 秒）をブロックし、サマリーを返します。メイン LLM はそれを最終返信に織り込みます。ユーザーはその間ずっとライブ・ストリップを見ているので、待機は沈黙になりません。

UI：`SubagentTaskStrip` がメッセージリスト上部にガラス・モーフィズムの薄型バッジとして表示され、パルス状のドットで「キュー / 実行中」を示します。完了タスクはここには表示されません —— サマリーは通常のチャットバブルとして届きます。失敗タスクは理由が読めるように 60 秒表示されます。

ソース：`src/features/autonomy/subagents/`（`subagentRuntime.ts` ステートマシン、`subagentDispatcher.ts` LLM ループ、`spawnSubagentTool.ts` + `dispatcherRegistry.ts` chat ブリッジ、`src/components/SubagentTaskStrip.tsx` UI）。6 つのユニットテストがランタイムの状態機をカバー（admit / budget / concurrency / onChange）。

### 🎙️ いつでも割り込める

以前：音声割り込みモニターは現在のターンが連続音声セッション由来のときだけアームされていました。タイピング由来の TTS 発話は割り込めない —— あなたがコンパニオンに話しかけられるなら、コンパニオンが話している**最中にも**口を挟めるべきです。これは不自然な制限でした。

- `voiceInterruptionEnabled` が ON なら、**いかなる** TTS 再生中もモニターがアームされます。もう音声由来のターンに限定されません。
- ウェイクワード listener が既に動作中のとき、モニターは 2 つ目の `getUserMedia` を開くのではなく、`subscribeMicFrames` で既存のマイクフレームを**再利用**します。macOS では既定入力に 2 本のストリームが同時にある場合にシリアライズされてモニターが間欠的に無音になる事象が観測されており、KWS が聴取中ならこの再利用経路がデフォルトです。
- 割り込み成功後、ウェイクワード以外のモードでは、再ウェイクなしに継続発話を拾えるよう VAD を強制再起動します。ウェイクワード + 常時 KWS モードは従来の挙動を維持します（KWS に再取得させる — 2 つ目の VAD を強制すると listener とマイクの取り合いになる）。

### 🐛 レンダーストーム + ウィンドウ間同期

ヘッドラインのバグは非常に奥深く、2 層構造でした。

**レンダーストーム**：親のレンダー毎に、`useChat` / `useMemory` / `usePetBehavior` / `useVoice` の消費者へ新しいオブジェクトリテラルが渡されていました。下流の memo（`chatWithAutonomy` / `petView` / `overlays` / `panelView`）が毎レンダー無効化され、子コンポーネントの useEffect が state を書き戻して連鎖 —— 典型的な "Maximum update depth exceeded" ループ。症状：チャットターンが落ち着いた瞬間にログが大量出力；2 つ目の STT 発話は、レンダラーが飢餓状態になり VAD の `speech_end` コールバックが microtask キューに入れないため停止。修正：各 hook の戻り値を useMemo で包む；`useVoice` では `lifecycle.*` / `bindings.*` / `testEntries.*` を memo deps から明示的に除外（これらのファクトリは毎レンダー再構築されますが、安定した ref 経由で動作するので古い参照でも正しく動く）。

**ウィンドウ間同期**：ペットウィンドウとチャットパネルは独立した Electron レンダラーで、それぞれ別の React ステートを持ちます。両者は localStorage の `storage` イベントを `CHAT_STORAGE_KEY`（`nexus:chat`）で監視して同期していました。しかし `useChat` の保存 effect は `upsertChatSession` しか呼んでおらず、これは `CHAT_SESSIONS_STORAGE_KEY`（`nexus:chat-sessions`）に書き込むもの — `nexus:chat` は誰も書いていませんでした。結果：ペットウィンドウ内で発生する音声ターン（setMessages はペット側）はチャットパネルからは永久に見えない状態でした。修正：`useChat` の保存 effect で `saveChatMessages(messages)` も呼び、パネルが監視しているキーを実際に更新するように。

### 🔧 起動時の修正

- **Silero VAD が実際に動くようになりました**。`browserVad.ts` は `onnxWASMBasePath` を `public/vendor/ort/` に向けていますが、このディレクトリは**存在していませんでした** —— `setup-vendor.mjs` は Live2D 関連アセットしかコピーしていなかったためです。ORT ランタイムがないため、vad-web は CJS `require()` にフォールバックし、Vite の ESM 環境下で失敗 —— Silero パス全体が legacy 録音フォールバックに降格していました。`setup-vendor.mjs` を更新して、postinstall で `node_modules` から vad-web が必要とする 4 つの wasm + mjs バンドルをコピーするようにしました。
- **`mcp:sync-servers` ハンドラーの即時登録**。このハンドラーはこれまで遅延ロード（app-ready の約 1.5 秒後）でしたが、`useMcpServerSync` は初回レンダー時に発火して未登録状態とレースしていました → "No handler registered"。`sherpaIpc` / `notificationIpc` は以前同じ理由で deferred リストから外されており、`mcpIpc` も今回 eager パスへ合流。

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
