# Claude-Codex: 나 + Claude + Codex 3자 대화 시스템 계획서

작성일: 2026-09-12
상태: v1.1 — 사용자 결정 반영, Phase 1 MVP 구현 완료 (`apps/`)

> **결정 로그 (2026-09-12)**
> - 허브 위치: **항상 켜져 있는 회사 PC**. VPS 없음, 추가 비용 0. 폰·집 PC 는 Tailscale(무료 개인 플랜)로 접속. 오늘은 집 PC 에서 먼저 띄워 대화를 시작하고, 내일 회사 PC 로 옮긴다 (`docs/runbooks/quickstart.md`).
> - 회사 PC: 자동 시작·절전 해제·아웃바운드 설정 가능하다고 확인됨.
> - ChatGPT 구독: 월 30,000원 → **Plus** 등급(Pro 아님). Codex 한도가 작으므로 relay 기본 2라운드, 저비용 모드를 일찍 만든다.
> - UI 프레임워크: **React** (전문적인 도구 느낌, 다크 IDE 테마).
> - 첫 용도: "우선 그냥 대화" → Phase 1 은 방 만들고 바로 말 걸 수 있는 데 집중. 작업 폴더·도구는 선택 사항.
> - 검증 결과는 `docs/ADR/0001-subscription-cli-feasibility.md`.

---

## 0. 한 줄 요약

**"항상 켜져 있는 작은 허브 서버"** 하나를 두고, 폰/PC 브라우저(PWA)로 접속해 주제(토픽)별 채팅방에서 **나, Claude, Codex** 세 명이 대화한다.
Claude와 Codex는 **API 키가 아니라 이미 구독 중인 Claude Max / ChatGPT Pro 로그인**으로 동작하는 공식 CLI(Claude Code, Codex CLI)를 허브가 프로그램적으로 구동하는 방식이다.
회사 PC와 집 PC에는 **"러너(Runner)"**라는 가벼운 프로세스를 설치해 허브에 **아웃바운드로만** 접속시키므로, 회사 방화벽에 인바운드 포트를 열 필요 없이 어디서든 회사 PC의 Claude를 부릴 수 있다.

권장 순서: **주말 하루짜리 MVP(단일 PC, 웹 UI, 3자 라운드테이블)** → 턴 정책/모델 전환 고도화 → 러너 분리로 회사 PC 연결 → 업무/개인 프로필 분리와 개인 에이전트 기능.

---

## 1. 요구사항 정리

### 1.1 명시된 요구
| # | 요구 | 해석 |
|---|---|---|
| R1 | 서비스별로 주제마다 기본 모델을 다른 모델로 바꿀 수 있어야 함 | 토픽 단위 설정: Claude 참가자 모델(예: opus/sonnet/fable), Codex 참가자 모델(예: gpt-6-astra / gpt-5.6-sol) + 노력 수준(effort). 대화 중 `/model` 로 즉시 변경 가능 |
| R2 | 개발자 도구 같은 UI, 참가자별 대표 이미지/이모지로 대화 | 다크 테마, 모노스페이스, 좌측 토픽 목록·중앙 스레드·우측 설정 패널. 참가자 아바타(🧑‍💻 나 / ✳️ Claude / ⬢ Codex) + 모델 배지 |
| R3 | Claude가 내 회사 컴퓨터에 언제든 연결될 수 있는 구조 | 회사 PC에서 실행되는 Claude Code를 폰/집에서 조종. 인바운드 개방 없이(아웃바운드 전용) 구성 |
| R4 | 업무용 + 개인 에이전트 겸용 | `work` / `personal` 프로필 분리: 별도 메모리·도구·연결기(MCP)·러너. 예약 작업, 알림, 메일/캘린더 연동 |

### 1.2 암묵적 요구(내가 추가로 가정한 것)
- **추가 비용 0에 가깝게**: 구독 한도 안에서 사용. API 키 종량제는 선택적 폴백.
- **폰에서 진짜로 쓸 수 있어야 함**: PWA로 홈 화면 설치, 푸시 알림, 음성 입력, 오프라인 시 마지막 상태 표시.
- **토픽은 코딩만이 아님**: 투자, 영어 공부, 회사 기획서, 여행 계획 등 무엇이든. 그래서 "작업 디렉토리"는 토픽의 선택 사항이지 필수가 아님.
- **보안**: 코드 실행 권한을 가진 에이전트가 인터넷에 노출되므로, 접근 통제가 1순위.

---

## 2. 핵심 전제 검증 (조사 결과)

계획의 성패를 가르는 전제들을 먼저 확인했다. ✅ 확인됨 / ⚠️ 부분 확인·주의 / ❓ 직접 실행으로 검증 필요.

