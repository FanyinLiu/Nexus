<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>記憶、音声、Live2D、長期的な関係状態を備えたローカルファーストのデスクトップ AI コンパニオン。</b></p>

<p align="center">Nexus が重視するのは連続性です。コンパニオンは大切だったことを覚え、関係の変化に気づき、デスクトップペットとしてそこにいて、あなたが明確に許可したときだけ小さな手助けもできます。モデル呼び出しはあなたが選んだ provider を使い、記憶・音声オーケストレーション・ツール・安全状態は手元のマシンに残ります。</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue&label=release" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b> · <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
</p>

> **現在の安定版：** v0.4.3。安定入口は [RELEASE-NOTES-v0.4.3.md](RELEASE-NOTES-v0.4.3.md) です。Nexus はデスクトップ・コンパニオン認識の粗い時間表現とプライバシー優先を保ちながら、穏やかな check-in ポリシー、設定の視覚システム、リリース監査をさらに締めます。正式なインストーラーは保護された tag ワークフローから GitHub Releases にのみ公開されます。

> **開発スコープの注記：** この多言語 README は長期的な機能一覧を残しています。短期開発はルートの [README](../README.md) と [Nexus アップグレード統合計画](NEXUS_UPGRADE_INTEGRATION_PLAN.md) を基準にしてください。Phase 1 は常駐する小さなデスクトップウィンドウ、ミニマルなアバター、Ollama / DeepSeek のテキストモデル、シンプルな会話だけに絞ります。

---

## 今回のアップデート — v0.4.3

> **Check-In ポリシーとリリースゲートの同期。** v0.4.3 では、穏やかな check-in をまずローカルで抑制可能な in-app 判断として扱い、メッセージ送信、ツール実行、外部通知作成は行いません。詳細は [RELEASE-NOTES-v0.4.3.md](RELEASE-NOTES-v0.4.3.md)（英語）。

Nexus と会話中のとき、直前に dismiss したとき、同じ種類の信号が重なるとき、古い「Nexus に戻った」信号のときは静かに抑制されます。時間表現は引き続き粗く、正確なタイマーや生のデスクトップ内容をモデル境界へ渡しません。設定 UI、リリース監査、パフォーマンス予算は `verify:pr` とリリース前ゲートで守ります。

## 前回のアップデート — v0.4.1

> **コンパニオン UI、設定、信頼性の強化。** この安定版では、メイン会話パネル、設定画面、Image4 コンパニオン領域を整理し、source-only の UI、プライバシー、セキュリティ、パフォーマンス監査を強化します。詳細は [RELEASE-NOTES-v0.4.1.md](RELEASE-NOTES-v0.4.1.md)（英語）。

Nexus は静かで保守的、一時停止可能なまま、短期で粗いコンパニオン要約だけを作ります。v0.4.1 では設定ドロワーのスタイルを遅延読み込みに保ち、大きな CSS を起動パスへ戻さないようにします。時間表現は「しばらく」「30分くらい」「1時間くらい」のように粗く、生のスクリーンショット、完全なクリップボード、私的なメッセージ、正確なタイマーはモデルへ送りません。プロアクティブな check-in 拡張は後続版へ、マウス追従、タイピング反応、ウィンドウ操作は v0.5 の範囲です。

## 以前のアップデート — v0.4.0

> **デスクトップ・コンパニオン認識の土台。** この安定版から、Nexus を開いている間の時間の流れを静かに理解する v0.4 ラインが始まります。詳細は [RELEASE-NOTES-v0.4.0.md](RELEASE-NOTES-v0.4.0.md)（英語）。

Nexus はまず静かでいることを優先し、短期で粗い、一時停止・削除可能なコンパニオン要約だけを作ります。モデルへ渡るのはサニタイズ済みの要約であり、生のスクリーンショット、完全なクリップボード、私的なメッセージ、正確なタイマーではありません。

## 旧バージョンの記録

README には現在の安定版 v0.4.3 と一つ前の公開版 v0.4.1 の要点だけを載せます。より古い履歴は [CHANGELOG](../CHANGELOG.md) と [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases) に集約し、README 上部で古いバージョン番号を更新し続けません。

---

## 読む順番

