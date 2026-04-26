<p align="center"><img src="../public/banner.png" alt="Nexus" width="720" /></p>

<h1 align="center">Nexus</h1>

<h3 align="center">당신의 바탕화면에 사는 AI 동반자 — 기억하고, 꿈꾸고, 함께합니다.</h3>

<p align="center">
  <a href="https://github.com/FanyinLiu/Nexus/releases/latest"><img src="https://img.shields.io/github/v/release/FanyinLiu/Nexus?style=flat-square&color=blue" alt="Release"></a>
  <a href="https://github.com/FanyinLiu/Nexus/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FanyinLiu/Nexus?style=flat-square" alt="License"></a>
  <a href="https://github.com/FanyinLiu/Nexus/stargazers"><img src="https://img.shields.io/github/stars/FanyinLiu/Nexus?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/FanyinLiu/Nexus"><img src="https://img.shields.io/github/last-commit/FanyinLiu/Nexus?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b>
</p>

---

> **참고**: Nexus는 활발히 개발 중입니다. 일부 기능은 안정화되었고, 일부는 아직 다듬는 중입니다. 피드백과 기여를 환영합니다!

## Nexus란?

Nexus는 LLM 기반의 크로스 플랫폼 데스크톱 AI 동반자입니다. Live2D 캐릭터를 **연속 음성 대화**, **장기 기억**, **데스크톱 인지**, **자율 행동**, **MCP 스타일 툴 호출**과 결합 — 챗봇이 아니라 진짜로 당신을 알게 되는 존재를 목표로 설계되었습니다.

Electron + React + TypeScript로 구축, Windows / macOS / Linux 지원. 18+ LLM 제공자를 내장하며 완전 오프라인 또는 클라우드 모델로 동작합니다.

---

## 주요 기능

- 🎙️ **상시 웨이크 워드** — 버튼 없이 이름을 부르면 대화 시작. sherpa-onnx 키워드 검출기가 메인 프로세스의 Silero VAD와 하나의 마이크 스트림을 공유하며 동작합니다. 30ms ACK 간격, 500ms 쿨다운.

- 🗣️ **연속 음성 대화** — 자동 페일오버를 지원하는 멀티 엔진 STT / TTS, 문장 단위 즉시 스트리밍 TTS(첫 쉼표에서 바로 재생 시작), 에코 캔슬된 자기 가로채기로 동반자가 자기 목소리에 반응해 깨어나지 않음.

- 🧠 **꿈꾸는 기억** — 핫 / 웜 / 콜드 3단계 구조에 BM25 + 벡터 하이브리드 검색. 야간 꿈 사이클이 대화를 *내러티브 스레드*로 클러스터링하여, 세션마다 리셋되는 대신 시간이 지날수록 당신에 대한 이해가 쌓여 갑니다.

- 💝 **감정 메모리 + 관계 아크 (v0.2.9)** — 동반자가 이별 시의 *감정 톤*을 기억하여, 말한 내용뿐 아니라 감정까지 기억합니다. 5단계 관계 진화(낯선 사람 → 아는 사이 → 친구 → 가까운 친구 → 친밀)가 톤, 어휘, 행동 경계에 영향. 메모리가 페르소나별 `memory.md` 파일에 영속화되어, 페르소나 전환 시 관계 컨텍스트가 유실되지 않습니다.

- 🎭 **캐릭터 카드 + VTube Studio 브리지 (v0.2.9)** — Character Card v2/v3 포맷 임포트(chub.ai / characterhub 호환). VTube Studio WebSocket 플러그인 API로 외부 Live2D 모델을 구동하면서 Nexus의 기억 / 자율 행동 스택은 유지.

- 🌤️ **살아 있는 장면 (v0.2.9)** — 14단계 날씨 상태, 24시간 연속 햇빛 필터, 15장의 AI 생성 낮/황혼/밤 장면 변형. 분위기 있는 깊이감, 정적인 배경화면이 아닙니다.