### 2.1 Claude 쪽 (Claude Max 구독)
| 항목 | 결과 | 근거 |
|---|---|---|
| Claude Code를 프로그램에서 헤드리스로 구동 | ✅ `claude -p --input-format stream-json --output-format stream-json --include-partial-messages` 로 양방향 스트리밍 가능 | 이 세션에서 `claude --help` (v2.1.269) 직접 확인 |
| 세션 이어가기(토픽별 장기 기억) | ✅ `--session-id <uuid>`, `--resume <id>`, `--fork-session`, `--continue` | 동일 |
| 모델 전환 | ✅ `--model fable` / `opus` / `sonnet` 별칭 또는 전체 이름. `--effort low~max`, `--fallback-model` | 동일 |
| 권한/도구 제어 | ✅ `--permission-mode` (plan/acceptEdits/auto/dontAsk/bypassPermissions), `--allowedTools`, `--disallowedTools`, `--tools`, `--add-dir`, `--restricted`, `--permission-prompts host` (승인 요청을 호스트 프로그램이 받아 처리) | 동일 |
| 시스템 프롬프트 주입 | ✅ `--append-system-prompt`, `--system-prompt`, `--mcp-config`, `--agents` | 동일 |
| 구독으로 헤드리스 인증 | ✅ `claude setup-token` = "장기 인증 토큰 설정(Claude 구독 필요)". 서버/러너에서 API 키 없이 구독 계정으로 실행하는 공식 경로 | 동일 |
| 폰에서 로컬 Claude Code 조종 | ✅ `claude --remote-control [name]` 또는 세션 안에서 `/remote-control`. 로컬 세션을 claude.ai 웹/모바일 앱에서 이어서 조종. **Pro/Max 포함 전 플랜 지원**, 실행은 전부 로컬 머신에서 | `claude --help` + 공식 문서 remote-control |
| 채팅앱에서 Claude Code 호출(Channels) | ✅ 공식 플러그인: Telegram, Discord, iMessage(macOS). `claude --channels plugin:telegram` 으로 세션에 메시지가 푸시됨. 리서치 프리뷰, Pro/Max 기본 활성 | 공식 문서 channels |
| 백그라운드 상주 | ✅ `claude --bg`, `claude agents/attach/logs/stop/respawn`. 별도 데몬 모드는 없음 | 동일 |
| Max 플랜에서 쓸 수 있는 모델 | ✅ Fable 5.1(Max 기본), Fable 5, Opus 5(Max에서 1M 컨텍스트 자동), Sonnet 5, Haiku. 별칭: `fable`, `opus`, `sonnet`, `haiku`, `best`, `opus[1m]`, `opusplan`, `default` | 공식 문서 model-config |
| Agent SDK(`@anthropic-ai/claude-agent-sdk`) | ⚠️ 기능은 CLI와 동일(`query()`+`resume`,`model`,`permissionMode`,`allowedTools`,`cwd`,`mcpServers`,`hooks`)하지만 **공식 문서상 인증은 API 키 전용**. 구독 로그인으로 SDK를 쓰는 것은 문서가 허용하지 않음 | 공식 문서 agent-sdk/overview, quickstart |
| 세션 재개 시 복원 범위 | ⚠️ 대화·모델·권한 모드는 복원되지만 `--mcp-config`, `--add-dir`, `--settings` 는 매번 다시 넘겨야 함 | 공식 문서 sessions |
| 구독 사용 정책 | ⚠️ 아래 2.3 참조 | |

### 2.2 Codex 쪽 (ChatGPT Pro 구독)
| 항목 | 결과 | 근거 |
|---|---|---|
| 프로그램에서 Codex 구동 | ✅ 세 가지 경로: ① `codex app-server` (JSON-RPC 2.0, stdio 또는 실험적 `--listen ws://`), ② `@openai/codex-sdk` (TypeScript, `startThread/resumeThread/run/runStreamed`), ③ `codex exec --json` (일회성 헤드리스) | openai/codex 저장소 README, app-server 가이드 |
| 세션 이어가기 | ✅ app-server `thread/start` → `thread/resume`; SDK `resumeThread(id)`; `codex exec resume <id>`. 세션은 `~/.codex/sessions/.../rollout-*.jsonl` 로 영구 저장 | 동일 |
| 모델 전환 | ✅ `thread/start` 또는 **`turn/start` 마다** `model`, `effort`(none~xhigh) 지정 가능. CLI는 `-m`, `-c model=...` | app-server 가이드 |
| 승인·샌드박스 | ✅ `sandbox`: read-only / workspace-write / danger-full-access. `approvalsReviewer: user`이면 서버가 클라이언트에 `execCommandApproval` 요청을 보내고 `accept/decline` 응답 | 동일 |
| ChatGPT 로그인 사용 | ✅ CLI/SDK는 `codex login`(ChatGPT 계정) 또는 API 키. 공식 문서: "Codex SDK는 기존 Codex/ChatGPT 로그인 또는 API 키로 인증" | developers.openai.com/codex/sdk, /codex/auth (검색 요약) |
| 현재 모델(2026-09 기준) | ⚠️ GPT-6 Astra(9/3 출시, 권장 기본값), GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4(-mini), GPT-5.3-Codex-Spark(Pro 전용 프리뷰). 정확한 id 문자열은 `~/.codex/models_cache.json` 또는 `codex` 모델 선택기에서 확인 | 3rd-party 요약, 직접 확인 필요 |
| 사용량 한도 | ⚠️ Pro는 5x($100)/20x($200) 두 종. 5시간 창 + 주간 상한. Codex 한도는 일반 채팅과 별도 | 검색 요약 |

