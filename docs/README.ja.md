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

- 💝 **感情メモリ + 関係アーク（v0.2.9）** — コンパニオンは別れ際の*感情のトーン*を記憶し、言葉の内容だけでなく感情も覚えます。5 段階の関係進化（他人 → 知り合い → 友人 → 親友 → 親密）がトーン、言葉遣い、行動の境界に影響。メモリはペルソナごとの `memory.md` ファイルに永続化され、ペルソナ切替で関係コンテキストが失われません。

- 🎭 **キャラクターカード + VTube Studio ブリッジ（v0.2.9）** — Character Card v2/v3 形式をインポート（chub.ai / characterhub 互換）。VTube Studio WebSocket プラグイン API で外部 Live2D モデルを駆動しつつ、Nexus のメモリ / 自律行動スタックを維持。

- 🌤️ **リビングシーン（v0.2.9）** — 14 段階の天気状態、24 時間連続サンライトフィルター、15 枚の AI 生成 日中/夕暮れ/夜 シーンバリアント。雰囲気のある奥行き、静的な壁紙ではなく。

- 🤖 **自律的な内面生活（V2）** — tick ごとに 1 回の LLM 判断呼び出し。入力は階層化スナップショット（感情・関係・リズム・デスクトップ・直近の会話）、出力はペルソナ・ガードレールを通過。テンプレート的な発話ではなく、キャラクター自身の声で話し、黙ることもできます；v0.2.7 からはバックグラウンド調査のサブエージェントを派遣することも可能。

- 🧰 **サブエージェント派遣（v0.2.7）** — コンパニオンが背後で制限付きの調査ループ（Web 検索 / MCP ツール）を走らせ、結果のサマリーを次の返信に織り込みます。並列数・日次予算の制御付き、デフォルト OFF、`設定` から有効化。

- 🔧 **ツール呼び出し (MCP)** — ウェブ検索、天気、リマインダー、あらゆる MCP 互換ツール。ネイティブ関数呼び出しに対応し、`tools` をサポートしないモデル向けにプロンプトモードのフォールバックも搭載。

- 🔄 **プロバイダーフェイルオーバー** — 複数の LLM / STT / TTS プロバイダーをチェーン接続。1つがダウンしても、会話を中断せず次に切り替え。

- 🖥️ **デスクトップ認識** — クリップボード、フォアグラウンドウィンドウタイトル、（オプションで）スクリーン OCR を読み取り。コンテキストトリガーにより、あなたの操作に反応。

- 🔔 **通知ブリッジ** — ローカル Webhook サーバー + RSS ポーリング。外部通知をコンパニオンの会話にプッシュ。

- 💬 **マルチプラットフォーム** — Discord と Telegram ゲートウェイ、チャットごとのルーティング対応。スマートフォンからもコンパニオンと会話可能。

- 🌐 **多言語** — UI は簡体字中国語、繁体字中国語、英語、日本語、韓国語に対応。

---

## 今回のアップデート — v0.3.1（安定版、2026-04-28）

> **感情の主線 + セキュリティ監査の累積リリース。** v0.3.0 以来 92 commit、4 ヶ月の検証期間、beta.1 → beta.5 が各々一つのクラスの問題を閉じてきました。詳細は [RELEASE-NOTES-v0.3.1.md](RELEASE-NOTES-v0.3.1.md)（英語）を参照。