| 目的 | 参照先 |
|---|---|
| アプリをインストール | [最新リリースをダウンロード](https://github.com/FanyinLiu/Nexus/releases/latest) |
| プロダクトを理解 | [なぜ Nexus なのか](#なぜ-nexus-なのか) · [機能](#機能) |
| ソースから実行 | [クイックスタート](#クイックスタート) |
| モデルを設定 | [おすすめモデル構成](#おすすめモデル構成) · [対応プロバイダー](#対応プロバイダー) |
| 安全性とプライバシーを確認 | [セーフティとサポート](#セーフティとサポート) |
| コミュニティに参加 | [コミュニティ](#コミュニティ) · [Community Guide](COMMUNITY.md) |
| 0.4 の方向を理解 | [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md) |
| 0.4 現在の安定版を見る | [v0.4.3 Release Notes](RELEASE-NOTES-v0.4.3.md) · [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md) |

## なぜ Nexus なのか？

多くの AI コンパニオンは、モデル性能、音声のリアルさ、エンゲージメント頻度を競っています。Nexus が向き合う問いは少し違います。**長く続くコンパニオンは何を覚えるべきで、その履歴は時間とともに存在感をどう変えるべきか？**

答えは単一機能ではなく、積み重なる小さな儀式です。ちょうどよいタイミングで戻ってくる古い記憶、週に一度「実際に何があったか」を書く手紙、正しい感情の重みで差し出される回想、沈黙がふさわしいときには沈黙できるコンパニオン。

その周囲に、5 言語 UI、18+ LLM provider、マルチエンジン STT/TTS とフェイルオーバー、Live2D、VTube Studio ブリッジ、MCP ツール、ローカル Webhook/RSS 通知、強化された Electron IPC 境界があります。工学的な仕組みは土台です。本当のプロダクトは、それらが数か月の使用で積み上げる関係の感覚です。

---

## 機能

- 🎙️ **常時ウェイクワード** — ウェイクワードを言うだけで会話開始、ボタン不要。sherpa-onnx キーワードスポッターを使用し、メインプロセスの Silero VAD で単一マイクストリームを共有。

- 🗣️ **連続音声チャット** — マルチエンジン STT / TTS、エコーキャンセル付き自動割り込み（自分の声で起きることがない）、文単位のストリーミング TTS（最初のカンマで音声再生開始）。

- 🧠 **夢を見る記憶** — ホット / ウォーム / コールドの三層記憶アーキテクチャ、BM25 + ベクトルのハイブリッド検索。毎晩の*ドリームサイクル*が会話を*ナラティブスレッド*にクラスタリングし、コンパニオンがあなたの全体像を徐々に構築。

- 💝 **感情メモリ + 関係アーク** — コンパニオンは別れ際の*感情のトーン*を記憶し、言葉の内容だけでなく感情も覚えます。5 段階の関係進化（他人 → 知り合い → 友人 → 親友 → 親密）がトーン、言葉遣い、行動の境界に影響。メモリはペルソナごとの `memory.md` ファイルに永続化され、ペルソナ切替で関係コンテキストが失われません。

- 🎭 **キャラクターカード + VTube Studio ブリッジ** — Character Card v2/v3 形式をインポート（chub.ai / characterhub 互換）。VTube Studio WebSocket プラグイン API で外部 Live2D モデルを駆動しつつ、Nexus のメモリ / 自律行動スタックを維持。

- 🌤️ **リビングシーン** — 14 段階の天気状態、24 時間連続サンライトフィルター、15 枚の AI 生成 日中/夕暮れ/夜 シーンバリアント。雰囲気のある奥行き、静的な壁紙ではなく。

- 🤖 **自律的な内面生活（V2）** — tick ごとに 1 回の LLM 判断呼び出し。入力は階層化スナップショット（感情・関係・リズム・デスクトップ・直近の会話）、出力はペルソナ・ガードレールを通過。テンプレート的な発話ではなく、キャラクター自身の声で話し、黙ることもできます。

- 🔧 **ツール呼び出し (MCP)** — ウェブ検索、天気、リマインダー、あらゆる MCP 互換ツール。ネイティブ関数呼び出しに対応し、`tools` をサポートしないモデル向けにプロンプトモードのフォールバックも搭載。

- 🔄 **プロバイダーフェイルオーバー** — 複数の LLM / STT / TTS プロバイダーをチェーン接続。1つがダウンしても、会話を中断せず次に切り替え。

- 🖥️ **デスクトップ認識** — クリップボード、フォアグラウンドウィンドウタイトル、（オプションで）スクリーン OCR を読み取り。コンテキストトリガーにより、あなたの操作に反応。

- 🔔 **通知ブリッジ** — ローカル Webhook サーバー + RSS ポーリング。外部通知をコンパニオンの会話にプッシュ。

- 💬 **マルチプラットフォーム** — Discord と Telegram ゲートウェイ、チャットごとのルーティング対応。スマートフォンからもコンパニオンと会話可能。

- 🌐 **多言語** — UI は簡体字中国語、繁体字中国語、英語、日本語、韓国語に対応。

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
| **日常コンパニオン（おすすめ）** | DeepSeek | `deepseek-v4-flash` | コスパ最強、日本語対応も良好、長時間の会話に最適 |
| **総合最強** | OpenAI | `gpt-5.4` | 総合力が高く、ツール呼び出しも安定 |
| **コスパ重視** | OpenAI | `gpt-5.4-mini` | 高速・低価格、日本語表現も自然 |
| **無料枠** | Google Gemini | `gemini-2.5-flash` | 無料枠が大きく、日本語対応も良好 |
| **深い推論** | DeepSeek | `deepseek-v4-pro` | 複雑な推論・数学・コードが必要な場合 |

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

> 次の表は v0.4.3 の正式リリース契約です。インストーラーは、保護された tag ワークフローが GitHub Releases へ正常に公開した実在アセットだけを基準にしてください。ローカル包や第三者の再配布物は使用しないでください。

| プラットフォーム | ファイル |
|---|---|
| Windows x64 | `Nexus-Setup-<バージョン>.exe`（NSIS、`NotSigned`）+ `SHA256SUMS-windows.txt` |
| macOS arm64 | `.dmg` または `.zip`（ad-hoc、x64 / universal なし）+ `SHA256SUMS-macos.txt` |
| Linux x64 | `.AppImage` / `.deb` / `.tar.gz` + `SHA256SUMS-linux.txt` |

> **初回起動時にセキュリティ警告が表示されますが、これは想定内です。**
> Nexus v0.4.3 は Apple Developer ID / notarization または Windows
> コード署名を使用しません。macOS の ad-hoc 署名は Apple の信頼を
> 意味せず、Windows インストーラーは `NotSigned` と表示されます。
> システム警告は安全性の結論ではないため、配布元と SHA-256 を確認してください。

#### 未署名インストール時の注意

- **ダウンロード元**：公式 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases/latest) が唯一のダウンロード元です。ミラーサイトや再配布された ZIP からはインストールしないでください。入手元が不明な場合は削除し、GitHub Releases から再ダウンロードします。
- **macOS / Gatekeeper**：初回起動がブロックされた場合は、下の macOS 手順に従って右クリックから開くか、`xattr -dr com.apple.quarantine /Applications/Nexus.app` を実行します。
- **Windows / SmartScreen**：「Windows によって PC が保護されました」と表示されたら、**「詳細情報」**、続けて **「実行」** をクリックします。

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
- **ダウンロード検証**：Linux x64 アセットには `SHA256SUMS-linux.txt` が付属します。パッケージ形式を 1 つだけダウンロードした場合は、ダウンロード先で `sha256sum --ignore-missing -c SHA256SUMS-linux.txt` を実行し、対象ファイルが `OK` になることを確認してください。チェックサムファイルも同じ公式 release から取得してください。

#### macOS unsigned auto-update limitation

macOS arm64 の未署名ビルドは新しいバージョンを確認して公式 release ページを開くだけで、アプリを自動ダウンロードまたは置換しません。更新時は新しい `.dmg` / `.zip` を手動で取得し、Gatekeeper の確認後に `/Applications/Nexus.app` を置き換えます。

#### Windows unsigned installer limitation

Windows x64 インストーラーは `NotSigned` で、発行元の本人確認や安定した SmartScreen 評価を提供できません。公式 GitHub Releases からのファイルであることを確認してから、上記の SmartScreen 手順で手動実行してください。

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
- [ ] **意図 / ロール / 許可済み手助けの分離** — 軽い意図判断、キャラクター表現、ユーザー確認後の手助けを分けます。ロール層はツールのメタデータを一切見ず、結果はコンパニオンが自分の声で「伝える」形にします。
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

コミュニティ文書は特定の 1 リリースだけのものではなく、全バージョンをまたぐ入口です。0.3 は安全性、メモリ、設定の土台を締め、0.4 はデスクトップ・コンパニオン認識へ進み、0.5 はデスクトップペットの振る舞いへ進みます。長期入口は [Community Guide](COMMUNITY.md)、0.4 の方向は [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md)、0.4 現在の安定版の説明は [v0.4.3 Release Notes](RELEASE-NOTES-v0.4.3.md)、リリース hardening は [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md) です。

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

## セーフティとサポート

Nexus は AI コンパニオンであり、臨床ツールではありません。リポジトリには、米国カリフォルニア州 **SB 243**（2026-01-01 施行）、ニューヨーク州コンパニオン AI 規制、および **EU AI Act** の重大事象報告条項（2026-08）を満たす小さなセーフティレイヤが含まれています。

**このレイヤがすること：**

- **初回起動の同意画面**——オンボーディング第 0 ステップは「あなたは AI と話していて、人ではありません；これは臨床カウンセリングではありません」と表示する読み取り専用画面で、確認後にコンパニオン設定へ進みます。クリック時刻は監査用に `localStorage` に保存されます。
- **チャット中の定期リマインダー**——「前回のリマインダーから ≥30 件のユーザーメッセージ **かつ** ≥3 時間経過」の両方を満たすと、AI と対話していることを思い出させる 1 行のシステムバブルがチャットに追加されます。両方のゲートにより、短時間集中・長時間低頻度のどちらでも過剰発動しません。
- **危機発話の検出**——ユーザーがロケール別の危機パターン（「死にたい」、「I want to kill myself」、「我想死」 など）にマッチする内容を入力すると、別パネルが会話の上にスライドインし、人間のヘルプラインを表示します：
  - **0120-279-338**（ja）よりそいホットライン、24/7 無料
  - **988**（en-US）米国自殺・危機ライフライン、24/7 通話・テキスト
  - **12356** + **800-810-1117**（zh-CN）国家統一線（2025+）+ 北京 24h
  - **1925**（zh-TW）衛生福利部 安心專線、24/7
  - **109**（ko）保健福祉部統一自殺予防線（2024+）、24/7
- **ペルソナ口調の調整**——パネルを発動させたターンの返答は、一回限りのシステムプロンプト断片によって、キャラクターは保ちつつ、感情を validate し、ジョーク禁止・手段の話禁止、短い返答、パネルへの穏やかな言及に切り替わります。

**このレイヤがしないこと：**

- **危機イベントは端末から送信されません。** 検出はローカルで動作し、パネルもローカルでレンダリングされ、「誰が何を言ったか」のテレメトリはどのサーバにも送信されません。
- 年齢検証なし、プロフィール照会なし、サードパーティデータ呼び出しなし。

**コードを独立に検証できる場所：**

| モジュール | ファイル |
|---|---|
| 検出パターン + ロケール別否定辞書 | `src/features/safety/crisisDetect.ts` |
| ホットラインカタログ（各エントリに `sourceUrl`） | `src/features/safety/hotlines.ts` |
| ホットラインパネル UI | `src/features/safety/CrisisHotlinePanel.tsx` |
| ペルソナ口調の注入 | `src/features/safety/crisisGuidance.ts` |
| 同意 + 定期リマインダー永続化 | `src/features/safety/disclosureState.ts` ほか |
| テスト | `tests/safety-*.test.ts` |

リリースのたびに、すべてのホットライン番号を権威ある情報源（厚生労働省 / WHO / IASP / 各国保健省）と照合して再確認します。誤った番号は危機にある人をデッドラインに送ることになります——他のドキュメントよりも高い基準で運用しています。

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
