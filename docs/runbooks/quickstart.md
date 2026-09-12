# 빠른 시작: 오늘 밤 집 PC에서 대화 시작 → 내일 회사 PC로 옮기기

목표: 30분 안에 **나 + Claude + Codex** 3자 대화를 시작하고, 폰에서도 열어 본다.
비용: 0원. 이미 구독 중인 Claude Max 와 ChatGPT 로그인만 쓴다.

---

## 0. 준비물 (허브를 돌릴 PC 한 대)

| 항목 | 확인 방법 | 설치 |
|---|---|---|
| Node 22 이상 | `node --version` | https://nodejs.org (LTS) |
| pnpm | `pnpm --version` | `npm i -g pnpm` |
| Claude Code | `claude --version` | https://code.claude.com/docs/en/quickstart (`npm i -g @anthropic-ai/claude-code` 또는 네이티브 설치) |
| Codex CLI | `codex --version` | `npm i -g @openai/codex` |
| git | `git --version` | |

로그인 (각각 브라우저가 열린다):
```bash
claude          # 처음 실행하면 로그인 안내. 이미 쓰고 있다면 생략. 종료는 /exit
codex login     # ChatGPT 계정으로 로그인
```

무인 서버(모니터 없는 PC)에서 Claude 로그인이 어려우면, 로그인된 PC에서 `claude setup-token` 으로 장기 토큰을 만들어
허브 PC 의 환경변수 `CLAUDE_CODE_OAUTH_TOKEN` 에 넣는다 (Claude 구독 필요, 공식 기능).

### 오래된 macOS (Big Sur 11 / Monterey 12) 에서 `claude` 가 `dyld: Symbol not found` 로 죽을 때
최신 Claude Code 는 macOS 13 이상용 네이티브 실행 파일이다. **순수 Node 로 도는 마지막 버전 2.1.112** 를 설치하면 된다
(허브 어댑터가 구버전 플래그를 자동으로 감지해 맞춘다. 2.1.113 부터는 네이티브).
```bash
npm uninstall -g @anthropic-ai/claude-code
npm i -g @anthropic-ai/claude-code@2.1.112
claude --version      # 2.1.112 (Claude Code)
```
자동 업데이트가 최신으로 되돌리지 않도록 `~/.claude/settings.json` 에 `{"autoUpdates": false}` 를 두거나
환경변수 `DISABLE_AUTOUPDATER=1` 을 설정한다. 이 버전은 `--remote-control` 은 있지만 일부 최신 기능은 없다.
macOS 13 이상으로 올릴 수 있는 Mac 이면 올리는 편이 낫다 (2017년 이후 모델).

## 1. 허브 설치와 실행

```bash
git clone https://github.com/sjidok750-creator/Claude-Codex.git
cd Claude-Codex
cp .env.example .env        # Windows: copy .env.example .env
# .env 에서 HUB_TOKEN=아무_긴_문자열 로 설정 (권장)
pnpm install
pnpm build
pnpm start                  # Windows: .\scripts\start.ps1 / mac,linux: ./scripts/start.sh 도 동일
```

터미널에 `[hub] http://localhost:8787` 이 뜨면 브라우저에서 연다:

```
http://localhost:8787/?token=여기에_HUB_TOKEN
```

토큰은 한 번만 붙이면 쿠키로 저장된다.

## 2. 첫 대화

1. 왼쪽 위에서 프로필(`work` / `personal`)을 고르고 **+ 새 방**.
2. 제목만 적고 만들기. 정책은 기본 `mention`.
3. 아무 말이나 보낸다. 예) `요즘 잠이 잘 안 오는데 둘이 원인 후보를 세 개씩 대봐`
   - 지목이 없으면 Claude 와 Codex 가 **동시에** 답한다.
   - `@claude …` / `@codex …` 로 시작하면 지목된 쪽만 답한다.
4. 오른쪽 ⚙ 패널(폰에서는 상단 ⚙)에서 참가자별 **모델·effort·권한**을 바꾼다. 대화 중 `/model claude sonnet` 처럼 명령으로도 된다.
5. 둘이 토론시키고 싶으면 `/mode relay` 후 메시지. 라운드 수는 `/rounds 3`. 멈추려면 `/stop` 또는 아무 메시지.