| テーマ | 内容 |
|---|---|
| **🧠 コンパニオンの語気が適応する** | 14 日の長窓口 + 3 日の短窓口の感情ベースラインが毎ターンのプロンプトに注入される：停滞気味なら助言を控えて受け止め優先；急な落ち込みならテンポを落とす；揺れが大きい日は方向誘導しない；安定して温かい日はリズムに合わせる。Russell 1980 + Kuppens 2015 + Trull 2008。 |
| **💔 Gottman 関係破綻の四騎士 / 修復** | 批判 / 軽蔑 / 防衛 / 沈黙の四つを自動検出；次のターンで soft start-up + accept influence の修復姿勢を注入。**全工程は静かに変わるのみ — 「あなたのこの状態を見ている」と告げるバッジは一切出ない**。 |
| **🔒 critical CVE 2 件をクリア** | `pixi-live2d-display` が `gh-pages`（プロトタイプ汚染）を runtime deps に誤って入れていた；`npm overrides` で CVE 修正版に強制アップグレード。 |
| **🛡️ IPC 監査 6/7 HIGH を解消** | H2/H3/H5/H6/H7/H8 + M1/M2/M3/M5 + L3/L4/L6 全て修正、H4 は設計上 v1.0 に deferred。 |
| **🐛 30+ 静的バグ修正** | 4 ラウンドの audit + 並列 agent によるスキャン；template-replace `$&` 解析漏れ、並行レース、StrictMode 純粋化、NaN ガード、async leak、storage 検証。 |
| **🚦 リリース前チェックを 26 項目に拡張** | `prerelease-check.mjs` を 8 項目から 6 stage / 26 check に拡張：プロセス / コード品質 / セキュリティ / 資産 / ドキュメント遵守 / プライバシー統治。 |
| **🧹 UI 整理** | 手紙 / タイムカプセル / 小さな用事 / 開いたままの糸 / ムードマップの 5 つの settings パネルを引き出しから外しました（基盤の scheduler は動き続けています）。「コンパニオンの感情適応はユーザーが感じるもので、設定するものではない」。 |

<details>
<summary>この安定版が含む v0.3.1-beta 系列</summary>

- **beta.1** — インストーラー縮小（1.2 GB → 250 MB）
- **beta.2** — IPC セキュリティ強化（H5 / H8 / H4 緩和）
- **beta.3** — Live2D / thinking-mode / TTS / マルチモーダルの 4 つの回帰修正
- **beta.4** — 監査 + 仕上げ（compaction race、ja/ko 翻訳）
- **beta.5** — 感情主線 M1.4-1.7 + 多日 Arc + yearbook エクスポート

</details>

---

## 一つ前の安定版 — v0.3.0

> **安定版リリース。** v0.2.9 → v0.3.0 累計 100+ commit、約 12,000 行差分、
> +361 ユニットテスト。すべての変更は後方互換、旧データは自動マイグレートされます。
> 開発者向けの詳細は
> [RELEASE-NOTES-v0.3.0.md](RELEASE-NOTES-v0.3.0.md)（英語）を参照してください。

| テーマ | 内容 |
|---|---|
| **🧠 メモリが働く** | 重要度加重リコール；dream cycle が 1–3 件の短い洞察を生成；callback キュー（次の会話で過去の記憶を優しく差し出す）；30 / 100 / 365 日の記念日マイルストーン。 |
| **💝 関係に形がある** | 気分連動リコール（3 モード）；5 段階マイルストーンの初回発火；4 つのサブ次元；再会フレーミングの強化。 |
| **🤝 関係にタイプがある** | onboarding と設定で *オープン / 友達 / メンター / 静かな伴侶* を選択 —— `SOUL.md` を上書きせず、1 行で system prompt をバイアス。 |
| **💭 「思っているよ」通知** | 長時間話していないと、設定した関係タイプに合わせて OS 通知。23–08 時はクワイエットアワーで強制無効。 |
| **🎬 隅にいる存在感** | autonomy V2 の第 4 アクション（`idle_motion` 無音ジェスチャー）；動的 cadence；初期返信での好奇心の問い。 |
| **🌅 滑らかなシーン遷移** | 5–7 時 / 16–18 時 / 19–21 時に 2 時間の遷移窓、smoothstep 緩和；色のコントラストを強化 —— 夜明けピンク、ゴールデンアワー深いアンバー、深夜は冷たいくすんだ青。 |
| **🪟 Liquid Glass UI** | バイオレットアクセントの再スキン；ツールバー整理；時間連動絵文字挨拶；ウィンドウサイズ / 位置が起動間で永続化。 |
| **🌤️ 天気がより正確に** | 時間別予報、体感気温 + 湿度、明後日予報。 |
| **🧹 エンジニアリング整理** | i18n.ts 1842 → 588 行；共有 SettingsField コンポーネント；正規表現コンパイルキャッシュ；async-lock 重複排除；インストーラを約 30–60 MB スリム化。 |

<details>
<summary>本安定版に折り込まれた beta ライン</summary>

beta ラインが基盤を作り、本安定版で最終仕上げ：