### 2.3 정책 리스크 (가장 중요한 ⚠️)
- **Anthropic**: 공식 문서는 두 가지를 분명히 한다. ① Agent SDK는 API 키로 인증하며, "사전 승인 없이는 서드파티 개발자가 자기 제품(Agent SDK 기반 에이전트 포함)에 claude.ai 로그인이나 구독 한도를 제공할 수 없다." ② 반면 `claude -p` 헤드리스 모드와 `claude setup-token`("Claude 구독 필요")은 **구독자 본인이 Claude Code를 자동화·무인 실행하라고 공식 제공**하는 경로다.
  → 따라서 Claude 어댑터는 **Agent SDK가 아니라 Claude Code CLI 자체(`claude -p --input-format stream-json …`)를 자식 프로세스로 구동**한다. 이것은 "내가 내 기기에서 Claude Code를 쓰는 것"이며, 남에게 로그인/한도를 제공하는 제품이 아니다. Agent SDK는 API 키 폴백을 켤 때만 사용한다. 그래도 회색지대가 완전히 없어지진 않으므로(상업화·타인 사용 금지), 이 시스템은 **1인용**으로 유지한다.
  → 절대 OAuth 토큰을 꺼내 Anthropic API를 직접 호출하지 않는다(서드파티 하네스가 차단당해 온 패턴).
- **OpenAI**: Codex CLI/SDK/app-server는 ChatGPT 로그인을 1급 인증으로 지원한다. 단, `chatgpt.com/backend-api/codex` 를 직접 두드리는 비공식 OAuth 우회 도구는 쓰지 않는다. 마찬가지로 **공식 바이너리를 통해서만**.
- 결론: 두 회사 모두 "공식 도구를 내 기기에서 내가 쓰는 것"이며, 남에게 서비스로 재판매하지 않는다. 그럼에도 약관은 바뀔 수 있으니 **API 키 폴백**(Claude: `ANTHROPIC_API_KEY`, Codex: `CODEX_API_KEY`)을 어댑터 설정 한 줄로 전환할 수 있게 설계한다.

### 2.4 회사 PC 연결 전제
- 회사 PC는 보통 **아웃바운드 443만 허용**, 인바운드 차단, VPN(Tailscale 등) 설치 금지인 경우가 많다.
- 따라서 회사 PC 쪽은 **항상 "나가는 연결"만** 맺어야 한다. (러너 → 허브 WSS, 또는 Claude Code Remote Control이 Anthropic 서버로 나가는 연결)
- 회사 데이터가 허브(집/클라우드)에 저장된다는 점은 회사 보안 정책과 충돌할 수 있다. → `work` 프로필의 **대화 로그 저장 위치를 회사 PC 러너 로컬로 한정**하는 옵션을 설계에 포함한다.

---

## 3. 아키텍처

### 3.1 구성요소
```
┌──────────────────────┐        ┌──────────────────────────────┐
│  클라이언트 (PWA)     │  WSS   │  Hub (항상 켜진 곳)           │
│  폰 / 회사 PC / 집 PC │◀──────▶│  - 토픽/메시지 저장(SQLite)   │
│  브라우저 하나로 통일  │        │  - 턴 정책 오케스트레이터     │
└──────────────────────┘        │  - 러너 레지스트리/라우팅     │
                                │  - 인증(Passkey/토큰)         │
                                └──────────▲───────▲───────────┘
                                 outbound WSS│       │outbound WSS
                          ┌──────────────────┘       └──────────────────┐
              ┌───────────┴───────────┐                     ┌───────────┴───────────┐
              │ Runner: 회사 PC (work)│                     │ Runner: 집 PC (personal)│
              │  claude(-p) 어댑터    │                     │  claude(-p) 어댑터      │
              │  codex app-server 어댑터│                   │  codex app-server 어댑터│
              │  로그인: Max / ChatGPT Pro│                  │  로그인: Max / ChatGPT Pro│
              └───────────────────────┘                     └───────────────────────┘
```

| 구성요소 | 역할 | 실행 위치 |
|---|---|---|
| **Hub** | 단일 진실 원천. 토픽/참가자 설정/메시지 저장, 턴 정책 실행, 어느 러너의 어느 에이전트에 보낼지 라우팅, 웹 UI 서빙, 실시간 스트리밍 중계 | 항상 켜진 곳 1대: 집 PC/미니PC/라즈베리파이, 또는 소형 VPS(Fly.io, Oracle Free 등). **MVP에서는 러너와 같은 프로세스** |
| **Runner** | Claude Code / Codex CLI가 설치·로그인된 머신에서 돌아가는 워커. 허브에 아웃바운드 WSS로 붙어 "나는 work 프로필, claude+codex 가능, 허용 디렉토리 X" 를 광고. 승인 요청을 허브로 올려 보냄 | 회사 PC, 집 PC (여러 대 가능) |
| **Web UI (PWA)** | 개발자 도구 스타일 채팅 UI. 폰/PC 동일 코드 | 허브가 서빙 |
| **Agent Adapter** | 러너 내부. `ClaudeAdapter`(claude -p stream-json 프로세스 관리), `CodexAdapter`(app-server JSON-RPC 클라이언트). 공통 인터페이스 `send(topicMsg) → AsyncIterable<Event>` | 러너 내부 |

### 3.2 왜 Hub / Runner 를 분리하나
1. **회사 PC 인바운드 불가** → 러너가 밖으로 붙는다.
2. 회사 PC가 꺼져 있어도 폰에서 지난 대화를 보고, 집 PC 러너로 개인 토픽을 계속할 수 있다.
3. 러너는 **stateless에 가깝게**(세션 id만 로컬 CLI 세션 저장소에 남음) 유지해 언제든 재시작 가능.
4. MVP는 한 프로세스로 시작하되, 인터페이스를 처음부터 `RunnerTransport(local | websocket)` 로 추상화해 2단계에서 분리 비용을 없앤다.

