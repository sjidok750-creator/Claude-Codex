# ADR-0001: 구독 로그인 + 공식 CLI 구동 방식 채택

날짜: 2026-09-12 · 상태: 채택

## 맥락
Claude Max 와 ChatGPT 구독만으로(추가 API 비용 없이) 두 에이전트를 프로그램에서 구동해야 한다.

## 검증한 사실

### Claude Code CLI (v2.1.269, 이 개발 세션에서 직접 실행)
- `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --permission-prompts host --append-system-prompt-file <파일> --session-id <uuid> --model <m> --effort <e>` 로 장수 프로세스를 띄우고, stdin 에 `{"type":"user","message":{"role":"user","content":"…"}}` 를 넣으면 다음 이벤트가 stdout 에 JSON 라인으로 온다:
  `system/init` (session_id), `stream_event` (content_block_delta / text_delta), `assistant` (tool_use 블록), `user` (tool_result), `result` (usage, is_error), `control_request` (subtype `can_use_tool`, 응답은 `control_response` 에 `{behavior:'allow'|'deny'}`).
- **허브 어댑터로 실제 응답을 받는 데 성공했다** (개발 샌드박스의 Claude 인증으로 "안녕하세요! …" 응답 수신).
- `--append-system-prompt-file`, `--effort`, `--session-id`, `--resume`, `--remote-control`, `setup-token` 모두 존재 확인.
- 정책: Agent SDK 는 API 키 전용이며 서드파티가 claude.ai 로그인을 제공하는 것은 금지. 헤드리스 CLI + `claude setup-token`(구독 필요)은 구독자의 자동화용으로 제공됨. → **Agent SDK 대신 CLI 자식 프로세스** 채택.

### Codex CLI (v0.154.0, 이 개발 세션에서 직접 실행)
- `codex app-server` (stdio, JSON-RPC 2.0). `initialize` → `initialized` → `thread/start {model, cwd, approvalPolicy, approvalsReviewer, sandbox, developerInstructions}` → `turn/start {threadId, input:[{type:'text', text, text_elements:[]}], model, effort, cwd}`.
- 알림: `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed`, `thread/tokenUsage/updated`, `error {willRetry}`, `turn/completed {turn.status}`.
- 서버→클라이언트 요청: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (응답 `{decision:'accept'|'decline'|'acceptForSession'|'cancel'}`), `item/permissions/requestApproval`.
- `model/list` 결과(로그인 없이도 조회됨): `gpt-6-astra`(기본), `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.2`. effort: low/medium/high/xhigh/max(/ultra).
- `account/read` → `{account:null, requiresOpenaiAuth:true}` 이면 미로그인. 미로그인 상태에서 `turn/start` 는 오류 없이 재시도만 반복하므로 허브가 먼저 확인해 빨리 실패시킨다.
- 인증: `codex login`(ChatGPT). 공식 문서상 SDK/CLI 모두 ChatGPT 로그인 지원.

### 그 밖에
- Node 22 내장 `node:sqlite` 로 네이티브 빌드 없이 SQLite 사용 (Windows 회사 PC 에 빌드 도구 불필요). 실험적 경고가 뜨지만 동작 확인.
- 구독 등급: 사용자의 ChatGPT 는 월 30,000원 → **Plus** 등급으로 추정(Pro 는 $100/$200). Codex 한도가 Pro 보다 작으므로 relay 기본 라운드를 2 로 둔다.

## 결정
1. Claude: Claude Code CLI 자식 프로세스(stream-json). API 키 폴백 시에만 Agent SDK.
2. Codex: `codex app-server` JSON-RPC 직접 클라이언트 (턴마다 모델·effort 지정 가능).
3. 허브 위치: 항상 켜져 있는 **회사 PC**. VPS 없음(비용 0). 접근은 Tailscale(무료) + HUB_TOKEN.
4. 시스템 프롬프트 주입: Claude `--append-system-prompt-file`, Codex `developerInstructions` (`baseInstructions` 는 기본 지시를 통째로 바꾸므로 쓰지 않음).

## 결과
- 1인용으로 유지. 상업화·타인 사용 금지(약관).
- CLI 프로토콜이 바뀌면 `apps/hub/src/adapters/*` 만 손보면 된다.
