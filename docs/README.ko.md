<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<p align="center"><b>기억, 음성, Live2D, 장기 관계 상태를 갖춘 로컬 우선 데스크톱 AI 동반자.</b></p>

<p align="center">Nexus가 중시하는 것은 연속성입니다. 동반자는 중요한 일을 기억하고, 관계가 어떻게 변하는지 알아차리며, 데스크톱 펫으로 곁에 있고, 사용자가 명확히 허용했을 때만 작은 도움을 줄 수 있습니다. 모델 호출은 사용자가 선택한 provider를 사용하고, 기억·음성 오케스트레이션·도구·안전 상태는 내 컴퓨터에 남습니다.</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue&label=release" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
  <a href="https://github.com/FanyinLiu/Nexus/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/FanyinLiu/Nexus/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b>
</p>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Windows-Download-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux"></a>
</p>

> **현재 안정 버전:** v0.4.3. 안정 진입점은 [RELEASE-NOTES-v0.4.3.md](RELEASE-NOTES-v0.4.3.md)입니다. Nexus는 데스크톱 동반자 인식의 대략적인 시간 표현과 개인정보 우선 경계를 유지하면서, 부드러운 check-in 정책, 설정 시각 시스템, 릴리스 감사를 더 단단하게 다듬습니다. 정식 설치 파일은 보호된 tag 워크플로를 통해서만 GitHub Releases에 게시됩니다.

> **개발 범위 안내:** 이 다국어 README는 장기 기능 목록을 보존합니다. 단기 개발 기준은 루트 [README](../README.md)와 [Nexus 업그레이드 통합 계획](NEXUS_UPGRADE_INTEGRATION_PLAN.md)입니다. Phase 1은 상주하는 작은 데스크톱 창, 미니멀 아바타, Ollama / DeepSeek 텍스트 모델, 간단한 대화에만 집중합니다.

---

## 이번 업데이트 — v0.4.3

> **Check-In 정책과 릴리스 게이트 정렬.** v0.4.3은 부드러운 check-in을 먼저 로컬에서 억제 가능한 in-app 결정으로 다루며, 메시지를 보내거나 도구를 실행하거나 외부 알림을 만들지 않습니다. 자세한 내용은 [RELEASE-NOTES-v0.4.3.md](RELEASE-NOTES-v0.4.3.md)(영어).

Nexus와 대화 중이거나, 방금 dismiss했거나, 같은 종류의 신호가 반복되거나, 오래된 “Nexus로 돌아옴” 신호일 때는 조용히 억제됩니다. 시간 표현은 계속 대략적이며 정확한 타이머나 원본 데스크톱 내용을 모델 경계로 보내지 않습니다. 설정 UI, 릴리스 감사, 성능 예산은 `verify:pr`와 사전 릴리스 게이트로 보호합니다.

## 이전 업데이트 — v0.4.1

> **동반자 UI, 설정, 신뢰성 강화.** 이 안정 버전은 메인 대화 패널, 설정 화면, Image4 동반자 영역을 정리하고 source-only UI, 개인정보, 보안, 성능 감사를 강화합니다. 자세한 내용은 [RELEASE-NOTES-v0.4.1.md](RELEASE-NOTES-v0.4.1.md)(영어).

Nexus는 조용하고 보수적이며 일시정지 가능한 상태를 유지하며 짧고 대략적인 동반자 요약만 만듭니다. v0.4.1은 설정 드로어 스타일을 지연 로딩으로 유지해 큰 CSS가 시작 경로로 돌아가지 않도록 막습니다. 시간 표현은 “잠시”, “30분쯤”, “한 시간쯤”처럼 대략적이며 원본 스크린샷, 전체 클립보드, 개인 메시지, 정확한 타이머를 모델로 보내지 않습니다. 적극적인 check-in 확장은 이후 버전으로 미루고, 마우스 따라가기, 타이핑 반응, 창 상호작용은 v0.5 범위입니다.

## 더 이전 업데이트 — v0.4.0

> **데스크톱 동반자 인식의 기반.** 이 안정 버전부터 Nexus를 열어 둔 동안 시간의 흐름을 조용히 이해하는 v0.4 라인이 시작됩니다. 자세한 내용은 [RELEASE-NOTES-v0.4.0.md](RELEASE-NOTES-v0.4.0.md)(영어).