### 3.3 데이터 모델 (SQLite, Drizzle)
```
Profile      { id, name: 'work'|'personal', color, defaultRunnerId, storagePolicy: 'hub'|'runner-local' }
Runner       { id, profileId, name, host, capabilities: ['claude','codex'], allowedDirs[], lastSeenAt, online }
Topic        { id, profileId, title, emoji, createdAt, archivedAt?,
               turnPolicy: 'roundtable'|'sequential'|'mention'|'relay'|'moderated',
               relayMaxRounds, systemPrompt, workingDir?, runnerId? }
Participant  { id, topicId, kind: 'user'|'claude'|'codex', displayName, avatar,
               model, effort, permissionMode, allowedTools[], mcpServers[],
               agentSessionId?  // claude session uuid / codex threadId (러너 로컬 세션과 매핑)
               enabled }
Message      { id, topicId, participantId, role: 'user'|'agent'|'system'|'tool',
               content(markdown), blocks(json: text/tool_use/tool_result/thinking/approval),
               replyToId?, mentions[], model, usage(json), status: 'streaming'|'done'|'error'|'passed',
               createdAt }
Approval     { id, topicId, participantId, messageId, kind: 'exec'|'edit'|'network',
               payload, decision: 'pending'|'accept'|'decline', decidedAt }
Job          { id, profileId, topicId, cron, prompt, participantKind, lastRunAt, enabled }  // 예약 작업
```

### 3.4 3자 대화 프로토콜 (핵심 설계)
각 에이전트는 **토픽마다 자기만의 지속 세션**(Claude: session uuid, Codex: threadId)을 가진다. 허브는 전체 대화록을 매번 다시 보내지 않고, **그 에이전트가 마지막으로 본 이후의 메시지들만** 다음 형식으로 묶어 한 턴의 입력으로 보낸다.

```xml
<chat topic="투자 포트폴리오 점검" you="Claude">
  <msg from="나" at="14:02">삼성전자 비중을 줄일까 고민 중이야</msg>
  <msg from="Codex" model="gpt-6-astra" at="14:02">…Codex의 답…</msg>
</chat>
지시: 위 대화에 이어서 답하라. 덧붙일 말이 없으면 정확히 PASS 라고만 답하라.
```

에이전트 시스템 프롬프트(토픽 생성 시 `--append-system-prompt` / `baseInstructions` 로 주입):
- "너는 사용자·Claude·Codex 3자 채팅의 참가자다. 다른 참가자의 이름을 불러 대화하라. 상대 의견에 동의/반박을 명확히 하라. 사용자가 @로 지목하지 않은 질문에 덧붙일 말이 없으면 PASS."
- 토픽별 추가 프롬프트(예: "이 방은 영어 회화 연습방. Claude는 교정, Codex는 대화 상대").

**턴 정책 (토픽별 선택, 대화 중 `/mode` 로 변경)**
| 정책 | 동작 | 용도 |
|---|---|---|
| `roundtable` (기본) | 내 메시지 → Claude와 Codex가 **동시에** 답(서로의 답은 다음 턴에 봄) | 빠른 2차 의견 |
| `sequential` | 내 메시지 → Claude → (Claude 답을 본) Codex. 순서 설정 가능 | 초안→리뷰 |
| `mention` | `@claude` / `@codex` 지목된 쪽만 답. 지목 없으면 roundtable | 평상시 |
| `relay` | 내 메시지 후 두 에이전트가 최대 N라운드 주고받은 뒤 멈춤(PASS 2연속이면 조기 종료) | 토론, 설계 검토 |
| `moderated` | 한 에이전트(설정)가 사회자: 다른 쪽 답을 요약·판정 | 결론 도출 |

부가 규칙:
- **PASS 처리**: 본문이 `PASS`면 UI에 "Claude는 넘김" 회색 한 줄만 표시(스레드 오염 방지).
- **폭주 방지**: relay 라운드 상한 + 토픽별 "한 시간당 에이전트 턴 수" 상한. 구독 5시간 창을 지키기 위한 예산 표시(§6.3).
- **내 끼어들기**: 에이전트가 스트리밍 중일 때 내가 메시지를 보내면 현재 턴은 완료시키되 다음 라운드를 취소하고 내 메시지를 우선.
- **도구 사용 표시**: 에이전트가 파일 읽기·명령 실행을 하면 메시지 안에 접히는 "tool" 블록으로 표시(개발자 UI 느낌의 핵심).
- **승인 요청**: 러너에서 올라온 exec/edit 승인 요청을 UI 카드(✅ 허용 / ❌ 거부 / 항상 허용)로 표시, 폰에 푸시.

### 3.5 어댑터 상세

**ClaudeAdapter (러너 내부)**
- 프로세스: 토픽당 1개의 장수 프로세스 `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --session-id <topic-claude-uuid> --model <m> --effort <e> --permission-mode <pm> --permission-prompts host --append-system-prompt <파일> [--add-dir <dir>] [--mcp-config <json>]`
  - 유휴 10분 후 종료, 다음 메시지에 `--resume <uuid>` 로 부활 → 토픽 기억 유지.
  - 모델 변경 시 프로세스만 재시작(`--resume` + 새 `--model`) → 대화 맥락 유지한 채 모델 교체 (R1).
  - **1차 선택: CLI 직접 구동**(구독 인증이 공식 지원되는 경로, §2.3). stdin으로 `{"type":"user","message":{...}}` JSON 라인을 넣고 stdout의 stream-json 이벤트(`assistant` 델타, `tool_use`, `result`, 권한 요청)를 파싱한다. `--permission-prompts host` 로 승인 요청을 러너가 받아 허브로 올린다.
  - 폴백: API 키를 쓰는 참가자에 한해 `@anthropic-ai/claude-agent-sdk`의 `query()`(동일 옵션 객체 + `canUseTool` 콜백).
  - 세션 재개 시 `--mcp-config`, `--add-dir` 는 복원되지 않으므로 러너가 항상 다시 붙인다.