- 🤖 **자율적 내면 생활 (V2)** — tick마다 한 번의 LLM 판단 호출, 계층적 스냅샷(감정 · 관계 · 리듬 · 데스크톱 · 최근 대화) 입력, 페르소나 가드레일을 통과한 출력. 템플릿 같은 발화는 더 이상 없고 — 캐릭터의 목소리로 말하거나, 침묵을 선택할 수 있으며 — v0.2.7부터 백그라운드 조사 서브에이전트를 파견할 수도 있습니다.

- 🧰 **서브에이전트 디스패처 (v0.2.7)** — 동반자가 뒤에서 제한된 조사 루프(Web 검색 / MCP 툴)를 실행하고 요약을 다음 응답에 엮어 넣을 수 있습니다. 동시 실행 수 + 일일 예산으로 제어; 옵트인, `설정`에서 활성화.

- 🔧 **내장 툴** — 웹 검색, 날씨, 알림. 네이티브 함수 호출과 `tools`를 지원하지 않는 모델용 프롬프트 모드 폴백 **모두** 작동.

- 🔄 **제공자 페일오버** — 여러 LLM / STT / TTS 제공자를 체이닝. 하나가 다운되면 Nexus는 대화를 끊지 않고 다음으로 전환합니다.

- 🖥️ **데스크톱 인지** — 포그라운드 창 제목, 클립보드, (선택적으로) 화면 OCR. 컨텍스트 트리거를 통해 사용자의 실제 작업에 반응합니다.

- 🔔 **알림 브리지** — 로컬 웹훅 서버 + RSS 폴링 — 외부 알림을 동반자와의 대화에 밀어 넣습니다.

- 💬 **폰에서도 연결** — Discord와 Telegram 게이트웨이, 채팅별 라우팅 지원. 휴대폰에서 동반자와 대화하고 음성으로 응답받기.

- 🌐 **다국어 UI** — 간체 중국어, 번체 중국어, 영어, 일본어, 한국어.

---

## 이번 업데이트 — v0.3.1-beta.3(사전 출시)

> **버그 수정 patch(새 기능 없음).** 주요 수정: dmg/exe 사용자의 Live2D 펫(CSP에 `unsafe-eval` 누락으로 pixi.js 렌더링 실패 — P0); thinking-mode 모델 다중 턴 대화(DeepSeek-R1 / QwQ / Hunyuan-thinking의 reasoning_content 전 경로 보존 + 이전 히스토리 폴백); TTS 재생 후 voiceState가 `speaking`에서 멈추는 3중 세이프티 넷; 멀티모달 이미지가 다음 턴에서 사라지는 문제; in-app 진단 패널의 자동 console 캡처 + dev 모드의 `.dev/runtime.log` tail. 자세한 내용은 [RELEASE-NOTES-v0.3.1-beta.3.md](RELEASE-NOTES-v0.3.1-beta.3.md)(영어)를 참조하세요.

---

## 현재 안정 버전 — v0.3.0

> **안정 버전 출시.** v0.2.9 → v0.3.0 누적 100+ commit, 약 12,000 라인 변경,
> +361 유닛 테스트. 모든 변경은 하위 호환 — 기존 데이터는 자동 마이그레이션됩니다.
> 개발자 관점의 상세 내용은
> [RELEASE-NOTES-v0.3.0.md](RELEASE-NOTES-v0.3.0.md)(영어)를 참조하세요.

