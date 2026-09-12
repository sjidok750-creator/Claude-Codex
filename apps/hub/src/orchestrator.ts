import fs from 'node:fs';
import path from 'node:path';
import type { AgentKind, Approval, Block, Message, Participant, Topic } from '@claude-codex/protocol';
import { PASS_TOKEN } from '@claude-codex/protocol';
import type { HubDb } from './db.js';
import type { Bus } from './bus.js';
import type { AgentAdapter, AgentEvent, RunContext } from './adapters/types.js';

export interface OrchestratorOptions {
  workspace: string;
  promptsDir: string;
  approvalTimeoutMs: number;
  /** 이 시간 동안 이벤트가 전혀 없으면 턴을 중단 */
  turnStallMs: number;
}

interface TopicRun {
  abort: AbortController;
  cancelled: boolean;
  active: Set<string>;
  promise: Promise<void>;
}

const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function parseMentions(text: string): Set<AgentKind> | null {
  const found = new Set<AgentKind>();
  const all = /(^|\s)@(all|모두|둘다|both)\b/i.test(text);
  if (/(^|\s)@claude\b/i.test(text) || /(^|\s)@클로드/.test(text)) found.add('claude');
  if (/(^|\s)@codex\b/i.test(text) || /(^|\s)@코덱스/.test(text)) found.add('codex');
  if (all) return null;
  return found.size ? found : null;
}

/**
 * 토픽의 턴 정책에 따라 에이전트들을 호출하고, 결과를 DB/버스에 반영한다.
 */
export class Orchestrator {
  private runs = new Map<string, TopicRun>();
  private pendingApprovals = new Map<string, { respond: (ok: boolean) => void; timer: NodeJS.Timeout }>();
  private trioPrompt: string;

  constructor(
    private db: HubDb,
    private bus: Bus,
    private adapters: Record<AgentKind, AgentAdapter>,
    private opts: OrchestratorOptions,
  ) {
    this.trioPrompt = fs.readFileSync(path.join(opts.promptsDir, 'trio.md'), 'utf8');
  }

  isActive(topicId: string): string[] {
    return [...(this.runs.get(topicId)?.active ?? [])];
  }

  /** 사용자가 메시지를 보냈다. 저장 후 정책에 따라 에이전트를 돌린다. */
  async onUserMessage(topic: Topic, text: string): Promise<Message> {
    const participants = this.db.listParticipants(topic.id);
    const me = participants.find((p) => p.kind === 'user')!;
    const msg = this.db.insertMessage({
      topicId: topic.id, participantId: me.id, kind: 'user', displayName: me.displayName,
      content: text, blocks: [], model: null, status: 'done', error: null, usage: null, round: 0,
    });
    this.bus.emit({ type: 'message.upsert', message: msg });

    // 진행 중인 relay 가 있으면 더 이상의 라운드를 취소하고, 현재 턴이 끝나길 기다린 뒤 시작
    const prev = this.runs.get(topic.id);
    if (prev) {
      prev.cancelled = true;
      await prev.promise.catch(() => {});
    }
    const fresh = this.db.getTopic(topic.id) ?? topic;
    const mentions = parseMentions(text);
    void this.startRun(fresh, mentions);
    return msg;
  }

  private startRun(topic: Topic, mentions: Set<AgentKind> | null): Promise<void> {
    const agents = this.db.listParticipants(topic.id).filter((p) => p.kind !== 'user' && p.enabled);
    const targets = mentions ? agents.filter((p) => mentions.has(p.kind as AgentKind)) : agents;
    if (targets.length === 0) return Promise.resolve();

    const run: TopicRun = { abort: new AbortController(), cancelled: false, active: new Set(), promise: Promise.resolve() };
    this.runs.set(topic.id, run);
    run.promise = this.execute(topic, targets, mentions !== null, run)
      .catch((e) => this.bus.emit({ type: 'system.notice', topicId: topic.id, text: `오케스트레이터 오류: ${(e as Error).message}` }))
      .finally(() => { if (this.runs.get(topic.id) === run) this.runs.delete(topic.id); });
    return run.promise;
  }

  private async execute(topic: Topic, targets: Participant[], explicit: boolean, run: TopicRun): Promise<void> {
    const ordered = [...targets].sort((a, b) => a.order - b.order);
    const policy = explicit && targets.length === 1 ? 'mention' : topic.turnPolicy;

    if (policy === 'roundtable' || policy === 'mention') {
      await Promise.all(ordered.map((p) => this.runAgent(topic, p.id, 1, run)));
      return;
    }
    if (policy === 'sequential') {
      for (const p of ordered) {
        if (run.cancelled) return;
        await this.runAgent(topic, p.id, 1, run);
      }
      return;
    }
    // relay: 라운드마다 순서대로 발언, 모두 PASS 면 종료
    const maxRounds = Math.max(1, topic.relayMaxRounds || 3);
    for (let round = 1; round <= maxRounds; round++) {
      let anySpoke = false;
      for (const p of ordered) {
        if (run.cancelled) return;
        const result = await this.runAgent(topic, p.id, round, run);
        if (result && result.status === 'done') anySpoke = true;
      }
      if (!anySpoke) break;
    }
    this.bus.emit({ type: 'system.notice', topicId: topic.id, text: run.cancelled ? '릴레이를 중단했습니다' : '릴레이가 끝났습니다. 이어서 말씀하세요.' });
  }