### 슬래시 명령
| 명령 | 뜻 |
|---|---|
| `/model claude sonnet` · `/model codex gpt-5.6-terra` | 모델 변경(다음 턴부터, 대화 맥락 유지) |
| `/effort claude high` · `/effort codex low` | 노력 수준 |
| `/mode mention|roundtable|sequential|relay` | 턴 정책 |
| `/rounds N` | relay 최대 라운드 |
| `/mute codex` · `/unmute codex` | 잠시 빼기/넣기 |
| `/stop` | 진행 중 응답 중단 |

### 상태 확인
하단 상태바(폰에서는 ⚙ → 러너)에 `claude ready / codex ready` 가 보여야 한다.
- `codex 로그인 필요` → 허브 PC 에서 `codex login`.
- Claude 는 첫 메시지에서 인증 오류가 나면 메시지에 빨간 오류로 표시된다 → `claude` 를 한 번 실행해 로그인.

## 3. 폰에서 열기 (Tailscale, 무료)

1. 허브 PC 와 폰에 Tailscale 설치 후 같은 계정으로 로그인 (https://tailscale.com/download).
2. Tailscale 관리 화면에서 MagicDNS 를 켜면 PC 이름으로 접속된다.
3. 폰 브라우저에서 `http://<PC이름>:8787/?token=…` 접속.
4. iPhone: 공유 → **홈 화면에 추가**. Android: 메뉴 → **앱 설치**. 이후 앱처럼 열린다.

Windows 방화벽이 8787 인바운드를 막으면(다른 기기에서 안 열림) 관리자 PowerShell 에서 한 번:
```powershell
New-NetFirewallRule -DisplayName "Claude-Codex Hub" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Any
```
Tailscale 인터페이스로만 들어오게 하려면 `-RemoteAddress 100.64.0.0/10` 을 추가한다.

## 4. 회사 PC 로 옮기기 (항상 켜져 있으므로 허브는 여기가 정위치)

1. 회사 PC 에서 0~1 번을 그대로 반복 (설치, 로그인, `pnpm build`, `.env`).
2. 집 PC 에서 쓰던 대화를 가져오려면 `data/hub.sqlite` 파일만 복사하면 된다 (허브를 끈 상태에서).
   - Claude 세션 파일(`~/.claude/projects/...`)과 Codex 세션(`~/.codex/sessions/...`)은 기기별이라 옮겨지지 않는다. 옮긴 뒤 첫 메시지에서 각 에이전트는 새 세션으로 시작하고, 허브가 그동안의 대화를 요약 없이 그대로 다시 넘겨주지는 않는다. → 방을 새로 만드는 편이 깔끔하다.
3. 자동 시작 등록:
   - Windows: `.\scripts\install-autostart-windows.ps1` (로그온 시 시작, 죽으면 1분 후 재시작)
   - macOS: `./scripts/install-autostart-macos.sh`
4. 절전 끄기: Windows 전원 옵션에서 "절전 모드 안 함", 네트워크 어댑터 절전 해제.
5. 폰과 집 PC 는 Tailscale 로 회사 PC 허브에 접속.

회사 정책상 Tailscale 이 안 되면 → PLAN.md §5 의 방법 A(러너 분리, 3단계) 또는 B(`claude --remote-control`)를 쓴다.

## 5. 문제가 생기면

| 증상 | 확인 |
|---|---|
| 페이지가 401 | 주소에 `?token=` 을 붙였는지, `.env` 의 HUB_TOKEN 과 같은지 |
| 에이전트 응답이 빨간 오류 | 오류 본문을 읽는다. 대개 로그인/네트워크. `pnpm start` 를 띄운 터미널 로그도 본다 |
| 응답이 10분간 멈춤 | 허브가 자동으로 턴을 끊고 오류 표시 (`TURN_STALL_MS`) |
| 승인 카드가 안 뜨는데 멈춤 | 5분 지나면 자동 거부됨. 권한 모드를 `acceptEdits`/`workspace-write` 로 |
| UI 만 보고 싶다 | `.env` 에 `MOCK_AGENTS=1` 로 가짜 에이전트 |
| 처음부터 다시 | 허브 종료 후 `data/` 폴더 삭제 |

데이터는 전부 `data/hub.sqlite` 한 파일. 백업은 이 파일 복사.