| 테마 | 내용 |
|---|---|
| **🧠 메모리가 일한다** | 중요도 가중 리콜; dream cycle이 1–3개의 짧은 통찰 생성; callback 큐(다음 대화에서 과거 기억을 부드럽게 꺼냄); 30 / 100 / 365일 기념일 마일스톤. |
| **💝 관계에 형태가 있다** | 기분 인지 리콜(3 모드); 5단계 마일스톤 첫 통과 발화; 4개 서브 차원; 풍부한 재회 프레이밍. |
| **🤝 관계에 유형이 있다** | onboarding과 설정에서 *오픈 / 친구 / 멘토 / 조용한 동반자* 선택 — `SOUL.md`를 덮지 않고 한 줄로 system prompt를 바이어스. |
| **💭 "생각하고 있어" 알림** | 한참 대화가 없으면 설정한 관계 유형에 맞춰 OS 알림 발송. 23–08시는 조용 시간으로 강제 차단. |
| **🎬 모서리에서의 존재감** | autonomy V2의 4번째 액션(`idle_motion` 무음 제스처); 동적 cadence; 초반 응답에서의 호기심 질문. |
| **🌅 부드러운 장면 전환** | 5–7시 / 16–18시 / 19–21시에 2시간 전환 창, smoothstep 이징; 색 대비 강화 — 새벽 핑크, 골든 아워 깊은 앰버, 심야는 차갑게 채도 낮은 파랑. |
| **🪟 Liquid Glass UI** | 보라색 액센트 리스킨; 툴바 정리; 시간 인지 이모지 인사; 창 크기 / 위치 실행 간 영구화. |
| **🌤️ 더 정확한 날씨** | 시간별 예보, 체감 온도 + 습도, 모레 예보. |
| **🧹 엔지니어링 정리** | i18n.ts 1842 → 588 라인; 공유 SettingsField 컴포넌트; 정규식 컴파일 캐시; async-lock 중복 제거; 인스톨러 약 30–60 MB 슬림화. |

<details>
<summary>이번 안정 버전에 접힌 베타 라인</summary>

베타 라인이 기반을 만들고, 안정 버전에서 마무리:

- **v0.3.0-beta.1** —— 관계 시스템의 3개 독립 축: 기분 인지 리콜(VAD 투영 + 공감 / 복구 / 강화 모드), 일회성 레벨업 지시, 4개 서브 차원. [Notes](RELEASE-NOTES-v0.3.0-beta.1.md)
- **v0.3.0-beta.2** —— 안정 + 리텐션 패스: 중요도 가중 메모리, dream-cycle reflection, callback queue, 기념일 마일스톤, idle motion, 동적 cadence, Liquid Glass UI, 날씨 정밀도, 트레이 + dock 아이콘, 7개 보안 수정. [Notes](RELEASE-NOTES-v0.3.0-beta.2.md)

</details>

---

## 지난 업데이트 — v0.2.9