  private buildInput(topic: Topic, participant: Participant, unseen: Message[], round: number): string {
    const you = AGENT_LABEL[participant.kind as AgentKind];
    const lines = unseen.map((m) => {
      const from = m.kind === 'user' ? esc(m.displayName || '사용자') : AGENT_LABEL[m.kind as AgentKind];
      const model = m.model ? ` model="${esc(m.model)}"` : '';
      const body = m.status === 'passed' ? '(PASS)' : m.content;
      return `  <msg from="${from}"${model} at="${hhmm(m.createdAt)}">${esc(body)}</msg>`;
    });
    const policyNote = topic.turnPolicy === 'relay' ? ` policy="relay" round="${round}/${topic.relayMaxRounds}"` : ` policy="${topic.turnPolicy}"`;
    const lastUser = [...unseen].reverse().find((m) => m.kind === 'user');
    const pointed = lastUser && parseMentions(lastUser.content)?.has(participant.kind as AgentKind);
    const tail = pointed
      ? '사용자가 너를 직접 지목했다. 반드시 답하라.'
      : `위 대화에 이어서 답하라. 덧붙일 말이 없으면 정확히 ${PASS_TOKEN} 라고만 답하라.`;
    return `<chat topic="${esc(topic.title)}" you="${you}"${policyNote}>\n${lines.join('\n')}\n</chat>\n${tail}`;
  }

  private systemPromptFor(topic: Topic, participant: Participant): string {
    const parts = [this.trioPrompt.replace(/you="Claude"/g, `you="${AGENT_LABEL[participant.kind as AgentKind]}"`)];
    const user = this.db.listParticipants(topic.id).find((p) => p.kind === 'user');
    if (user && user.displayName && user.displayName !== '나') {
      parts.push(`# 사용자 호칭\n사용자의 이름은 "${user.displayName}" 이다. "사용자님" 대신 이 이름으로 자연스럽게 부른다.`);
    }
    if (topic.systemPrompt?.trim()) parts.push(`# 이 방(${topic.title})의 추가 규칙\n${topic.systemPrompt.trim()}`);
    return parts.join('\n\n');
  }

