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

Electron + React + TypeScript로 만든 로컬 우선 앱입니다. Windows / macOS / Linux 지원. 음성 프레임, 기억 항목, 툴 호출은 모두 사용자 컴퓨터에서 실행되며 — 컴퓨터를 떠나는 것은 LLM 호출뿐, 제공자도 사용자가 선택합니다. 18+ 채팅 제공자를 자유롭게 조합할 수 있고, 로컬 모델 + 로컬 ASR + 로컬 TTS로 완전히 오프라인 실행도 가능합니다.

설계 목표는 단순한 채팅이 아닌 **관계의 지속**입니다. 야간 **꿈 사이클(dream cycle)**이 대화를 *내러티브 스레드*로 클러스터링하여 시스템 프롬프트에 되먹임되므로, 동반자가 "당신이 누구인지"에 대해 갖는 감각은 세션마다 리셋되지 않고 시간이 지날수록 축적됩니다.

---

## 주요 기능

- 🎙️ **상시 웨이크 워드** — 버튼 없이 이름을 부르면 대화 시작. sherpa-onnx 키워드 검출기가 메인 프로세스의 Silero VAD와 하나의 마이크 스트림을 공유하며 동작합니다. 30ms ACK 간격, 500ms 쿨다운.

- 🗣️ **연속 음성 대화** — 자동 페일오버를 지원하는 멀티 엔진 STT / TTS, 문장 단위 즉시 스트리밍 TTS(첫 쉼표에서 바로 재생 시작), 에코 캔슬된 자기 가로채기로 동반자가 자기 목소리에 반응해 깨어나지 않음.

- 🧠 **꿈꾸는 기억** — 핫 / 웜 / 콜드 3단계 구조에 BM25 + 벡터 하이브리드 검색. 야간 꿈 사이클이 대화를 *내러티브 스레드*로 클러스터링하여, 세션마다 리셋되는 대신 시간이 지날수록 당신에 대한 이해가 쌓여 갑니다.

- 🤖 **자율적 내면 생활 (V2)** — tick마다 한 번의 LLM 판단 호출, 계층적 스냅샷(감정 · 관계 · 리듬 · 데스크톱 · 최근 대화) 입력, 페르소나 가드레일을 통과한 출력. 템플릿 같은 발화는 더 이상 없고 — 캐릭터의 목소리로 말하거나, 침묵을 선택할 수 있으며 — v0.2.7부터는 도움이 될 경우 백그라운드 조사 서브에이전트를 파견할 수도 있습니다.

