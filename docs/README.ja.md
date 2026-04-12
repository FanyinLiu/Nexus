<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b>
</p>

---

## 概要

Nexus は Windows 向けのデスクトップ AI コンパニオンアプリです。Live2D キャラクターレンダリング、連続音声会話、長期記憶、デスクトップ認識、自律行動、マルチプラットフォーム統合を備えています。18 以上の LLM プロバイダーに対応し、完全ローカル実行またはクラウドモデルの利用が可能です。

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **デスクトップペット + パネル二画面** | Live2D キャラクター、表情・モーション・感情連動 |
| **連続音声会話** | マルチエンジン STT / TTS、ウェイクワード、VAD 音声検出、連続会話、音声割り込み |
| **長期記憶** | セマンティックベクトル検索（BM25 + ベクトルハイブリッド）、自動日記、能動的想起、記憶減衰とアーカイブ |
| **自律行動** | 内面独白、感情モデル、意図予測、関係追跡、リズム学習、スキル蒸留 |
| **デスクトップ認識** | クリップボード監視、フォアグラウンドウィンドウ検出、スクリーンショット OCR、コンテキストトリガー |
| **ツール呼び出し** | ウェブ検索（自動本文抽出）、天気照会、リマインダー、MCP プロトコル |
| **マルチプラットフォーム** | Discord / Telegram ゲートウェイ、プラグインシステム、スキルストア |
| **多言語** | 簡体字中国語 / 繁体字中国語 / 英語 / 日本語 / 韓国語 |

---

## おすすめモデル構成

### 対話モデル（LLM）

| 用途 | プロバイダー | モデル | 備考 |
|------|------------|--------|------|
| **日常コンパニオン** | DeepSeek | `deepseek-chat` | 中国語に強く、非常に低コスト |
| **最強総合** | Anthropic | `claude-sonnet-4-6` | 総合力最高、ツール呼び出しが安定 |
| **コスパ重視** | OpenAI | `gpt-5.4-mini` | 高速・低価格、高頻度会話向け |
| **無料枠** | Google Gemini | `gemini-2.5-flash` | 無料枠が大きく、入門に最適 |
| **ローカル実行** | Ollama | `qwen3:8b` | RTX 3060 12GB でスムーズに動作、完全オフライン |

### 音声入力（STT）

| 用途 | プロバイダー | モデル | 備考 |
|------|------------|--------|------|
| **ローカル高精度** | GLM-ASR-Nano | `glm-asr-nano` | 中国語認識精度が高い、RTX 3060 対応、オフライン |
| **ローカルストリーミング** | Paraformer | `paraformer-trilingual` | リアルタイム文字起こし、低遅延 |
| **クラウド（グローバル）** | OpenAI | `gpt-4o-mini-transcribe` | 多言語対応、既存の OpenAI Key で利用可能 |
| **クラウド（高品質）** | ElevenLabs Scribe | `scribe_v1` | 99 言語、自動句読点、話者検出 |

### 音声出力（TTS）

| 用途 | プロバイダー | ボイス | 備考 |
|------|------------|--------|------|
| **無料おすすめ** | Edge TTS | `ja-JP-NanamiNeural` | Microsoft 無料、API Key 不要 |
| **ローカルオフライン** | CosyVoice | SFT プリセット | 完全オフライン、RTX 3060 対応 |
| **最高品質（グローバル）** | ElevenLabs | カスタム `voice_id` | 世界トップクラスの音声合成、声クローン対応 |
| **クラウド（グローバル）** | OpenAI TTS | `alloy` | 既存の OpenAI Key で利用、`gpt-4o-mini-tts` モデル |

---

## 開発機スペック参考

| コンポーネント | モデル |
|--------------|--------|
| CPU | Intel Core i5-12400F (6C12T) |
| GPU | NVIDIA GeForce RTX 3060 12GB |
| メモリ | 32GB DDR4 |
| OS | Windows 11 Pro |

> RTX 3060 12GB はほとんどのローカルモデル（8B パラメータ以下）をスムーズに実行できます。VRAM が 8GB 未満の場合は、クラウドモデルの利用を推奨します。

---

## ライセンス

[MIT](../LICENSE)