- 인증: 러너 머신에서 `claude login`(브라우저) 또는 `claude setup-token` 으로 만든 장기 토큰을 환경변수로 주입(무인 서버용). 토큰 만료 시 러너가 "재로그인 필요" 상태를 허브에 보고.

**CodexAdapter (러너 내부)**
- 프로세스: 러너당 1개의 장수 `codex app-server`(stdio). `initialize` → 토픽별 `thread/start`(첫 회) / `thread/resume`(이후) → 메시지마다 `turn/start { threadId, input, model, effort, sandbox, approvalsReviewer:'user' }`.
  - `item/agentMessage/delta` 로 스트리밍, `turn/completed` 로 종료, `execCommandApproval` 요청을 허브로 중계.
  - 모델 변경은 **다음 `turn/start` 의 `model` 만 바꾸면 됨** → 가장 깔끔하게 R1 충족.
- 인증: 러너 머신에서 `codex login`(ChatGPT 계정). 무인 서버는 로그인된 머신의 `~/.codex/auth.json` 을 복사(개인 기기 간에만).

**공통 인터페이스**
```ts
interface AgentAdapter {
  ensureSession(topic, participant): Promise<{ sessionId }>;
  send(topic, participant, input: ChatInput): AsyncIterable<AgentEvent>; // text_delta | tool_use | tool_result | approval_request | usage | done | error
  interrupt(topic, participant): Promise<void>;
  setModel(topic, participant, model, effort): Promise<void>;
}
```

### 3.6 모델 전환 (R1) 사용자 흐름
1. 토픽 생성 시: 프로필 기본값 상속(예: work → Claude `opus`, Codex `gpt-6-astra`). 우측 패널에서 참가자별 드롭다운 + effort 슬라이더.
2. 대화 중: `/model claude sonnet`, `/model codex gpt-5.6-terra`, `/effort claude max` 슬래시 명령. 변경 즉시 시스템 라인("Claude: opus → sonnet")이 스레드에 남음.
3. 메시지마다 답한 모델을 아바타 아래 배지로 표시(어떤 모델이 무슨 말을 했는지 추적).
4. 모델 목록은 하드코딩하지 않고 러너가 시작할 때 보고: Claude는 별칭(`fable`,`opus`,`sonnet`) + 최근 전체 이름, Codex는 `~/.codex/models_cache.json` 파싱.

---

## 4. UI 설계 (R2)

컨셉: **"IDE 안의 팀 채팅"**. VS Code 다크 + 터미널 감성.

- **레이아웃 (데스크톱)**: 3열. 좌 240px 토픽 목록(프로필 탭 `work | personal`, 이모지+제목, 미읽음 점, 진행 중 스피너) / 중앙 스레드 / 우 320px 설정 패널(참가자 카드·모델·effort·턴 정책·작업 디렉토리·러너 상태).
- **레이아웃 (폰)**: 스레드 단일 열, 좌우 스와이프 또는 상단 버튼으로 토픽/설정 시트. 하단 고정 컴포저. safe-area 대응.
- **메시지**: 좌측 40px 아바타. 나 🧑‍💻(우측 정렬 아님, 전부 좌측 로그처럼), Claude ✳️(주황 `#D97757`), Codex ⬢(초록 `#10A37F`). 이름 옆에 모델 배지(`opus` / `gpt-6-astra`), 시간, 토큰 사용량(호버). 마크다운·코드 하이라이트·diff 렌더. tool 블록은 접힘 `▸ Bash: git status` → 펼치면 출력.
- **스트리밍**: 커서 깜빡임, "Claude가 생각 중…" 상태줄. 두 에이전트 동시 스트리밍 시 각자 버블.
- **컴포저**: 모노스페이스 textarea, `@` 자동완성, `/` 명령 팔레트(`/model`, `/mode`, `/effort`, `/pass`(이번 턴 에이전트 답 건너뜀), `/summary`, `/fork`, `/runner`), 이미지 첨부, 폰 음성 입력(Web Speech API), `⌘/Ctrl+Enter` 전송.
- **상태바(하단, 터미널 느낌)**: `● work-runner(회사PC) online | claude: opus ⏱ 5h창 41% | codex: gpt-6-astra 주간 12% | ws: 32ms`.
- **명령 팔레트** `⌘K`: 토픽 이동/생성, 모드 변경, 러너 전환.
- **테마 토큰**: 배경 `#0B0F14`, 패널 `#11161D`, 경계 `#1F2937`, 본문 `#E5E7EB`, 폰트 `JetBrains Mono` + 시스템 산세리프 폴백. 라이트 테마도 토큰만 교체.
- **알림**: Web Push(승인 요청, relay 종료, 예약 작업 결과). iOS는 홈 화면에 추가한 PWA에서만 푸시 가능하므로 온보딩에 안내.

---

## 5. 회사 PC 연결 (R3)