> 감정 메모리와 관계 진화가 헤드라인 — 동반자가 관계의 발전을 추적하고 각 대화의 감정적 맥락을 기억하게 되었습니다. 날씨 & 장면 시스템을 처음부터 재구축(14가지 날씨 상태 + AI 생성 장면). 캐릭터 카드 임포트, VTube Studio 브리지, 완전한 5개 언어 i18n.
>
> 이 섹션은 **릴리스마다 새 버전의 내용으로 교체됩니다**. 이전 내용은 [Releases](https://github.com/FanyinLiu/Nexus/releases)에서 확인하세요.

### 🧠 감정 메모리 & 관계 진화 — 헤드라인

동반자가 세션을 넘어 감정적 맥락을 이어갑니다. 지난번 따뜻하게 헤어졌다면 따뜻하게 맞이하고, 피곤했다면 상태를 걱정합니다. 5단계 관계 스테이지 — 낯선 사람 → 지인 → 친구 → 절친 → 친밀 — 이 동반자의 어조, 말투, 행동 경계에 영향을 줍니다. 진행은 암묵적이며, 축적된 상호작용에 의해 구동되고, 눈에 보이는 미터는 없습니다.

부재 인식: 동반자는 당신이 얼마나 떠나 있었는지 알아챕니다. 짧은 부재에는 부드러운 환영을, 긴 부재에는 진심 어린 호기심("어디 갔었어?")을 보입니다. 대화 기억은 페르소나별 `memory.md` 파일에 영속화되어 세션 간에 유실되지 않습니다.

### 🌦️ 날씨 & 장면 시스템 재구축

기존 날씨 위젯을 완전한 대기 시스템으로 교체했습니다:

- **14가지 강도 등급 날씨 상태**, 풀 씬 시각 효과 포함 — 하늘 색조, 고밀도 파티클 레이어, 빛나는 비와 눈.
- **연속 햇빛 시스템**, 밝기 / 채도 / 색상 필터 적용. 진짜 밤, 세밀한 낮 단계 — 단순한 "낮"과 "밤"이 아닙니다.
- **15장의 AI 생성 애니메 장면**(5개 장소 × 낮 / 황혼 / 밤), 시각적 일관성을 위해 수동 프롬프트.
- **14 상태 펫 시간 미리보기**, 현재 시각에 고정하여 각 날씨 외관 확인 가능.
- **다국어 날씨 위치 파싱**, Nominatim 지오코딩 지원 — 어떤 언어로든 도시명 입력 가능.

### 📇 캐릭터 카드 임포트

Character Card v2 / v3 포맷(PNG 내장 + JSON) 임포트 지원 — chub.ai, characterhub 등 커뮤니티 카드와 호환. 설정 → 캐릭터에서 `.png` 카드 파일을 드롭하면 페르소나 정보가 자동으로 채워집니다.

### 🎭 VTube Studio 브리지

VTube Studio를 통해 외부 Live2D 모델을 구동하는 WebSocket 브리지. 동반자의 감정 상태가 VTS 모델의 표정과 모션에 실시간 동기화됩니다.

### 🌐 완전한 i18n

모든 UI 서페이스가 5개 언어(EN / ZH-CN / ZH-TW / JA / KO)의 완전한 번역을 지원: 설정, 채팅, 온보딩, 음성 스택, 시스템 프롬프트, 에러 메시지, 데이터 레지스트리. 설정에 지구본 아이콘 + 팝오버 언어 전환기.

### 🐾 펫 시스템 강화

- **인라인 표정 오버라이드**: 동반자가 응답에 `[expr:name]` 태그를 써서 발화 중간에 특정 Live2D 표정을 트리거.
- **탭 존 반응 풀 확장** — 캐릭터를 톡톡 쳤을 때 더 다양한 반응.
- **모델별 가중치 아이들 피젯** — 캐릭터마다 다른 느낌의 대기 애니메이션.
- **마우스 드래그 리사이즈** — 펫 캐릭터 창 크기 조절.
- **13가지 세분화된 펫 무드 상태** — 표정 선택을 구동.

### 🔧 기타 개선 및 버그 수정

- Lorebook 시맨틱 하이브리드 검색(키워드 매칭 위에 벡터 검색 추가).
- LLM 응답에 대한 사용자 설정 가능 정규식 변환.
- 온보딩 음성 단계에 로컬 음성 모델 헬스 스트립 추가.
- Sherpa 모델을 Mac + Linux 인스톨러에 번들.
- 크로스 윈도우 BroadcastChannel 동기화 저장 루프 및 메시지 덮어쓰기 수정.
- 런타임 상태 브리지 셀프 피딩 렌더 스톰 수정.
- TTS 타임아웃 렌더 스톰 수정.
- 웨이크 워드의 일시적 디바이스 에러가 영구적으로 취급되는 문제 수정.
- Autonomy V1 코드 삭제(Phase 6 클린업).

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
| **일상 동반자 (추천)** | DeepSeek | `deepseek-chat` | 가성비 최고, 한국어 대응 양호, 장시간 대화에 최적 |
| **종합 최강** | Anthropic | `claude-sonnet-4-6` | 한국어 자연스러움과 툴 호출 안정성 최고 |
| **가성비** | OpenAI | `gpt-5.4-mini` | 빠르고 저렴, 한국어 표현도 자연스러움 |
| **무료** | Google Gemini | `gemini-2.5-flash` | 무료 한도 넉넉, 한국어 대응 양호 |
| **심층 추론** | DeepSeek | `deepseek-reasoner` | 복잡한 추론 · 수학 · 코드가 필요한 경우 |

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

## 빠른 시작

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
- [ ] **Decision / Roleplay / Agent 3계층 분리** — 의도 분류(빠름), 롤플레이(페르소나 순수), 백그라운드 Agent 작업을 분리. 롤플레이 계층은 도구 메타데이터를 전혀 보지 않으며, Agent 결과는 캐릭터가 자기 목소리로 "전달"합니다.
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
