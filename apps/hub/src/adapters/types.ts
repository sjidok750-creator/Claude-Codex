import type { AgentKind, AgentStatus, Participant, Topic } from '@claude-codex/protocol';

export interface RunContext {
  topic: Topic;
  participant: Participant;
  /** 3자 대화 규칙 + 토픽 프롬프트를 합친 시스템 프롬프트 */
  systemPrompt: string;
  /** 에이전트가 파일·명령을 다룰 디렉토리 */
  cwd: string;
}

export type AgentEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool.start'; id: string; name: string; input: string }
  | { type: 'tool.update'; id: string; input?: string; output?: string; status?: 'running' | 'done' | 'error' }
  | { type: 'approval'; kind: 'exec' | 'edit' | 'tool'; title: string; detail: string; respond: (accept: boolean) => void }
  | { type: 'usage'; input?: number; output?: number; costUsd?: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type Emit = (event: AgentEvent) => void;

export interface AgentAdapter {
  readonly kind: AgentKind;
  /** CLI 존재 여부, 로그인 여부, 모델 목록 */
  status(): Promise<AgentStatus>;
  /** 한 턴 실행. done 또는 error 이벤트 후 resolve 한다. */
  run(ctx: RunContext, input: string, emit: Emit, signal: AbortSignal): Promise<void>;
  /** 진행 중인 턴 중단 */
  interrupt(participantId: string): Promise<void>;
  shutdown(): Promise<void>;
}

/** Windows 에서 npm 이 만든 .cmd 셸 래퍼도 실행되도록 spawn 인자를 만든다. */
export function spawnSpec(bin: string, args: string[]): { command: string; args: string[]; options: { windowsVerbatimArguments?: boolean } } {
  if (process.platform !== 'win32') return { command: bin, args, options: {} };
  const quote = (s: string) => (/^[\w\-./:\\=]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, '\\$1')}"`);
  const line = [bin, ...args].map(quote).join(' ');
  return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}