세 가지 방법을 **겹쳐서** 쓴다. 각각 실패 모드가 다르기 때문이다.

| 방법 | 설명 | 장점 | 단점/조건 |
|---|---|---|---|
| **A. 러너 아웃바운드 WSS (주력)** | 회사 PC의 러너가 허브(`wss://hub.example`)로 접속. 로그온 시 자동 시작(Windows 작업 스케줄러 / macOS launchd), 끊기면 지수 백오프 재접속. 하트비트 30초 | 인바운드 0, VPN 불필요, 허브 UI에서 3자 대화에 그대로 참여 | 회사 PC가 켜져 있어야 함(절전 해제 설정). 프록시 환경이면 `HTTPS_PROXY` 지원 필요 |
| **B. Claude Code Remote Control (공식, 즉시)** | 회사 PC에서 `claude --remote-control 회사PC` 실행(또는 세션 안에서 `/remote-control`) → claude.ai 웹/모바일 앱에서 그 세션을 그대로 조종. 파일·명령 실행은 전부 회사 PC 로컬 | 개발 0, Anthropic이 중계·인증 담당, Max 포함 전 플랜 | 3자 대화가 아니라 Claude 단독. 허브 UI와 별개 화면. 인터랙티브 세션이라 터미널(또는 `--bg`)이 살아 있어야 하고 로그인 만료 시 `/login` 필요 |
| **B'. Channels (Telegram/Discord)** | 회사 PC에서 `claude --channels plugin:telegram` → 텔레그램 봇으로 메시지를 보내면 그 세션이 반응 | 폰에서 가장 익숙한 UI, 알림 공짜 | Claude 단독, Bun 필요, 리서치 프리뷰. 회사 PC에 봇 토큰 보관 |
| **C. Tailscale(또는 Cloudflare Tunnel)** | 회사 PC를 개인 메시 VPN에 넣어 허브/러너에 직접 접근 | SSH·파일까지 전부 열림 | 회사 정책상 설치 금지인 경우 많음. 먼저 IT 정책 확인 |

**권장**: 1주차에는 B로 바로 체감. 러너가 완성되면 A로 전환. C는 정책이 허용할 때만 보너스.

**보안 설계(A 기준)**
- 러너 ↔ 허브: 러너별 장기 토큰(발급 시 1회 표시) + TLS. 허브는 러너에게 "명령"을 내리는 게 아니라 **토픽 메시지를 전달**할 뿐이고, 실행 권한은 러너의 로컬 설정이 결정.
- 러너 로컬 설정(`runner.toml`): 허용 디렉토리 화이트리스트, 기본 `permission-mode`(work는 `acceptEdits`, 위험 명령은 승인 필수), 네트워크 도구 허용 여부, 금지 명령 패턴.
- 사용자 ↔ 허브: Passkey(WebAuthn) 단일 사용자 로그인 + 기기별 세션. 허브는 Cloudflare Access 또는 Tailscale 뒤에 두고 **공인 인터넷에 직접 노출하지 않는 것을 기본**으로.
- 승인 흐름: 러너가 `approval_request` → 허브 → 폰 푸시 → 내가 탭 → 러너로 회신. 타임아웃(5분) 시 자동 거부.
- 감사 로그: 러너가 실행한 모든 명령/파일 변경을 로컬 `audit.jsonl` 에 남김.
- 회사 데이터 정책: `work` 프로필은 `storagePolicy: runner-local` 선택 시 메시지 본문을 허브에 저장하지 않고 러너 로컬 SQLite에 저장, 허브에는 메타데이터만. (폰에서 볼 때는 러너가 온라인일 때만 본문을 스트리밍)

---

## 6. 업무 + 개인 에이전트 겸용 (R4)

### 6.1 프로필 분리
| | work | personal |
|---|---|---|
| 러너 | 회사 PC | 집 PC (또는 허브와 동일 머신) |
| Claude 메모리(`CLAUDE.md`, auto-memory 디렉토리) | 회사 PC 로컬 | 집 PC 로컬 |
| MCP 연결기 | Jira/Confluence/사내 GitHub/Slack(회사) | Gmail, Google Calendar/Drive, 카카오톡 메모, 개인 GitHub |
| 기본 모델 | Claude `opus` + Codex `gpt-6-astra` | Claude `sonnet`(가벼운 대화) / 필요 시 `fable`, Codex `gpt-5.6-terra` |
| 저장 정책 | runner-local 가능 | hub |
| UI 색 | 파랑 계열 상단 띠 | 보라 계열 |

프로필은 UI 최상단 토글 하나로 전환. 토픽은 프로필에 종속되어 섞이지 않는다. 검색도 프로필 범위 안에서.

### 6.2 개인 에이전트 기능 (3단계 이후)
- **예약 작업(Job)**: cron + 프롬프트 + 대상 참가자. 예) 매일 07:30 personal/"아침 브리핑" 토픽에 Claude가 캘린더·메일 요약 게시 → 푸시. 주 1회 Codex가 개인 저장소 의존성 업데이트 PR.
- **인박스 토픽**: 폰에서 아무 말이나 던지는 기본 토픽. 에이전트가 "이건 새 토픽으로 뺄까?" 제안.
- **장기 기억**: 토픽별 세션 기억 + 프로필별 `MEMORY.md`(에이전트가 `/remember` 로 추가). Claude Code auto-memory와 연동.
- **파일/이미지**: 폰 사진 첨부 → 두 에이전트가 함께 봄(Claude: 이미지 입력, Codex: `local_image`).
- **외부 트리거**: 이메일/웹훅이 특정 토픽에 메시지를 넣으면 turn policy에 따라 에이전트가 반응(예: CI 실패 알림 → Codex가 원인 분석).

