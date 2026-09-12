import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Approval, Block, Message, MessageStatus, Participant, ParticipantKind, Topic,
  CreateTopicInput, UpdateTopicInput, UpdateParticipantInput,
} from '@claude-codex/protocol';
import { DEFAULTS } from '@claude-codex/protocol';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '💬',
  turn_policy TEXT NOT NULL DEFAULT 'mention',
  relay_max_rounds INTEGER NOT NULL DEFAULT 3,
  system_prompt TEXT,
  working_dir TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  permission_mode TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 0,
  agent_session_id TEXT,
  cursor_seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS participants_topic ON participants(topic_id);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  participant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  blocks TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  status TEXT NOT NULL,
  error TEXT,
  usage TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_topic ON messages(topic_id, seq);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

type Row = Record<string, unknown>;

function rowToTopic(r: Row): Topic {
  return {
    id: r.id as string,
    profile: r.profile as Topic['profile'],
    title: r.title as string,
    emoji: r.emoji as string,
    turnPolicy: r.turn_policy as Topic['turnPolicy'],
    relayMaxRounds: Number(r.relay_max_rounds),
    systemPrompt: (r.system_prompt as string | null) ?? null,
    workingDir: (r.working_dir as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
  };
}

function rowToParticipant(r: Row): Participant {
  return {
    id: r.id as string,
    topicId: r.topic_id as string,
    kind: r.kind as ParticipantKind,
    displayName: r.display_name as string,
    model: (r.model as string | null) ?? null,
    effort: (r.effort as string | null) ?? null,
    permissionMode: (r.permission_mode as string | null) ?? null,
    enabled: Number(r.enabled) === 1,
    order: Number(r.ord),
    agentSessionId: (r.agent_session_id as string | null) ?? null,
    cursorSeq: Number(r.cursor_seq),
  };
}

function rowToMessage(r: Row): Message {
  return {
    id: r.id as string,
    seq: Number(r.seq),
    topicId: r.topic_id as string,
    participantId: r.participant_id as string,
    kind: r.kind as ParticipantKind,
    displayName: r.display_name as string,
    content: r.content as string,
    blocks: JSON.parse((r.blocks as string) || '[]') as Block[],
    model: (r.model as string | null) ?? null,
    status: r.status as MessageStatus,
    error: (r.error as string | null) ?? null,
    usage: r.usage ? JSON.parse(r.usage as string) : null,
    round: Number(r.round),
    createdAt: r.created_at as string,
  };
}

function rowToApproval(r: Row): Approval {
  return {
    id: r.id as string,
    topicId: r.topic_id as string,
    participantId: r.participant_id as string,
    messageId: (r.message_id as string | null) ?? null,
    kind: r.kind as Approval['kind'],
    title: r.title as string,
    detail: r.detail as string,
    decision: r.decision as Approval['decision'],
    createdAt: r.created_at as string,
  };
}

export class HubDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  // ---------- topics ----------
  listTopics(): Topic[] {
    return (this.db.prepare('SELECT * FROM topics ORDER BY updated_at DESC').all() as Row[]).map(rowToTopic);
  }

  getTopic(id: string): Topic | null {
    const r = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToTopic(r) : null;
  }

  createTopic(input: CreateTopicInput): { topic: Topic; participants: Participant[] } {
    const id = randomUUID();
    const t = now();
    this.db.prepare(
      `INSERT INTO topics (id, profile, title, emoji, turn_policy, relay_max_rounds, system_prompt, working_dir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.profile, input.title, input.emoji ?? '', input.turnPolicy ?? 'mention', DEFAULTS.relayMaxRounds,
      input.systemPrompt ?? null, input.workingDir ?? null, t, t);

    const mk = this.db.prepare(
      `INSERT INTO participants (id, topic_id, kind, display_name, model, effort, permission_mode, enabled, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    mk.run(randomUUID(), id, 'user', '나', null, null, null, 0);
    mk.run(randomUUID(), id, 'claude', 'Claude', input.claudeModel ?? DEFAULTS.claudeModel, DEFAULTS.claudeEffort, DEFAULTS.claudePermissionMode, 1);
    mk.run(randomUUID(), id, 'codex', 'Codex', input.codexModel ?? DEFAULTS.codexModel, DEFAULTS.codexEffort, DEFAULTS.codexSandbox, 2);
    return { topic: this.getTopic(id)!, participants: this.listParticipants(id) };
  }

  updateTopic(id: string, patch: UpdateTopicInput): Topic | null {
    const cur = this.getTopic(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare(
      `UPDATE topics SET title=?, emoji=?, turn_policy=?, relay_max_rounds=?, system_prompt=?, working_dir=?, archived_at=?, updated_at=? WHERE id=?`,
    ).run(next.title, next.emoji, next.turnPolicy, next.relayMaxRounds, next.systemPrompt, next.workingDir, next.archivedAt, now(), id);
    return this.getTopic(id);
  }

  touchTopic(id: string): void {
    this.db.prepare('UPDATE topics SET updated_at=? WHERE id=?').run(now(), id);
  }

  // ---------- participants ----------
  listParticipants(topicId?: string): Participant[] {
    const rows = topicId
      ? this.db.prepare('SELECT * FROM participants WHERE topic_id = ? ORDER BY ord').all(topicId)
      : this.db.prepare('SELECT * FROM participants ORDER BY topic_id, ord').all();
    return (rows as Row[]).map(rowToParticipant);
  }

  getParticipant(id: string): Participant | null {
    const r = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToParticipant(r) : null;
  }

  updateParticipant(id: string, patch: UpdateParticipantInput & { agentSessionId?: string | null; cursorSeq?: number }): Participant | null {
    const cur = this.getParticipant(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare(
      `UPDATE participants SET display_name=?, model=?, effort=?, permission_mode=?, enabled=?, ord=?, agent_session_id=?, cursor_seq=? WHERE id=?`,
    ).run(next.displayName, next.model, next.effort, next.permissionMode, next.enabled ? 1 : 0, next.order, next.agentSessionId, next.cursorSeq, id);
    return this.getParticipant(id);
  }

  // ---------- messages ----------
  listMessages(topicId: string, afterSeq = 0, limit = 500): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE topic_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(topicId, afterSeq, limit) as Row[];
    return rows.map(rowToMessage);
  }

  /** 특정 참가자가 아직 보지 않은(그리고 본인이 쓰지 않은) 메시지 */
  unseenFor(participant: Participant): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE topic_id = ? AND seq > ? AND participant_id <> ? AND status IN (\'done\',\'passed\') ORDER BY seq')
      .all(participant.topicId, participant.cursorSeq, participant.id) as Row[];
    return rows.map(rowToMessage);
  }

  maxSeq(topicId: string): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM messages WHERE topic_id = ?').get(topicId) as Row;
    return Number(r.m);
  }

  insertMessage(m: Omit<Message, 'seq' | 'id' | 'createdAt'> & { id?: string }): Message {
    const id = m.id ?? randomUUID();
    const t = now();
    this.db.prepare(
      `INSERT INTO messages (id, topic_id, participant_id, kind, display_name, content, blocks, model, status, error, usage, round, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, m.topicId, m.participantId, m.kind, m.displayName, m.content, JSON.stringify(m.blocks), m.model, m.status, m.error,
      m.usage ? JSON.stringify(m.usage) : null, m.round, t);
    this.touchTopic(m.topicId);
    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToMessage(r) : null;
  }

  updateMessage(id: string, patch: Partial<Pick<Message, 'content' | 'blocks' | 'status' | 'error' | 'usage' | 'model'>>): Message | null {
    const cur = this.getMessage(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE messages SET content=?, blocks=?, status=?, error=?, usage=?, model=? WHERE id=?')
      .run(next.content, JSON.stringify(next.blocks), next.status, next.error, next.usage ? JSON.stringify(next.usage) : null, next.model, id);
    return this.getMessage(id);
  }

  /** 서버가 비정상 종료됐을 때 남은 streaming 메시지를 error 로 정리 */
  failStaleStreaming(): number {
    const r = this.db.prepare("UPDATE messages SET status='error', error='허브가 재시작되어 응답이 끊겼습니다' WHERE status='streaming'").run();
    return Number(r.changes);
  }

  // ---------- approvals ----------
  insertApproval(a: Omit<Approval, 'id' | 'createdAt' | 'decision'>): Approval {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO approvals (id, topic_id, participant_id, message_id, kind, title, detail, decision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, a.topicId, a.participantId, a.messageId, a.kind, a.title, a.detail, now());
    return this.getApproval(id)!;
  }

  getApproval(id: string): Approval | null {
    const r = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToApproval(r) : null;
  }

  decideApproval(id: string, decision: Approval['decision']): Approval | null {
    this.db.prepare('UPDATE approvals SET decision=? WHERE id=?').run(decision, id);
    return this.getApproval(id);
  }

  listPendingApprovals(topicId?: string): Approval[] {
    const rows = topicId
      ? this.db.prepare("SELECT * FROM approvals WHERE decision='pending' AND topic_id=? ORDER BY created_at").all(topicId)
      : this.db.prepare("SELECT * FROM approvals WHERE decision='pending' ORDER BY created_at").all();
    return (rows as Row[]).map(rowToApproval);
  }

  expirePendingApprovals(): void {
    this.db.prepare("UPDATE approvals SET decision='expired' WHERE decision='pending'").run();
  }

  close(): void {
    this.db.close();
  }
}