- 🧰 **서브에이전트 디스패처 (v0.2.7)** — 동반자가 뒤에서 제한된 조사 루프(Web 검색 / MCP 툴)를 실행하고 요약을 다음 응답에 엮어 넣을 수 있습니다. 동시 실행 수 + 일일 예산으로 제어; 옵트인, `설정`에서 활성화. 자세한 내용은 [이번 업데이트](#이번-업데이트--v027)를 참조하세요.

- 🔧 **내장 툴** — 웹 검색, 날씨, 알림. 네이티브 함수 호출과 `tools`를 지원하지 않는 모델용 프롬프트 모드 폴백 **모두** 작동.

- 🔄 **제공자 페일오버** — 여러 LLM / STT / TTS 제공자를 체이닝. 하나가 다운되면 Nexus는 대화를 끊지 않고 다음으로 전환합니다.

- 🖥️ **데스크톱 인지** — 포그라운드 창 제목, 클립보드, (선택적으로) 화면 OCR. 컨텍스트 트리거를 통해 사용자의 실제 작업에 반응합니다.

- 🔔 **알림 브리지** — 로컬 웹훅 서버 + RSS 폴링 — 외부 알림을 동반자와의 대화에 밀어 넣습니다.

- 💬 **폰에서도 연결** — Discord와 Telegram 게이트웨이, 채팅별 라우팅 지원. 휴대폰에서 동반자와 대화하고 음성으로 응답받기.

- 🌐 **다국어 UI** — 간체 중국어, 번체 중국어, 영어, 일본어, 한국어.

- 💰 **비용 인지** — 내장 예산 계측 + Anthropic 프롬프트 캐싱(시스템 + 툴 prefix에 와이어링, 긴 세션에서 입력 토큰 30-50% 감소).

---

## 이번 업데이트 — v0.2.7

> 서브에이전트 디스패처가 헤드라인; 바지인(barge-in) 모니터를 강화해 어떤 TTS 응답이든 중간에 끊을 수 있게 되었고(음성 *또는* 타이핑 모두); 장시간 STT 발화 이후 두 번째 턴이 멈추던 렌더 스톰 버그와, 열려 있는 채팅 패널에 음성 메시지가 보이지 않던 동일 원인의 창 간 동기화 버그를 수정했습니다.
>
> 이 섹션은 **릴리스마다 새 버전의 내용으로 교체됩니다**. 이전 내용은 [Releases](https://github.com/FanyinLiu/Nexus/releases)에서 확인하세요.

### 🧰 서브에이전트 디스패처 — 헤드라인

> **한 줄 요약** — 동반자가 유의미하게 도움이 되는 작업(웹 조회, 문서 읽기, 사실 확인)에 대해 제한된 백그라운드 조사 에이전트를 생성할 수 있게 되었습니다. 진입점은 두 가지: 자율 엔진이 `speak` 대신 `spawn`을 선택하거나, 채팅 LLM이 턴 중간에 `spawn_subagent` 툴을 호출합니다. 상태는 채팅 메시지 리스트 상단에 실시간 칩으로 표시되며, 요약은 동반자의 응답에 엮여 들어갑니다. 기본 비활성화 — 사용자별 옵트인.

활성화 방법:

```
설정 → Subagents → Enable
  maxConcurrent:    1–3 (하드 캡 3)
  perTaskBudgetUsd: 작업당 소프트 캡
  dailyBudgetUsd:   오늘 모든 작업 합계 소프트 캡
  modelOverride:    선택 — 조사를 더 저렴한 티어로
```

3단계 모델 폴백: `subagentSettings.modelOverride → autonomyModelV2 → settings.model`. 메인 채팅은 그대로 두고 조사는 작고 빠른 모델(Haiku / Flash / 저렴한 OpenRouter 엔트리)로 분리할 수 있습니다.

결정 엔진 통합: 자율 프롬프트는 tick마다 라이브 `subagentAvailability`(활성화 + 현재 용량 + 남은 일일 예산)를 확인하고, 게이트가 실제로 열려 있을 때만 `spawn` 액션을 공개합니다. LLM이 `spawn`을 선택하면 오케스트레이터가 짧은 선행 멘트("찾아볼게요")를 기존 TTS 경로로 발화하면서 **동시에** 조사 루프를 시작할 수 있습니다 — 작업 개시 전 직렬 지연이 없습니다.

채팅 툴 통합: 서브에이전트가 활성화되면 `spawn_subagent`가 LLM의 툴 리스트에 추가됩니다. 툴 호출은 조사 턴(보통 10-30초) 동안 블로킹되며 요약을 반환하고, 메인 LLM이 이를 응답에 엮습니다. 사용자는 그 동안 계속 라이브 스트립을 보고 있으므로 대기가 침묵이 아닙니다.

UI: `SubagentTaskStrip`이 채팅 리스트 상단에 글라스모피즘 스타일의 얇은 칩으로 대기 중 / 실행 중 작업을 렌더링하며, 펄싱 인디케이터 도트가 붙습니다. 완료된 작업은 여기에 나타나지 않고 — 요약은 일반 채팅 버블로 도착합니다. 실패 작업은 사유를 확인할 수 있도록 60초간 유지됩니다.

소스: `src/features/autonomy/subagents/`(`subagentRuntime.ts` 상태 머신, `subagentDispatcher.ts` LLM 루프, `spawnSubagentTool.ts` + `dispatcherRegistry.ts` 채팅 브리지, `src/components/SubagentTaskStrip.tsx` UI). 런타임 상태 머신(admission, budget, concurrency, onChange)을 커버하는 단위 테스트 6개 포함.

### 🎙️ 어디서든 바지인(barge-in)

이전: 음성 가로채기 모니터는 현재 턴이 연속 음성 세션에서 시작된 경우에만 아밍되었습니다. 타이핑 기반 응답은 가로챌 수 없었는데 — 사용자가 동반자에게 *말할* 수 있다면, *말하는 도중에도* 끼어들 수 있어야 자연스럽습니다.

- 모니터는 `voiceInterruptionEnabled`가 켜져 있으면 모든 TTS 재생에서 아밍되며, 더 이상 음성 유래 턴에만 국한되지 않습니다.
- 웨이크 워드 리스너가 이미 실행 중인 경우, 모니터는 두 번째 `getUserMedia`를 여는 대신 `subscribeMicFrames`로 기존 마이크 프레임을 *재사용*합니다. macOS는 기본 입력에 두 개의 스트림이 있을 때 종종 직렬화하여 모니터가 간헐적으로 무음이 되었는데, KWS가 리스닝 중일 때는 이제 이 경로가 기본값입니다.
- 성공적인 바지인 이후 비 웨이크 워드 모드는 VAD 재시작을 강제하여 계속 이어지는 발화를 웨이크 없이 캡처합니다. 웨이크 워드 + 상시 KWS 모드는 기존 동작을 유지합니다(KWS가 재획득하도록 — 두 번째 VAD를 강제하면 리스너와 마이크 경합).

### 🐛 렌더 스톰 + 창 간 동기화

헤드라인 버그는 은근하며, 두 계층으로 구성되어 있었습니다.

**렌더 스톰**: 부모의 매 렌더마다 `useChat` / `useMemory` / `usePetBehavior` / `useVoice` 소비자에게 새로운 객체 리터럴이 전달되었습니다. 다운스트림 memo(`chatWithAutonomy`, `petView`, `overlays`, `panelView`)가 매 렌더마다 무효화되며, state를 다시 쓰는 effect를 가진 자식으로 연쇄 확산 — 고전적인 "Maximum update depth exceeded" 루프. 채팅 턴이 정리되는 순간의 로그 스팸으로 관찰되었으며; 두 번째 STT 발화는 렌더러가 굶주려 VAD의 `speech_end` 콜백이 드레인되지 못해 멈추곤 했습니다. 수정: 각 hook의 return bag을 정확한 state deps로 useMemo 래핑. `useVoice` 내부에서는 `lifecycle.*` / `bindings.*` / `testEntries.*`를 memo deps에서 의도적으로 제외 — 이 팩토리들은 매 렌더마다 재생성되지만 안정적인 ref를 통해 라우팅되므로 캡처된 "오래된" 참조도 최신 구현을 호출합니다.

**창 간 동기화**: 펫 창과 채팅 패널은 각자 독립된 React state를 가진 별개의 Electron 렌더러입니다. 둘은 `CHAT_STORAGE_KEY`(`nexus:chat`)에 대한 `storage` 이벤트를 통해 채팅을 동기화합니다. 그러나 `useChat`의 save effect는 `upsertChatSession`만 호출했고, 이 함수는 `CHAT_SESSIONS_STORAGE_KEY`(`nexus:chat-sessions`)에 기록합니다 — `nexus:chat`은 아무도 쓰지 않았습니다. 펫 창 내부에서 일어나는 음성 턴은 열려 있는 채팅 패널에 절대 보이지 않았습니다. 수정: `upsertChatSession`과 함께 `saveChatMessages(messages)`도 호출하여 패널이 리스닝하는 키가 실제로 업데이트되게 합니다.

### 🔧 시작 시 수정

- **Silero VAD가 실제로 작동합니다.** `browserVad.ts`는 `onnxWASMBasePath`를 `public/vendor/ort/`로 지정하지만, 이 폴더는 **한 번도 존재하지 않았습니다** — `setup-vendor.mjs`는 Live2D 에셋만 복사했습니다. ORT 런타임이 없으면 `vad-web`은 Vite의 ESM dev 서버가 제공할 수 없는 CJS `require()`로 폴백했고, 전체 Silero 경로가 "legacy recording" 폴백으로 실패했습니다. 이제 `setup-vendor.mjs`가 postinstall 시 `node_modules`에서 vad-web이 필요로 하는 4개의 wasm + mjs 번들을 복사합니다.
- **`mcp:sync-servers` 핸들러가 즉시 등록됩니다.** 핸들러는 app-ready 약 1.5초 후에 지연 로딩되었지만, `useMcpServerSync`는 첫 렌더에서 발동하며 등록과 레이스했습니다. `sherpaIpc` / `notificationIpc`는 이전에 같은 이슈로 이주했고, `mcpIpc`가 이제 이들과 합류합니다.

---

## 지원 제공자

| 카테고리 | 제공자 |
|----------|--------|
| **LLM (18+)** | OpenAI · Anthropic · Gemini · DeepSeek · Kimi · Qwen · GLM · Grok · MiniMax · SiliconFlow · OpenRouter · Together · Mistral · Qianfan · Z.ai · BytePlus · NVIDIA · Venice · Ollama · Custom |
| **STT** | GLM-ASR-Nano · Paraformer · SenseVoice · Zhipu GLM-ASR · Volcengine · OpenAI Whisper · ElevenLabs Scribe · Tencent ASR · Custom |
| **TTS** | Edge TTS · MiniMax · Volcengine · DashScope Qwen3-TTS · OmniVoice · OpenAI TTS · ElevenLabs · Custom |
| **웹 검색** | DuckDuckGo · Bing · Brave · Tavily · Exa · Firecrawl · Gemini Grounding · Perplexity |

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
| 런타임 | Electron 36 |
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

## 기여하기

모든 형태의 기여를 환영합니다! 버그 수정, 새 기능, 번역, 문서 등 — 언제든 PR을 제출하거나 Issues에서 토론을 시작하세요.

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