  private cwdFor(topic: Topic): string {
    const dir = topic.workingDir?.trim() || path.join(this.opts.workspace, topic.profile);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 에이전트 한 명에게 한 턴을 돌린다. 볼 게 없으면 null. */
  private async runAgent(topic: Topic, participantId: string, round: number, run: TopicRun): Promise<Message | null> {
    const participant = this.db.getParticipant(participantId);
    if (!participant || participant.kind === 'user') return null;
    const unseen = this.db.unseenFor(participant);
    if (unseen.length === 0) return null;
    const adapter = this.adapters[participant.kind];
    const input = this.buildInput(topic, participant, unseen, round);
    const ctx: RunContext = { topic, participant, systemPrompt: this.systemPromptFor(topic, participant), cwd: this.cwdFor(topic) };

    let message = this.db.insertMessage({
      topicId: topic.id, participantId: participant.id, kind: participant.kind, displayName: participant.displayName,
      content: '', blocks: [], model: participant.model, status: 'streaming', error: null, usage: null, round,
    });
    run.active.add(participant.id);
    this.bus.emit({ type: 'message.upsert', message });
    this.bus.emit({ type: 'topic.activity', topicId: topic.id, active: [...run.active] });

    let content = '';
    let blocks: Block[] = [];
    let usage: Message['usage'] = null;
    let error: string | null = null;
    let flushTimer: NodeJS.Timeout | null = null;
    const flushBlocks = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        message = this.db.updateMessage(message.id, { content, blocks })!;
        this.bus.emit({ type: 'message.upsert', message });
      }, 120);
    };

    const onEvent = (ev: AgentEvent) => {
      switch (ev.type) {
        case 'session':
          this.db.updateParticipant(participant.id, { agentSessionId: ev.sessionId });
          this.bus.emit({ type: 'participant.upsert', participant: this.db.getParticipant(participant.id)! });
          break;
        case 'text':
          if (!ev.delta) break;
          content += ev.delta;
          this.bus.emit({ type: 'message.delta', id: message.id, topicId: topic.id, delta: ev.delta });
          break;
        case 'tool.start':
          blocks = [...blocks, { type: 'tool', id: ev.id, name: ev.name, input: ev.input, output: '', status: 'running' }];
          flushBlocks();
          break;
        case 'tool.update':
          if (!blocks.some((b) => b.type === 'tool' && b.id === ev.id)) {
            blocks = [...blocks, { type: 'tool', id: ev.id, name: ev.id.startsWith('retry-') ? '재시도 중' : 'tool', input: ev.input ?? '', output: ev.output ?? '', status: ev.status ?? 'running' }];
          } else {
            blocks = blocks.map((b) => (b.type === 'tool' && b.id === ev.id
              ? { ...b, input: ev.input ?? b.input, output: ev.output ?? b.output, status: ev.status ?? b.status }
              : b));
          }
          flushBlocks();
          break;
        case 'approval':
          this.createApproval(topic, participant, message.id, ev);
          break;
        case 'usage':
          usage = { input: ev.input, output: ev.output, costUsd: ev.costUsd };
          break;
        case 'error':
          error = ev.message;
          break;
        case 'done':
          break;
      }
    };

    // 일정 시간 아무 이벤트도 없으면(네트워크 끊김 등) 턴을 끊는다
    let lastEventAt = Date.now();
    const wrapped = (ev: AgentEvent) => { lastEventAt = Date.now(); onEvent(ev); };
    const stallTimer = setInterval(() => {
      if (Date.now() - lastEventAt > this.opts.turnStallMs) {
        error = `${this.opts.turnStallMs / 60000}분 동안 응답이 없어 턴을 중단했습니다`;
        run.abort.abort();
        void adapter.interrupt(participant.id);
      }
    }, 15000);

    try {
      await adapter.run(ctx, input, wrapped, run.abort.signal);
    } catch (e) {
      error = error ?? (e as Error).message;
    } finally {
      clearInterval(stallTimer);
    }

    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const trimmed = content.trim();
    const passed = !error && trimmed.replace(/[.。!]$/, '').toUpperCase() === PASS_TOKEN;
    const status = error ? 'error' : passed ? 'passed' : 'done';
    // 끝났는데 아직 running 인 도구 블록은 정리
    blocks = blocks.map((b) => (b.type === 'tool' && b.status === 'running' ? { ...b, status: error ? 'error' : 'done' } : b));
    message = this.db.updateMessage(message.id, { content: passed ? '' : content, blocks, status, error, usage })!;
    // 방금 만든 내 메시지까지 포함해 커서를 옮긴다
    this.db.updateParticipant(participant.id, { cursorSeq: this.db.maxSeq(topic.id) });
    run.active.delete(participant.id);
    this.bus.emit({ type: 'message.upsert', message });
    this.bus.emit({ type: 'participant.upsert', participant: this.db.getParticipant(participant.id)! });
    this.bus.emit({ type: 'topic.activity', topicId: topic.id, active: [...run.active] });
    return message;
  }

  private createApproval(topic: Topic, participant: Participant, messageId: string, ev: Extract<AgentEvent, { type: 'approval' }>): void {
    const approval = this.db.insertApproval({ topicId: topic.id, participantId: participant.id, messageId, kind: ev.kind, title: ev.title, detail: ev.detail });
    const timer = setTimeout(() => this.decide(approval.id, 'expired'), this.opts.approvalTimeoutMs);
    this.pendingApprovals.set(approval.id, { respond: ev.respond, timer });
    this.bus.emit({ type: 'approval.upsert', approval });
  }

  decide(approvalId: string, decision: Approval['decision']): Approval | null {
    const pending = this.pendingApprovals.get(approvalId);
    const cur = this.db.getApproval(approvalId);
    if (!cur || cur.decision !== 'pending') return cur;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingApprovals.delete(approvalId);
      pending.respond(decision === 'accept');
    }
    const updated = this.db.decideApproval(approvalId, decision === 'accept' ? 'accept' : decision === 'expired' ? 'expired' : 'decline');
    if (updated) this.bus.emit({ type: 'approval.upsert', approval: updated });
    return updated;
  }

  async interrupt(topicId: string): Promise<void> {
    const run = this.runs.get(topicId);
    if (!run) return;
    run.cancelled = true;
    run.abort.abort();
    for (const pid of run.active) {
      const p = this.db.getParticipant(pid);
      if (p && p.kind !== 'user') await this.adapters[p.kind].interrupt(pid);
    }
  }

  async shutdown(): Promise<void> {
    for (const [id, p] of this.pendingApprovals) { clearTimeout(p.timer); p.respond(false); this.pendingApprovals.delete(id); }
    this.db.expirePendingApprovals();
    await Promise.all(Object.values(this.adapters).map((a) => a.shutdown()));
  }
}
