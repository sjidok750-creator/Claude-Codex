// 허브 ↔ 웹 ↔ (향후) 러너가 공유하는 타입 정의.
// 런타임 의존성 없이 타입만 둔다. 서버와 클라이언트 모두 여기서 import 한다.

export type ProfileId = 'work' | 'personal';
export type ParticipantKind = 'user' | 'claude' | 'codex';
export type AgentKind = Exclude<ParticipantKind, 'user'>;

/** 토픽별 턴 정책. PLAN.md §3.4 참고. */
export type TurnPolicy = 'roundtable' | 'sequential' | 'mention' | 'relay';

export interface Topic {
  id: string;
  profile: ProfileId;
  title: string;
  emoji: string;
  turnPolicy: TurnPolicy;
  /** relay 정책에서 에이전트끼리 주고받는 최대 라운드 수 */
  relayMaxRounds: number;
  /** 토픽 전용 추가 시스템 프롬프트 */
  systemPrompt: string | null;
  /** 에이전트가 파일·명령을 다룰 작업 디렉토리. null이면 허브 기본 워크스페이스 */
  workingDir: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Participant {
  id: string;
  topicId: string;
  kind: ParticipantKind;
  displayName: string;
  /** 에이전트 모델 id 또는 별칭. user는 null */
  model: string | null;
  /** 노력 수준(effort). 에이전트마다 허용값이 다르다 */
  effort: string | null;
  /** Claude: permission-mode, Codex: sandbox 모드 */
  permissionMode: string | null;
  enabled: boolean;
  /** sequential/relay 에서 발언 순서 */
  order: number;
  /** Claude session uuid / Codex threadId */
  agentSessionId: string | null;
  /** 이 참가자가 마지막으로 읽은 메시지 seq */
  cursorSeq: number;
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: string; output: string; status: 'running' | 'done' | 'error' }
  | { type: 'thinking'; text: string };

export type MessageStatus = 'streaming' | 'done' | 'error' | 'passed';

export interface Message {
  id: string;
  seq: number;
  topicId: string;
  participantId: string;
  kind: ParticipantKind;
  displayName: string;
  /** 본문(마크다운). 스트리밍 중에는 누적 텍스트 */
  content: string;
  blocks: Block[];
  model: string | null;
  status: MessageStatus;
  error: string | null;
  usage: { input?: number; output?: number; costUsd?: number } | null;
  /** relay 라운드 번호. 사용자 메시지는 0 */
  round: number;
  createdAt: string;
}

export interface Approval {
  id: string;
  topicId: string;
  participantId: string;
  messageId: string | null;
  kind: 'exec' | 'edit' | 'tool';
  title: string;
  detail: string;
  decision: 'pending' | 'accept' | 'decline' | 'expired';
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string | null;
  isDefault?: boolean;
}

export interface AgentStatus {
  available: boolean;
  version: string | null;
  loggedIn: boolean | null;
  models: ModelInfo[];
  detail: string | null;
}

export interface RunnerStatus {
  hostname: string;
  mock: boolean;
  claude: AgentStatus;
  codex: AgentStatus;
  workspace: string;
}

export interface HubState {
  topics: Topic[];
  participants: Participant[];
  runner: RunnerStatus;
}

/** 서버 → 클라이언트 실시간 이벤트 (WebSocket) */
export type ServerEvent =
  | { type: 'hello'; state: HubState }
  | { type: 'topic.upsert'; topic: Topic }
  | { type: 'topic.delete'; id: string }
  | { type: 'participant.upsert'; participant: Participant }
  | { type: 'message.upsert'; message: Message }
  | { type: 'message.delta'; id: string; topicId: string; delta: string }
  | { type: 'approval.upsert'; approval: Approval }
  | { type: 'runner.status'; runner: RunnerStatus }
  | { type: 'topic.activity'; topicId: string; active: string[] }
  | { type: 'system.notice'; topicId: string | null; text: string };

export interface CreateTopicInput {
  profile: ProfileId;
  title: string;
  emoji?: string;
  turnPolicy?: TurnPolicy;
  systemPrompt?: string | null;
  workingDir?: string | null;
  claudeModel?: string | null;
  codexModel?: string | null;
}

export type UpdateTopicInput = Partial<Pick<Topic, 'title' | 'emoji' | 'turnPolicy' | 'relayMaxRounds' | 'systemPrompt' | 'workingDir' | 'archivedAt'>>;
export type UpdateParticipantInput = Partial<Pick<Participant, 'displayName' | 'model' | 'effort' | 'permissionMode' | 'enabled' | 'order'>>;

export const DEFAULTS = {
  claudeModel: 'sonnet',
  claudeEffort: 'medium',
  claudePermissionMode: 'acceptEdits',
  codexModel: 'gpt-5.6-sol',
  codexEffort: 'medium',
  codexSandbox: 'workspace-write',
  relayMaxRounds: 2,
} as const;

export const CLAUDE_MODEL_ALIASES: ModelInfo[] = [
  { id: 'opus', label: 'Opus (alias: opus)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
  { id: 'sonnet', label: 'Sonnet (alias: sonnet)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', isDefault: true },
  { id: 'fable', label: 'Fable (alias: fable)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
  { id: 'haiku', label: 'Haiku (alias: haiku)', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'opusplan', label: 'Opus 계획 + Sonnet 실행 (opusplan)', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
];

/** 답할 말이 없을 때 에이전트가 보내는 약속된 토큰 */
export const PASS_TOKEN = 'PASS';
