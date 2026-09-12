import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

// 저장소 루트의 .env 를 읽는다 (이미 설정된 환경변수가 우선). 별도 라이브러리 없이 처리.
const envFile = path.join(REPO_ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const dataDir = path.resolve(REPO_ROOT, env('DATA_DIR', 'data'));
const workspace = path.resolve(REPO_ROOT, env('WORKSPACE_DIR', path.join(dataDir, 'workspace')));
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