### 6.3 구독 예산 관리
- 러너가 각 턴의 `usage`(토큰)와 시각을 기록. UI 상태바에 참가자별 **사용량 추정 게이지** 표시. Claude는 `/usage` 가 보여주는 값이 기준(헤드리스 사용도 대화형과 동일하게 차감됨), Codex는 5시간 창 + 주간 상한. 정확한 잔량 API가 없으면 자체 누적치 + 리셋 시각 추정.
- 토픽별 "저비용 모드" 토글: Claude `sonnet` + effort low, Codex `luna` 급으로 자동 스위치.
- 한도 도달 시 다른 프로필의 러너(다른 계정이 아니라 같은 계정이므로 도움 안 됨)를 쓰는 대신, **API 키 폴백**을 참가자 단위로 켤 수 있게(비용 경고 표시).

---

## 7. 기술 스택 & 저장소 구조

- 언어: **TypeScript 전반** (두 공식 SDK가 모두 TS, 러너를 Windows/macOS/Linux에서 동일하게).
- 런타임: Node 22. 패키지: pnpm 워크스페이스.
- Hub: **Hono**(HTTP+WS, 가볍고 어디서나 실행) + `better-sqlite3` + Drizzle ORM. 실시간은 WebSocket 단일 채널(이벤트 스트림).
- Web: **React + Vite + Tailwind**, PWA(vite-plugin-pwa), 마크다운 `react-markdown` + `shiki`. 상태는 Zustand. (SvelteKit도 좋지만 컴포넌트 생태계와 shiki/diff 뷰어 재사용성 때문에 React.)
- Runner: Node 프로세스. Claude는 **Claude Code CLI 자식 프로세스(stream-json)**, Codex는 `codex app-server` JSON-RPC 직접 클라이언트(턴마다 모델 지정이 가장 자유로움; 간단히 가려면 `@openai/codex-sdk`). `ws` 클라이언트. 서비스 등록 스크립트(launchd/작업 스케줄러/systemd). API 키 폴백 시에만 `@anthropic-ai/claude-agent-sdk`.
- 배포: 허브는 Docker 1컨테이너(SQLite 볼륨). 초기엔 집 PC, 이후 Fly.io/Oracle Free VM 등 저가 VPS + Cloudflare Access.

```
Claude-Codex/
├── apps/
│   ├── hub/          # Hono 서버: REST+WS, 오케스트레이터, 러너 레지스트리, 웹 정적 서빙
│   ├── web/          # React PWA
│   └── runner/       # 러너 데몬 + 어댑터
├── packages/
│   ├── protocol/     # 허브↔러너↔웹 공용 타입(zod 스키마), 이벤트 정의
│   ├── db/           # Drizzle 스키마, 마이그레이션
│   └── prompts/      # 3자 대화 시스템 프롬프트, 토픽 템플릿
├── docs/
│   ├── PLAN.md       # 이 문서
│   ├── ADR/          # 아키텍처 결정 기록
│   └── runbooks/     # 회사 PC 러너 설치, 허브 배포, 복구
├── scripts/          # setup-runner.ps1 / .sh, dev 실행
└── docker/
```

---

## 8. 단계별 로드맵

각 단계는 **"끝나면 무엇을 직접 해볼 수 있나"** 로 정의한다.