- **v0.3.0-beta.1** —— 関係システムの 3 つの独立軸：気分連動リコール（VAD 投影 + 共感 / 修復 / 強化モード）、一度だけのレベルアップ指示、4 サブ次元。[Notes](RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** —— 安定性 + リテンションパス：重要度加重メモリ、dream-cycle reflection、callback queue、記念日マイルストーン、idle motion、動的 cadence、Liquid Glass UI、天気精度、トレイ + dock アイコン、7 件のセキュリティ修正。[Notes](RELEASE-NOTES-v0.3.0-beta.2.md)

</details>

---

## 前回のアップデート — v0.2.9

> 感情メモリとリレーションシップ進化がヘッドライン —— コンパニオンが関係の発展を追跡し、各会話の感情的文脈を記憶するようになりました。天気＆シーンシステムをゼロから再構築（14 種の天気状態 + AI 生成シーン）。キャラクターカードインポート、VTube Studio ブリッジ、完全 5 言語 i18n。
>
> このセクションは**リリースごとに新バージョンの内容で上書きされます**。過去の内容は [Releases](https://github.com/FanyinLiu/Nexus/releases) でご確認ください。

### 🧠 感情メモリとリレーションシップ進化 — ヘッドライン

コンパニオンがセッションをまたいで感情的文脈を引き継ぐようになりました。前回温かい雰囲気で別れたなら温かく迎え、疲れていたなら体調を気遣います。5 段階の関係ステージ — 他人 → 知人 → 友人 → 親友 → 親密 — がコンパニオンのトーン、言葉遣い、行動の境界に影響します。進行は暗黙的で、蓄積された交流によって駆動され、目に見えるメーターはありません。

不在認識：コンパニオンはあなたの離席時間に気付きます。短い離席にはやさしい「おかえり」、長期間の不在には本物の好奇心（「どこにいたの？」）。会話メモリはペルソナごとの `memory.md` ファイルに永続化され、セッション間で失われません。

### 🌦️ 天気＆シーンシステムの再構築

旧天気ウィジェットを完全な大気システムに置き換えました：

- **14 種の強度グレード付き天気状態**、フルシーン視覚効果付き — 空の色調、密度の高いパーティクル層、光る雨と雪。
- **連続サンライトシステム**、輝度 / 彩度 / 色相フィルター付き。本物の夜、きめ細かい昼間のグラデーション — 単なる「昼」と「夜」ではありません。
- **15 枚の AI 生成アニメシーン**（5 ロケーション × 昼 / 夕暮れ / 夜）、視覚的統一感のためにハンドプロンプト。
- **14 状態のペットタイムプレビュー**、現在時刻にロックして各天気の見た目を確認可能。
- **多言語天気地名パース**、Nominatim ジオコーディング対応 — 任意の言語で都市名を入力。

### 📇 キャラクターカードインポート

Character Card v2 / v3 フォーマット（PNG 埋め込み + JSON）のインポートに対応 — chub.ai、characterhub など各コミュニティのカードと互換。設定 → キャラクターで `.png` カードファイルをドロップすると、ペルソナ情報が自動入力されます。

### 🎭 VTube Studio ブリッジ

VTube Studio 経由で外部 Live2D モデルを駆動する WebSocket ブリッジ。コンパニオンの感情状態が VTS モデルの表情とモーションにリアルタイム同期されます。

### 🌐 完全 i18n

すべての UI サーフェスが 5 言語（EN / ZH-CN / ZH-TW / JA / KO）の完全翻訳に対応：設定、チャット、オンボーディング、ボイススタック、システムプロンプト、エラーメッセージ、データレジストリ。設定に地球アイコン + ポップオーバー式言語スイッチャー。

### 🐾 ペットシステムの強化

- **インライン表情オーバーライド**：コンパニオンが返信に `[expr:name]` タグを書いて、発話中に特定の Live2D 表情をトリガー。
- **タップゾーンリアクションプールの拡張** — キャラクターをつつくとより多彩な反応。
- **モデルごとの重み付きアイドルフィジェット** — キャラクターごとにアイドルアニメーションの雰囲気が異なります。
- **マウスドラッグリサイズ** — ペットキャラクターウィンドウのサイズを変更。
- **13 種の細粒度ペットムード状態** — 表情選択を駆動。

### 🔧 その他の改善とバグ修正

- Lorebook セマンティックハイブリッド検索（キーワードマッチングの上にベクトル検索を追加）。
- LLM 返信に対するユーザー設定可能な正規表現変換。
- オンボーディングのボイスステップにローカル音声モデルヘルスストリップを追加。
- Sherpa モデルを Mac + Linux インストーラーにバンドル。
- クロスウィンドウ BroadcastChannel 同期保存ループとメッセージ上書きを修正。
- ランタイムステートブリッジの自己フィードレンダーストームを修正。
- TTS タイムアウトレンダーストームを修正。
- ウェイクワードの一時的なデバイスエラーが永続的として扱われる問題を修正。
- Autonomy V1 コードを削除（Phase 6 クリーンアップ）。

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

## ダウンロードとインストール

### ビルド済みインストーラー（推奨）

[release ページ](https://github.com/FanyinLiu/Nexus/releases/latest) から最新インストーラーをダウンロード：

| プラットフォーム | ファイル |
|---|---|
| Windows | `Nexus-Setup-<バージョン>.exe`（NSIS、未署名） |
| macOS | `.dmg` または `.zip`（未署名、arm64 + x64 ユニバーサル） |
| Linux | `.AppImage` / `.deb` / `.tar.gz` |

> **初回起動時にセキュリティ警告が表示されますが、これは想定内です。**
> Nexus のリリースはコード署名されていません——Apple Developer
> 証明書も Windows EV 証明書も使っていません。これは意図的な
> 選択です（個人プロジェクトなので、有料化せず、継続的な
> インフラコストも背負わない方針）。警告の意味は「この開発者は
> 署名料を支払っていない」であって、「これはマルウェアだ」では
> ありません。ソースコードは GitHub で公開、各リリースは公開
> CI からビルドされており、Linux のアーティファクトには
> SHA-256 と GPG 分離署名が付属しているため、独立に検証できます。

#### macOS 初回起動

1. `.dmg` を開いて `Nexus.app` を `/Applications` にドラッグ。
2. Gatekeeper の隔離属性を解除——「ターミナル」を開いて実行：
   ```bash
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```
   （あるいは：Nexus.app を右クリック → 開く → ダイアログで確認。）
3. Nexus を起動。初回実行時に **「ローカル音声モデルのインストール」**
   ウィザードが表示されます。**「ワンクリックダウンロード」** をクリックして
   ~280 MB の sherpa-onnx + VAD モデルを
   `~/Library/Application Support/Nexus/sherpa-models` にダウンロード。
   ウィザードは閉じても、後で設定から再度開けます。
4. Python 系のオプション（OmniVoice TTS / GLM-ASR）は自動検出されます。
   Python + `requirements.txt` を未インストールなら静かにスキップ——
   コアのチャット + SenseVoice STT + Edge TTS スタックは引き続き動作します。

#### Windows 初回起動

1. `Nexus-Setup-<バージョン>.exe` を実行。
2. SmartScreen が **「Windows によって PC が保護されました」** と表示。
3. 警告の下にある **「詳細情報」** をクリック、続けて **「実行」** をクリック。
4. NSIS インストーラーを通常通り進めてください。初回起動時にローカル音声モデル ウィザードが macOS と同じように表示されます。

#### Linux 初回起動

- **AppImage**：`chmod +x Nexus-<バージョン>.AppImage` してダブルクリックまたはターミナルで実行。Linux ディストリは macOS / Windows のようなアプリレベルの署名を強制しないため、警告は出ません。
- **.deb**：`sudo dpkg -i Nexus-<バージョン>.deb`（または、ディストロのパッケージマネージャーで開く）。
- **ダウンロード検証**（オプション）：各リリースには `SHA256SUMS` ファイルと `*.AppImage.asc` / `*.deb.asc` GPG 分離署名が付属しています。[release ページ](https://github.com/FanyinLiu/Nexus/releases/latest) で公開された公開鍵をインポートし、`gpg --verify Nexus-<バージョン>.AppImage.asc` で完全性を確認できます。

---

## クイックスタート

> このセクションは開発者がソースから実行するためのものです。一般ユーザーは上の「ダウンロードとインストール」を参照してください。

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
| ランタイム | Electron 41 |
| フロントエンド | React 19 · TypeScript · Vite 8 |
| キャラクター | PixiJS · pixi-live2d-display |
| ローカル ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| パッケージング | electron-builder |

---

## ロードマップ

### 予定

- [ ] **スクリーン認識プロアクティブ会話** — 画面コンテキスト（フォアグラウンドアプリ、表示テキスト）を定期的に読み取り、ユーザーの作業に関連する会話を主体的に開始。話しかけられるのを待つだけではなくなります。
- [ ] **Decision / Roleplay / Agent 三層分離** — 意図分類（高速）、ロールプレイ（ペルソナ純粋）、バックグラウンド Agent タスクを分離。ロールプレイ層はツールのメタデータを一切見ず、Agent の結果はキャラクターが自分の声で「伝える」形に。
- [ ] **キャラクター日記＆自律タイムライン** — コンパニオンが毎日一人称の日記を自動生成し、その日の出来事を記録。オプションで閲覧可能なフィードに「つぶやき」を投稿し、独立した生活感を演出。
- [ ] **日課スケジュール＆活動状態** — コンパニオンが日課（仕事 / 食事 / 睡眠 / 通勤）に従い、利用可能性・トーン・エネルギーに影響。深夜の会話は朝とは違った雰囲気に。
- [ ] **ミニモード / ドック端隠れ** — ペットを画面端にドラッグすると自動的に隠れ、ホバーでひょっこり顔を出すアニメーション。「いつもいるけど邪魔しない。」
- [ ] **ウェブカメラ認識** — MediaPipe フェイスメッシュで疲労サイン（あくび、目を閉じる、眉をひそめる）を検出し、コンパニオンのコンテキストに注入して能動的に反応。

### 継続中

- [ ] Pipecat スタイルのフレームパイプラインでモノリシック TTS コントローラーを置換（Phase 2-6; Phase 1 は v0.2.4 で出荷済み）。
- [ ] electron-updater + 署名バイナリによる自動アップデート。
- [ ] モバイルコンパニオンアプリ（デスクトップインスタンスのボイスオンリーリモコン）。

---

## コミュニティ

Nexus は個人メンテナンスのプロジェクトです。issue や PR の対応速度はトリアージの精度に左右されます：

- 🐛 **バグを見つけた？** → [バグ報告](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml)
- 💡 **明確な機能アイデア？** → [機能リクエスト](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml)
- 🧠 **もっと大きなアイデア？** → まず [Ideas ディスカッション](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas) で皆の意見を聞く
- ❓ **セットアップや使い方で困った？** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- 🎨 **使い方を共有したい？** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- 💬 **雑談？** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)
- 📣 **リリースノートとロードマップ** → [Announcements](https://github.com/FanyinLiu/Nexus/discussions/categories/announcements)

---

## コントリビューション

コントリビューション歓迎——バグ修正、新プロバイダー、UI 調整、翻訳、Live2D モデル、新しい自律行動など。一行の issue やタイポ修正の PR でもプロジェクトを前進させます。

クイックスタート：

- [**コントリビューティングガイド**](../CONTRIBUTING.md) で開発環境、プロジェクト構成、コードスタイル、PR ワークフローを確認。
- [issue テンプレート](https://github.com/FanyinLiu/Nexus/issues/new/choose) でバグや機能リクエストを投稿——統一フォーマットでトリアージが迅速に。
- プッシュ前に `npm run verify:release`（lint + テスト + ビルド）を実行——CI と同じチェックです。
- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) に従う：`feat:`、`fix:`、`docs:`、`refactor:` など。
- PR は 1 つの論理的な変更のみ。関係のない修正は別 PR に分割。

すべての参加は [行動規範](../CODE_OF_CONDUCT.md) に基づきます——要約：**思いやり、善意の推定、仕事に集中**。

### セキュリティ問題

セキュリティ脆弱性を見つけた場合、公開 issue を作成**しないでください**。代わりに [プライベートセキュリティアドバイザリ](https://github.com/FanyinLiu/Nexus/security/advisories/new) から報告してください。

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
