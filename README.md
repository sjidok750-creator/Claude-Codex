# Claude-Codex

**나 + Claude + Codex** 세 참가자가 주제별 방에서 함께 이야기하는 개인용 허브.
폰/PC 브라우저(PWA)에서 쓰고, 이미 구독 중인 **Claude Max** 와 **ChatGPT** 로그인으로 동작한다(API 키·추가 비용 없음).

```
pnpm install && pnpm build && pnpm start   # → http://localhost:8787
```

- 빠른 시작(집 PC → 회사 PC → 폰): [docs/runbooks/quickstart.md](docs/runbooks/quickstart.md)
- 설계 계획서: [docs/PLAN.md](docs/PLAN.md)
- 검증 기록: [docs/ADR/0001-subscription-cli-feasibility.md](docs/ADR/0001-subscription-cli-feasibility.md)

## 구성

| 경로 | 역할 |
|---|---|
| `apps/hub` | Hono 서버. SQLite(`node:sqlite`) 저장, 턴 정책 오케스트레이터, WebSocket 스트리밍, 에이전트 어댑터 |
| `apps/hub/src/adapters/claude.ts` | Claude Code CLI 를 `-p --input-format stream-json` 로 구동 (토픽마다 세션 유지, 승인 중계) |
| `apps/hub/src/adapters/codex.ts` | `codex app-server` JSON-RPC 클라이언트 (토픽마다 thread, 턴마다 모델·effort) |
| `apps/web` | React + Vite PWA. 다크 IDE 테마, 토픽 목록 / 스레드 / 설정 패널, `@지목`, `/명령` |
| `packages/protocol` | 허브↔웹 공용 타입 |
| `packages/prompts/trio.md` | 3자 대화 규칙 시스템 프롬프트 |
| `scripts/` | 실행·자동 시작 스크립트 (Windows 작업 스케줄러, macOS launchd) |

## 턴 정책
`mention`(기본: 지목한 쪽만, 없으면 둘 다) · `roundtable`(항상 둘 다) · `sequential`(순서대로) · `relay`(N라운드 토론).
에이전트는 덧붙일 말이 없으면 `PASS` 로 넘긴다.

## 개발
```
pnpm dev            # hub(8787, tsx watch) + web(5173, vite) 동시 실행
MOCK_AGENTS=1 pnpm start   # CLI 없이 가짜 에이전트로 UI 확인
pnpm typecheck
```