### Phase 0 — 전제 검증 (반나절)
- [ ] 집 PC에서 `claude login` 후 `claude -p --output-format stream-json "안녕" ` 이 구독으로 동작하는지 확인. `claude setup-token` 발급 테스트.
- [ ] `codex login`(ChatGPT) 후 `codex exec --json "안녕"` 와 `codex app-server` `thread/start` → `turn/start` 수동 JSON-RPC 테스트. 모델 id 목록(`~/.codex/models_cache.json`) 확보.
- [ ] 회사 PC: `claude --remote-control` 로 폰에서 조종되는지 체험(방법 B). 여유가 되면 `claude --channels plugin:telegram` 도 시험(방법 B'). 회사 프록시/정책 확인(아웃바운드 WSS 가능 여부, 스크립트 자동 실행 가능 여부).
- [ ] stream-json 왕복 실험: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --session-id $(uuidgen)` 에 JSON 두 줄을 넣어 두 턴이 같은 세션으로 이어지는지 확인.
- 산출물: `docs/ADR/0001-subscription-cli-feasibility.md` 에 결과 기록. 여기서 막히면 API 키 폴백으로 설계 조정.

### Phase 1 — 단일 PC MVP (주말 1~2일)
- 허브+러너 단일 프로세스(`apps/hub` 가 어댑터를 직접 로드), SQLite, 웹 UI 최소판(토픽 목록, 스레드, 컴포저, 참가자별 모델 드롭다운).
- 턴 정책은 `roundtable` + `mention` 두 개. PASS 처리. 스트리밍.
- 토픽별 Claude 세션 `--session-id/--resume`, Codex `thread/resume` 연결.
- 폰 접속: 같은 Wi-Fi 또는 Tailscale로 집 PC 접속(임시).
- ✅ 완료 기준: 폰에서 "이번 주 식단 짜줘" 를 던지면 Claude와 Codex가 각각 답하고, 내가 `@codex 단백질 위주로` 라고 하면 Codex만 이어 답한다. `/model claude sonnet` 이 즉시 반영된다.

### Phase 2 — 대화 품질 (1주)
- `sequential` / `relay` / `moderated` 정책, 라운드 상한, 끼어들기.
- 도구 블록 UI, 승인 카드(허브 내), 마크다운/코드/diff 렌더, 명령 팔레트, PWA 설치·푸시.
- 토픽 템플릿(코드 리뷰방, 토론방, 영어방, 기획서방)과 시스템 프롬프트 편집.
- ✅ 완료 기준: relay 모드로 "이 설계의 단점을 서로 지적해봐" 3라운드가 자연스럽게 끝나고 사회자 요약이 나온다.

### Phase 3 — 러너 분리 & 회사 PC (1주)
- `apps/runner` 분리, 허브↔러너 WSS 프로토콜(등록/하트비트/턴 전달/이벤트 스트림/승인 왕복).
- 회사 PC 설치 스크립트, 자동 시작, 재접속. 허브를 VPS 또는 집 PC + Cloudflare Access 로 이전. Passkey 로그인.
- `work` 프로필 `runner-local` 저장 정책.
- ✅ 완료 기준: 지하철에서 폰으로 work 토픽에 "어제 만든 브랜치 테스트 돌려봐" → 회사 PC의 Claude가 실행하고 결과·승인 요청이 폰에 온다.

### Phase 4 — 개인 에이전트 (2주, 점진)
- 프로필별 MCP 연결기(Gmail/Calendar/Drive/카카오 메모), 예약 작업, 인박스 토픽, `/remember`, 이미지 첨부, 음성 입력.
- 사용량 게이지, 저비용 모드, API 키 폴백 스위치.
- ✅ 완료 기준: 매일 아침 브리핑이 자동으로 오고, 폰에서 사진 한 장 던지면 두 에이전트가 함께 본다.

### Phase 5 — 다듬기 (지속)
- 전문 검색, 토픽 내보내기(markdown), 포크(`/fork`로 대화 갈래 나누기), 다중 러너 선택, 백업/복구, 테스트·CI, 에이전트 3번째 자리(예: Gemini) 확장 인터페이스.

---

## 9. 리스크와 대응

| 리스크 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 구독 인증의 프로그램 사용에 대한 약관 변경/차단 | 중 | 높음 | Claude는 공식 헤드리스 CLI + `setup-token` 경로만, Codex는 공식 CLI/SDK만 사용. 1인용 유지. API 키 폴백 스위치 준비 |
| CLI 플래그/프로토콜 변경(둘 다 빠르게 바뀜) | 높음 | 중 | 어댑터 계층으로 격리, 러너 시작 시 `--help`/`initialize` 로 기능 탐지, 버전 고정(pin) |
| 5시간/주간 한도 소진(relay 모드가 빠르게 태움) | 중 | 중 | 라운드 상한, 예산 게이지, 저비용 모드 |
| 회사 PC 정책(스크립트 실행·아웃바운드 WS 금지) | 중 | 높음 | Phase 0에서 먼저 확인. 안 되면 방법 B(Remote Control)만 사용 |
| 코드 실행 에이전트의 인터넷 노출 | 낮음(설계로 차단) | 매우 높음 | 허브 비공개(Access/Tailscale), Passkey, 러너 화이트리스트, 승인 흐름, 감사 로그 |
| 회사 데이터 유출 우려 | 중 | 높음 | runner-local 저장, 회사 토픽에 외부 MCP 금지 |
| 두 에이전트의 답이 장황해 폰에서 읽기 힘듦 | 높음 | 낮음 | 시스템 프롬프트에 길이 규칙, PASS, 접기 UI, `/summary` |

---

## 10. 결정이 필요했던 것 (답변 완료, 위 결정 로그 참고)

1. **허브를 어디에 둘까?** ① 집에 항상 켜진 PC/미니PC가 있다 ② 저가 VPS(월 $5 내외) 써도 된다 ③ 일단 집 PC 켜둘 때만 써도 된다.
2. **회사 PC 환경**: OS(Windows/macOS), 관리자 권한 여부, 프록시 유무, VPN/Tailscale 설치 가능 여부, 야간 절전 정책.
3. **ChatGPT Pro 등급**: 5x($100) 인지 20x($200) 인지 (relay 모드 기본 라운드 수 결정에 필요).
4. **UI 프레임워크 선호**: React(권장) vs Svelte. 무관하면 React로 진행.
5. **1차 토픽 후보 3개**: 실제로 첫 주에 쓸 주제(예: 회사 프로젝트 X 코드 리뷰, 개인 투자, 영어). 템플릿 설계에 반영.
6. 세 번째 에이전트(Gemini 등) 자리를 처음부터 비워둘지 여부(인터페이스만 열어두는 비용은 작음).

---

## 11. 바로 다음 액션

1. Phase 0 체크리스트를 집 PC에서 30분 안에 돌려보고 결과를 이 저장소 `docs/ADR/0001-*.md` 에 남긴다.
2. 위 §10 답을 받으면 Phase 1 스캐폴딩(pnpm 워크스페이스, hub/web/runner 뼈대, protocol 스키마)을 이 브랜치에 커밋한다.
3. 회사 PC에서는 그 사이 `claude --remote-control` 로 폰 조종을 먼저 써보며 필요한 승인 규칙 감을 잡는다.
