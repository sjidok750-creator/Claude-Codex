import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const dataDir = path.resolve(env('DATA_DIR', path.join(REPO_ROOT, 'data')));
const workspace = path.resolve(env('WORKSPACE_DIR', path.join(dataDir, 'workspace')));
fs.mkdirSync(workspace, { recursive: true });

export const config = {
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '8787')),
  dataDir,
  dbPath: path.join(dataDir, 'hub.sqlite'),
  /** 토픽에 workingDir 이 없을 때 에이전트가 쓰는 기본 작업 폴더 */
  workspace,
  /** 설정하면 모든 HTTP/WS 요청에 토큰이 필요하다 (Tailscale 밖에 둘 때 필수) */
  hubToken: env('HUB_TOKEN', ''),
  claudeBin: env('CLAUDE_BIN', 'claude'),
  codexBin: env('CODEX_BIN', 'codex'),
  /** 1이면 실제 CLI 대신 가짜 에이전트로 동작 (UI/흐름 개발용) */
  mockAgents: env('MOCK_AGENTS', '0') === '1',
  /** 유휴 Claude 프로세스를 내리는 시간 */
  claudeIdleMs: Number(env('CLAUDE_IDLE_MS', String(10 * 60 * 1000))),
  /** 승인 요청 자동 거부까지의 시간 */
  approvalTimeoutMs: Number(env('APPROVAL_TIMEOUT_MS', String(5 * 60 * 1000))),
  /** 에이전트 턴에서 이 시간 동안 이벤트가 없으면 중단 */
  turnStallMs: Number(env('TURN_STALL_MS', String(10 * 60 * 1000))),
  webDist: path.join(REPO_ROOT, 'apps', 'web', 'dist'),
  promptsDir: path.join(REPO_ROOT, 'packages', 'prompts'),
  hostname: os.hostname(),
};

export type Config = typeof config;