Nexus는 먼저 조용히 있는 것을 우선하며, 짧고 대략적이고 일시정지하거나 지울 수 있는 동반자 요약만 만듭니다. 모델로 전달되는 것은 정리된 요약이며, 원본 스크린샷, 전체 클립보드, 개인 메시지, 정확한 타이머가 아닙니다.

## 이전 버전 기록

README에는 현재 안정 버전 v0.4.3과 이전 공개 버전 v0.4.1의 핵심만 남깁니다. 더 오래된 기록은 [CHANGELOG](../CHANGELOG.md)와 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases)에 모으고, README 상단에서 오래된 버전 번호를 계속 관리하지 않습니다.

---

## 문서 안내

| 원하는 것 | 이동할 곳 |
|---|---|
| 앱 설치 | [최신 릴리스 다운로드](https://github.com/FanyinLiu/Nexus/releases/latest) |
| 제품 이해 | [왜 Nexus인가](#왜-nexus인가) · [주요 기능](#주요-기능) |
| 소스에서 실행 | [빠른 시작](#빠른-시작) |
| 모델 설정 | [추천 모델 구성](#추천-모델-구성) · [지원 제공자](#지원-제공자) |
| 안전/개인정보 확인 | [안전 및 지원](#안전-및-지원) |
| 커뮤니티 참여 | [커뮤니티](#커뮤니티) · [Community Guide](COMMUNITY.md) |
| 0.4 방향 이해 | [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md) |
| 0.4 현재 안정 버전 보기 | [v0.4.3 Release Notes](RELEASE-NOTES-v0.4.3.md) · [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md) |

## 왜 Nexus인가?

대부분의 AI 동반자는 모델 성능, 음성의 현실감, 상호작용 빈도를 경쟁합니다. Nexus가 묻는 질문은 조금 다릅니다. **오래 지속되는 동반자는 무엇을 기억해야 하며, 그 기록은 시간이 지나며 존재감을 어떻게 바꾸어야 할까요?**

답은 하나의 기능이 아니라 누적되는 작은 의식들입니다. 적절한 순간에 조용히 돌아오는 오래된 기억, 한 주에 실제로 무슨 일이 있었는지 적어 주는 편지, 알맞은 감정의 무게로 다시 떠오르는 회상, 침묵이 더 나을 때는 침묵할 수 있는 동반자.

그 주변에는 5개 언어 UI, 18+ LLM provider, 다중 엔진 STT/TTS와 페일오버, Live2D, VTube Studio 브리지, MCP 도구, 로컬 Webhook/RSS 알림, 강화된 Electron IPC 경계가 있습니다. 엔지니어링 시스템은 기반입니다. 진짜 제품은 이 능력들이 몇 달의 사용 속에서 쌓아 올리는 관계감입니다.

---

## 주요 기능

- 🎙️ **상시 웨이크 워드** — 버튼 없이 이름을 부르면 대화 시작. sherpa-onnx 키워드 검출기가 메인 프로세스의 Silero VAD와 하나의 마이크 스트림을 공유하며 동작합니다. 30ms ACK 간격, 500ms 쿨다운.

- 🗣️ **연속 음성 대화** — 자동 페일오버를 지원하는 멀티 엔진 STT / TTS, 문장 단위 즉시 스트리밍 TTS(첫 쉼표에서 바로 재생 시작), 에코 캔슬된 자기 가로채기로 동반자가 자기 목소리에 반응해 깨어나지 않음.

- 🧠 **꿈꾸는 기억** — 핫 / 웜 / 콜드 3단계 구조에 BM25 + 벡터 하이브리드 검색. 야간 꿈 사이클이 대화를 *내러티브 스레드*로 클러스터링하여, 세션마다 리셋되는 대신 시간이 지날수록 당신에 대한 이해가 쌓여 갑니다.

- 💝 **감정 메모리 + 관계 아크** — 동반자가 이별 시의 *감정 톤*을 기억하여, 말한 내용뿐 아니라 감정까지 기억합니다. 5단계 관계 진화(낯선 사람 → 아는 사이 → 친구 → 가까운 친구 → 친밀)가 톤, 어휘, 행동 경계에 영향. 메모리가 페르소나별 `memory.md` 파일에 영속화되어, 페르소나 전환 시 관계 컨텍스트가 유실되지 않습니다.

- 🎭 **캐릭터 카드 + VTube Studio 브리지** — Character Card v2/v3 포맷 임포트(chub.ai / characterhub 호환). VTube Studio WebSocket 플러그인 API로 외부 Live2D 모델을 구동하면서 Nexus의 기억 / 자율 행동 스택은 유지.

- 🌤️ **살아 있는 장면** — 14단계 날씨 상태, 24시간 연속 햇빛 필터, 15장의 AI 생성 낮/황혼/밤 장면 변형. 분위기 있는 깊이감, 정적인 배경화면이 아닙니다.

- 🤖 **자율적 내면 생활 (V2)** — tick마다 한 번의 LLM 판단 호출, 계층적 스냅샷(감정 · 관계 · 리듬 · 데스크톱 · 최근 대화) 입력, 페르소나 가드레일을 통과한 출력. 템플릿 같은 발화는 더 이상 없고 — 캐릭터의 목소리로 말하거나, 침묵을 선택할 수 있습니다.

- 🔧 **내장 툴** — 웹 검색, 날씨, 알림. 네이티브 함수 호출과 `tools`를 지원하지 않는 모델용 프롬프트 모드 폴백 **모두** 작동.

- 🔄 **제공자 페일오버** — 여러 LLM / STT / TTS 제공자를 체이닝. 하나가 다운되면 Nexus는 대화를 끊지 않고 다음으로 전환합니다.

- 🖥️ **데스크톱 인지** — 포그라운드 창 제목, 클립보드, (선택적으로) 화면 OCR. 컨텍스트 트리거를 통해 사용자의 실제 작업에 반응합니다.

- 🔔 **알림 브리지** — 로컬 웹훅 서버 + RSS 폴링 — 외부 알림을 동반자와의 대화에 밀어 넣습니다.

- 💬 **폰에서도 연결** — Discord와 Telegram 게이트웨이, 채팅별 라우팅 지원. 휴대폰에서 동반자와 대화하고 음성으로 응답받기.

- 🌐 **다국어 UI** — 간체 중국어, 번체 중국어, 영어, 일본어, 한국어.

---

## 지원 제공자

| 카테고리 | 제공자 |
|----------|--------|
| **LLM (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **웹 검색** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

---

## 추천 모델 구성

> 이 추천은 **한국어 사용자**를 위한 것입니다. 다른 언어는 [English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)를 참조하세요.

### 대화 모델 (LLM)

| 용도 | 추천 제공자 | 추천 모델 | 설명 |
|------|-----------|---------|------|
| **일상 동반자 (추천)** | DeepSeek | `deepseek-v4-flash` | 가성비 최고, 한국어 대응 양호, 장시간 대화에 최적 |
| **종합 최강** | OpenAI | `gpt-5.4` | 종합 성능이 높고 도구 호출이 안정적 |
| **가성비** | OpenAI | `gpt-5.4-mini` | 빠르고 저렴, 한국어 표현도 자연스러움 |
| **무료** | Google Gemini | `gemini-2.5-flash` | 무료 한도 넉넉, 한국어 대응 양호 |
| **심층 추론** | DeepSeek | `deepseek-v4-pro` | 복잡한 추론 · 수학 · 코드가 필요한 경우 |

### 음성 입력 (STT)

| 용도 | 추천 제공자 | 추천 모델 | 설명 |
|------|-----------|---------|------|
| **최고 정확도** | OpenAI | `whisper-large-v3` | 업계 표준, 한국어 인식 정확도 최고 수준 |
| **가성비** | OpenAI | `gpt-4o-mini-transcribe` | 다국어 지원, 기존 OpenAI Key로 사용 가능 |
| **고정밀 클라우드** | ElevenLabs Scribe | `scribe_v1` | 99개 언어 지원, 한국어 구두점 · 화자 감지 정확 |
| **로컬 스트리밍** | Paraformer | `paraformer-trilingual` | 말하면서 실시간 변환, 저지연 |
| **로컬 고속** | SenseVoice | `sensevoice-zh-en` | Whisper 대비 15배 빠름, 오프라인 |

### 음성 출력 (TTS)

| 용도 | 추천 제공자 | 보이스 | 설명 |
|------|-----------|--------|------|
| **무료 추천** | Edge TTS | 선히 (`ko-KR-SunHiNeural`) | Microsoft 무료, 자연스러운 한국어 여성 보이스, API Key 불필요 |
| **무료 (남성)** | Edge TTS | 인준 (`ko-KR-InJoonNeural`) | 차분한 한국어 남성 보이스, 무료 |
| **최고 품질** | ElevenLabs | 커스텀 `voice_id` | 세계 최고 수준 음성 합성, 보이스 클론 지원 |
| **클라우드 범용** | OpenAI TTS | `nova` / `alloy` | 기존 OpenAI Key로 사용, `gpt-4o-mini-tts` 모델 |
| **로컬 오프라인** | OmniVoice | 내장 보이스 | 완전 오프라인, 로컬 포트 8000, RTX 3060에서 동작 |

---

## 다운로드 및 설치

### 사전 빌드된 설치 프로그램(권장)

[release 페이지](https://github.com/FanyinLiu/Nexus/releases/latest) 에서 최신 설치 프로그램을 다운로드하세요:

> 아래 표는 v0.4.3 정식 릴리스 계약입니다. 설치 파일은 보호된 tag 워크플로가 GitHub Releases에 성공적으로 게시한 실제 아티팩트만 기준으로 하며, 로컬 또는 제3자 재배포 패키지는 사용하지 마세요.

| 플랫폼 | 파일 |
|---|---|
| Windows x64 | `Nexus-Setup-<버전>.exe`(NSIS, `NotSigned`) + `SHA256SUMS-windows.txt` |
| macOS arm64 | `.dmg` 또는 `.zip`(ad-hoc, x64 / universal 없음) + `SHA256SUMS-macos.txt` |
| Linux x64 | `.AppImage` / `.deb` / `.tar.gz` + `SHA256SUMS-linux.txt` |

> **첫 실행 시 보안 경고가 표시되며, 이는 정상입니다.**
> Nexus v0.4.3은 Apple Developer ID / notarization 또는 Windows
> 코드 서명을 사용하지 않습니다. macOS의 ad-hoc 서명은 Apple의
> 신뢰를 뜻하지 않으며 Windows 설치 프로그램은 `NotSigned`로 표시됩니다.
> 시스템 경고는 안전 결론이 아니므로 배포 출처와 SHA-256을 확인하세요.

#### 미서명 설치 안내

- **다운로드 출처**: 공식 [GitHub Releases](https://github.com/FanyinLiu/Nexus/releases/latest) 가 유일한 다운로드 출처입니다. 미러 사이트나 재배포된 압축 파일에서 설치하지 마세요. 출처가 확실하지 않다면 파일을 삭제하고 GitHub Releases 에서 다시 다운로드하세요.
- **macOS / Gatekeeper**: 첫 실행이 차단되면 아래 macOS 절차에 따라 우클릭으로 열거나 `xattr -dr com.apple.quarantine /Applications/Nexus.app` 를 실행하세요.
- **Windows / SmartScreen**: **"Windows에서 PC를 보호했습니다"** 가 표시되면 **"추가 정보"** 를 클릭한 다음 **"실행"** 을 클릭하세요.

#### macOS 첫 실행

1. `.dmg` 를 열고 `Nexus.app` 을 `/Applications` 로 드래그합니다.
2. Gatekeeper 격리 속성을 제거 — "터미널"을 열어 실행:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Nexus.app
   ```
   (또는: Nexus.app 을 우클릭 → 열기 → 대화상자에서 확인.)
3. Nexus 를 실행합니다. 처음 실행 시 **"로컬 음성 모델 설치"**
   마법사가 표시됩니다. **"원클릭 다운로드"** 를 클릭해 ~280 MB 의
   sherpa-onnx + VAD 모델을
   `~/Library/Application Support/Nexus/sherpa-models` 로
   다운로드합니다. 마법사는 닫을 수 있고, 나중에 설정에서 다시 열 수 있습니다.
4. Python 기반 옵션(OmniVoice TTS / GLM-ASR)은 자동으로 감지됩니다.
   Python + `requirements.txt` 가 설치되어 있지 않으면 조용히
   건너뜁니다 — 핵심 채팅 + SenseVoice STT + Edge TTS 스택은
   여전히 동작합니다.

#### Windows 첫 실행

1. `Nexus-Setup-<버전>.exe` 를 실행합니다.
2. SmartScreen 이 **"Windows에서 PC를 보호했습니다"** 를 표시합니다.
3. 경고 아래의 작은 글씨 **"추가 정보"** 를 클릭한 다음, **"실행"** 을 클릭합니다.
4. NSIS 설치 마법사를 평소대로 진행하세요. 첫 실행 시 macOS 와 마찬가지로 로컬 음성 모델 마법사가 표시됩니다.

#### Linux 첫 실행

- **AppImage**: `chmod +x Nexus-<버전>.AppImage` 후 더블클릭하거나 터미널에서 실행. Linux 배포판은 macOS / Windows 처럼 앱 수준 서명을 강제하지 않으므로 경고가 없습니다.
- **.deb**: `sudo dpkg -i Nexus-<버전>.deb` (또는 배포판의 패키지 매니저로 열기).
- **다운로드 검증**: Linux x64 아티팩트에는 `SHA256SUMS-linux.txt`가 포함됩니다. 패키지 형식 하나만 내려받았다면 다운로드 디렉터리에서 `sha256sum --ignore-missing -c SHA256SUMS-linux.txt`를 실행하고 대상 파일이 `OK`인지 확인하세요. 체크섬 파일도 같은 공식 release에서 받아야 합니다.

#### macOS unsigned auto-update limitation

macOS arm64 미서명 빌드는 새 버전을 확인하고 공식 release 페이지만 엽니다. 앱을 자동으로 내려받거나 교체하지 않습니다. 업데이트할 때 새 `.dmg` / `.zip`을 수동으로 내려받고 Gatekeeper 확인 후 `/Applications/Nexus.app`을 교체해야 합니다.

#### Windows unsigned installer limitation

Windows x64 설치 프로그램은 `NotSigned`이며 게시자 신원 확인이나 안정적인 SmartScreen 평판을 제공하지 못합니다. 공식 GitHub Releases에서 받은 파일인지 확인한 뒤 위 SmartScreen 절차로 수동 실행하세요.

---

## 빠른 시작

> 이 섹션은 개발자가 소스 코드에서 실행하는 방법입니다. 일반 사용자는 위의 "다운로드 및 설치"를 참조하세요.

**요구 사항**: Node.js 22+ · npm 10+

```bash
git clone https://github.com/FanyinLiu/Nexus.git
cd Nexus
npm install
npm run electron:dev
```

빌드 및 패키징:

```bash
npm run build
npm run package:win     # 또는 package:mac / package:linux
```

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 런타임 | Electron 41 |
| 프론트엔드 | React 19 · TypeScript · Vite 8 |
| 캐릭터 렌더링 | PixiJS · pixi-live2d-display |
| 로컬 ML | sherpa-onnx-node · onnxruntime-web · @huggingface/transformers |
| 패키징 | electron-builder |

---

## 로드맵

### 예정

- [ ] **화면 인식 능동 대화** — 화면 컨텍스트(포그라운드 앱, 표시된 텍스트)를 주기적으로 읽어 사용자가 하고 있는 작업에 관한 대화를 먼저 시작합니다. 말을 걸어야만 반응하는 것이 아닙니다.
- [ ] **의도 / 역할 / 허용된 도움 분리** — 가벼운 의도 판단, 캐릭터 표현, 사용자가 확인한 뒤의 보조 행동을 분리합니다. 역할 계층은 도구 메타데이터를 전혀 보지 않으며, 결과는 동반자가 자기 목소리로 "전달"합니다.
- [ ] **캐릭터 일기 & 자율 타임라인** — 동반자가 매일 1인칭 일기를 자동 생성하여 그날 있었던 일을 기록. 선택적으로 열람 가능한 피드에 "일상"을 게시하여 독립적인 삶의 느낌을 연출합니다.
- [ ] **일과 스케줄 & 활동 상태** — 동반자가 일과(일 / 식사 / 수면 / 출근)를 따르며 가용성, 톤, 에너지에 영향. 심야 대화와 아침 대화의 분위기가 달라집니다.
- [ ] **미니 모드 / 도크 가장자리 숨기기** — 펫을 화면 가장자리로 드래그하면 자동으로 숨고, 호버 시 쏙 얼굴을 내미는 애니메이션. "항상 곁에 있지만 방해하지 않습니다."
- [ ] **웹캠 인식** — MediaPipe 페이스 메시로 피로 신호(하품, 눈 감기, 찡그림)를 감지하고 동반자의 컨텍스트에 주입하여 능동적으로 반응합니다.

### 계속 진행

- [ ] Pipecat 스타일 프레임 파이프라인으로 모놀리식 스트리밍 TTS 컨트롤러 교체 (Phase 2-6; Phase 1은 v0.2.4에서 출시).
- [ ] electron-updater + 서명된 바이너리로 자동 업데이트.
- [ ] 모바일 동반자 앱 (데스크톱 인스턴스의 음성 전용 리모컨).

---

## 커뮤니티

Nexus는 개인 유지 프로젝트로, issue와 PR 처리 속도는 정확한 분류에 달려 있습니다:

커뮤니티 문서는 특정 릴리스 하나에만 속하지 않고 모든 버전을 관통하는 입구입니다. 0.3은 안전, 기억, 설정 기반을 마무리하고, 0.4는 데스크톱 동반자 인식으로 들어가며, 0.5는 데스크톱 펫 행동으로 이어집니다. 장기 입구는 [Community Guide](COMMUNITY.md), 0.4 방향은 [v0.4 Desktop Companion Awareness](V0.4_DESKTOP_COMPANION_AWARENESS.md), 0.4 현재 안정 버전 설명은 [v0.4.3 Release Notes](RELEASE-NOTES-v0.4.3.md), 릴리스 hardening은 [v0.4 Release Hardening](RELEASE-CANDIDATE-v0.4-HARDENING.md)입니다.

- 🐛 **버그를 발견했나요?** → [버그 신고](https://github.com/FanyinLiu/Nexus/issues/new?template=bug_report.yml)
- 💡 **명확한 기능 아이디어?** → [기능 요청](https://github.com/FanyinLiu/Nexus/issues/new?template=feature_request.yml)
- 🧠 **더 큰 아이디어?** → 먼저 [Ideas 토론](https://github.com/FanyinLiu/Nexus/discussions/categories/ideas)에서 다른 사람들의 의견을 들어보세요
- ❓ **설치나 사용에 문제가 있나요?** → [Q&A](https://github.com/FanyinLiu/Nexus/discussions/categories/q-a)
- 🎨 **사용 방법을 공유하고 싶나요?** → [Show and tell](https://github.com/FanyinLiu/Nexus/discussions/categories/show-and-tell)
- 💬 **그냥 수다?** → [General](https://github.com/FanyinLiu/Nexus/discussions/categories/general)
- 📣 **릴리스 노트 및 로드맵 업데이트** → [Announcements](https://github.com/FanyinLiu/Nexus/discussions/categories/announcements)

---

## 기여하기

모든 형태의 기여를 환영합니다 — 버그 수정, 새 제공자, UI 개선, 번역, Live2D 모델, 새로운 자율 행동. 한 줄짜리 issue나 오타 수정 PR도 프로젝트를 앞으로 나아가게 합니다.

빠른 시작:

- [**기여 가이드**](../CONTRIBUTING.md)에서 개발 환경, 프로젝트 구조, 코드 스타일, PR 워크플로우를 확인하세요.
- [issue 템플릿](https://github.com/FanyinLiu/Nexus/issues/new/choose)으로 버그와 기능 요청을 제출하세요 — 통일된 형식으로 빠르게 분류할 수 있습니다.
- 푸시 전에 `npm run verify:release`(lint + 테스트 + 빌드)를 실행하세요 — CI와 동일한 체크입니다.
- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/)를 따르세요: `feat:`, `fix:`, `docs:`, `refactor:` 등.
- PR당 하나의 논리적 변경만. 관련 없는 수정은 별도의 PR로 분리하세요.

모든 참여는 [행동 강령](../CODE_OF_CONDUCT.md)을 따릅니다 — 요약: **친절하게, 선의를 가정하고, 일에 집중**.

### 보안 문제

보안 취약점을 발견한 경우 공개 issue를 만들지 **마세요**. 대신 [비공개 보안 자문](https://github.com/FanyinLiu/Nexus/security/advisories/new)을 통해 신고해 주세요.

---

## 안전 및 지원

Nexus는 AI 동반자이며 임상 도구가 아닙니다. 이 저장소에는 미국 캘리포니아 **SB 243**(2026-01-01 시행), 뉴욕주 동반 AI 안전법, 그리고 **EU AI Act**의 중대 사고 보고 조항(2026-08)을 충족하는 작은 안전 계층이 포함되어 있어요.

**이 계층이 하는 일:**

- **첫 실행 동의 화면** — 온보딩 0단계는 "AI와 대화하고 있으며, 사람이 아니에요; 임상 상담이 아니에요"라고 표시하는 읽기 전용 화면이고, 확인 후에 동반자 설정으로 들어가요. 클릭 시간은 감사 기록을 위해 `localStorage`에 저장돼요.
- **대화 중 주기적 리마인더** — "마지막 리마인더 이후 ≥30개 사용자 메시지 **그리고** ≥3시간 벽시계 시간 경과"의 두 조건이 모두 충족되면, AI와 대화 중임을 알려주는 한 줄짜리 시스템 메시지가 채팅에 추가돼요. 두 게이트로 짧은 폭발과 긴 저빈도 모두 과도하게 발동되지 않도록 해요.
- **위기 발화 감지** — 사용자가 로케일별 위기 패턴("죽고 싶다", "I want to kill myself", "死にたい" 등)과 일치하는 내용을 입력하면, 페르소나가 아닌 별도 패널이 대화 위로 슬라이드되어 사람의 도움 라인을 표시해요:
  - **109**(ko) 보건복지부 통합 자살예방 라인(2024+), 24/7
  - **988**(en-US) 미국 자살·위기 라이프라인, 24/7 통화/문자
  - **12356** + **800-810-1117**(zh-CN) 국가 통합 라인(2025+) + 베이징 24h
  - **1925**(zh-TW) 衛生福利部 安心專線, 24/7
  - **0120-279-338**(ja) よりそいホットライン, 24/7 무료
- **페르소나 톤 조정** — 패널을 발동시킨 그 턴의 답변은 일회성 시스템 프롬프트 단편을 통해 캐릭터를 유지하면서도 감정을 validate하고, 농담 금지·수단 논의 금지, 짧은 답변, 패널에 대한 부드러운 언급으로 전환돼요.

**이 계층이 하지 않는 일:**

- **위기 이벤트는 기기 외부로 전송되지 않아요.** 감지는 로컬에서 실행되고, 패널은 로컬에서 렌더링되며, "누가 무엇을 말했는지"에 대한 어떤 텔레메트리도 어떤 서버로도 전송되지 않아요.
- 연령 확인 없음, 프로필 조회 없음, 제3자 데이터 호출 없음.

**코드를 독립적으로 검증할 수 있는 곳:**

| 모듈 | 파일 |
|---|---|
| 감지 패턴 + 로케일별 부정 사전 | `src/features/safety/crisisDetect.ts` |
| 핫라인 카탈로그(각 항목에 `sourceUrl`) | `src/features/safety/hotlines.ts` |
| 핫라인 패널 UI | `src/features/safety/CrisisHotlinePanel.tsx` |
| 페르소나 톤 주입 | `src/features/safety/crisisGuidance.ts` |
| 동의 + 주기적 리마인더 영속화 | `src/features/safety/disclosureState.ts` 등 |
| 테스트 | `tests/safety-*.test.ts` |

각 핫라인 번호는 모든 릴리스 전에 권위 있는 출처(보건복지부 / WHO / IASP / 각국 보건당국)에 대해 재확인돼요. 잘못된 번호는 위기에 처한 사람을 죽은 라인으로 보내는 것이라서 — 다른 문서보다 더 높은 기준으로 운영해요.

---

## Star 추이

<a href="https://star-history.com/#FanyinLiu/Nexus&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=FanyinLiu/Nexus&type=Date" />
 </picture>
</a>

---

## 라이선스

[MIT](../LICENSE)
