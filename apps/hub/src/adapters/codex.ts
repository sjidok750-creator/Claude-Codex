import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { AgentStatus, ModelInfo } from '@claude-codex/protocol';
import type { AgentAdapter, Emit, RunContext } from './types.js';
import { spawnSpec } from './types.js';

/**
 * Codex CLI 의 `codex app-server`(JSON-RPC 2.0 over stdio) 를 구동하는 어댑터.
 *
 * 허브당 app-server 프로세스 하나를 오래 띄워 두고, 참가자(토픽의 Codex 자리)마다 thread 를 만든다.
 *   thread/start | thread/resume  →  turn/start { model, effort, cwd, ... }
 * 알림(item/agentMessage/delta, item/started, item/completed, turn/completed)을 스트리밍으로 받고,
 * 승인 요청(item/commandExecution/requestApproval 등)은 서버→클라이언트 요청으로 오므로 응답해 준다.
 *
 * 인증은 `codex login`(ChatGPT 계정) 상태를 그대로 쓴다.
 */

interface Pending { resolve: (v: any) => void; reject: (e: Error) => void }

interface ActiveRun {
  emit: Emit;
  resolve: () => void;
  turnId: string | null;
  itemText: Map<string, boolean>; // agentMessage item 에 delta 를 받았는지
  lastError: string | null;
}

export interface CodexAdapterOptions {
  bin: string;
  cwd: string;
}

export class CodexAdapter implements AgentAdapter {
  readonly kind = 'codex' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private runsByThread = new Map<string, ActiveRun>();
  private threadByParticipant = new Map<string, string>();
  private ready: Promise<void> | null = null;
  private stderrTail: string[] = [];
  private modelsCache: ModelInfo[] | null = null;
  private loggedIn = false;

  constructor(private opts: CodexAdapterOptions) {}

  // ---------- process & rpc ----------
  private ensureProcess(): Promise<void> {
    if (this.ready && this.child && this.child.exitCode === null) return this.ready;
    const spec = spawnSpec(this.opts.bin, ['app-server']);
    const child = spawn(spec.command, spec.args, {
      cwd: this.opts.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...spec.options,
    });
    this.child = child;
    this.pending.clear();
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => this.onLine(line));
    child.stderr.on('data', (d: Buffer) => {
      for (const l of d.toString().split('\n')) if (l.trim()) this.stderrTail.push(l.trim());
      if (this.stderrTail.length > 40) this.stderrTail.splice(0, this.stderrTail.length - 40);
    });
    child.on('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`codex app-server 종료 (code ${code})`));
      this.pending.clear();
      for (const run of this.runsByThread.values()) {
        run.emit({ type: 'error', message: `codex app-server 가 종료됐습니다 (code ${code}).\n${this.stderrTail.slice(-5).join('\n')}` });
        run.resolve();
      }
      this.runsByThread.clear();
      this.ready = null;
      this.child = null;
    });

    this.ready = (async () => {
      await this.request('initialize', {
        clientInfo: { name: 'claude-codex', title: 'Claude-Codex Hub', version: '0.1.0' },
        capabilities: { experimentalApi: false, optOutNotificationMethods: ['item/reasoning/textDelta', 'item/reasoning/summaryTextDelta'] },
      });
      this.notify('initialized', {});
    })();
    return this.ready;
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const child = this.child;
    if (!child) return Promise.reject(new Error('codex app-server 가 없습니다'));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(JSON.stringify({ method, params }) + '\n');
  }

  private respond(id: unknown, result: unknown): void {
    this.child?.stdin.write(JSON.stringify({ id, result }) + '\n');
  }

  private respondError(id: unknown, message: string): void {
    this.child?.stdin.write(JSON.stringify({ id, error: { code: -32601, message } }) + '\n');
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    // 응답
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    // 서버 → 클라이언트 요청 (승인 등)
    if (msg.id !== undefined && msg.method) {
      this.onServerRequest(msg);
      return;
    }
    // 알림
    if (msg.method) this.onNotification(msg.method as string, msg.params ?? {});
  }

  private onServerRequest(msg: any): void {
    const { id, method, params } = msg;
    const run = params?.threadId ? this.runsByThread.get(params.threadId) : undefined;
    if (!run) { this.respondError(id, '활성 턴이 없습니다'); return; }

    if (method === 'item/commandExecution/requestApproval') {
      const cmd = params.command ? String(params.command) : '(명령)';
      const title = `$ ${cmd}`;
      const detail = [params.reason ? `사유: ${params.reason}` : null, params.cwd ? `cwd: ${params.cwd}` : null].filter(Boolean).join('\n') || cmd;
      run.emit({ type: 'approval', kind: 'exec', title, detail, respond: (ok) => this.respond(id, { decision: ok ? 'accept' : 'decline' }) });
      return;
    }
    if (method === 'item/fileChange/requestApproval') {
      const detail = [params.reason ? `사유: ${params.reason}` : null, params.grantRoot ? `쓰기 허용 요청: ${params.grantRoot}` : null].filter(Boolean).join('\n') || '파일 변경 승인 요청';
      run.emit({ type: 'approval', kind: 'edit', title: '파일 변경 승인', detail, respond: (ok) => this.respond(id, { decision: ok ? 'accept' : 'decline' }) });
      return;
    }
    if (method === 'item/permissions/requestApproval') {
      const detail = params.reason ? `사유: ${params.reason}\n${JSON.stringify(params.permissions ?? {}, null, 2)}` : JSON.stringify(params.permissions ?? {}, null, 2);
      run.emit({
        type: 'approval', kind: 'tool', title: '추가 권한 요청', detail,
        respond: (ok) => ok
          ? this.respond(id, { permissions: params.permissions ?? {}, scope: 'turn' })
          : this.respondError(id, '사용자가 거부했습니다'),
      });
      return;
    }
    this.respondError(id, `허브가 지원하지 않는 요청: ${method}`);
  }

  private onNotification(method: string, params: any): void {
    const threadId = params.threadId as string | undefined;
    const run = threadId ? this.runsByThread.get(threadId) : undefined;
    if (!run) return;
    if (run.turnId && params.turnId && params.turnId !== run.turnId) return;

    switch (method) {
      case 'item/agentMessage/delta': {
        run.itemText.set(params.itemId, true);
        run.emit({ type: 'text', delta: String(params.delta ?? '') });
        return;
      }
      case 'item/started': {
        const item = params.item ?? {};
        if (item.type === 'commandExecution') run.emit({ type: 'tool.start', id: item.id, name: 'shell', input: String(item.command ?? '') });
        else if (item.type === 'fileChange') run.emit({ type: 'tool.start', id: item.id, name: 'apply_patch', input: (item.changes ?? []).map((c: any) => `${c.kind} ${c.path}`).join('\n') });
        else if (item.type === 'mcpToolCall') run.emit({ type: 'tool.start', id: item.id, name: `${item.server}/${item.tool}`, input: JSON.stringify(item.arguments ?? {}, null, 2) });
        else if (item.type === 'webSearch' || item.type === 'dynamicToolCall') run.emit({ type: 'tool.start', id: item.id, name: item.type === 'webSearch' ? 'web_search' : String(item.tool ?? 'tool'), input: JSON.stringify(item.arguments ?? item.query ?? '', null, 2) });
        return;
      }
      case 'item/completed': {
        const item = params.item ?? {};
        if (item.type === 'agentMessage') {
          // delta 를 한 번도 못 받은 경우(설정에 따라) 완성본을 텍스트로 넣는다
          if (!run.itemText.get(item.id) && typeof item.text === 'string') run.emit({ type: 'text', delta: item.text });
        } else if (item.type === 'commandExecution') {
          const status = item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0) ? 'error' : item.status === 'declined' ? 'error' : 'done';
          run.emit({ type: 'tool.update', id: item.id, output: String(item.aggregatedOutput ?? '').slice(0, 20000), status });
        } else if (item.type === 'fileChange') {
          run.emit({ type: 'tool.update', id: item.id, output: (item.changes ?? []).map((c: any) => c.diff ?? '').join('\n').slice(0, 20000), status: item.status === 'failed' ? 'error' : 'done' });
        } else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'webSearch') {
          const out = item.result ? JSON.stringify(item.result).slice(0, 20000) : item.error ? JSON.stringify(item.error) : '';
          run.emit({ type: 'tool.update', id: item.id, output: out, status: item.error || item.status === 'failed' ? 'error' : 'done' });
        }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const last = params.tokenUsage?.last ?? {};
        run.emit({ type: 'usage', input: last.inputTokens, output: last.outputTokens });
        return;
      }
      case 'error': {
        const detail = params.error?.additionalDetails ? ` (${String(params.error.additionalDetails).slice(0, 200)})` : '';
        run.lastError = String(params.error?.message ?? 'unknown error') + detail;
        // 재시도 중인 상태를 사용자에게 보이도록 도구 블록으로 알린다
        if (params.willRetry) run.emit({ type: 'tool.update', id: `retry-${threadId}`, output: run.lastError, status: 'running' });
        return;
      }
      case 'turn/completed': {
        const turn = params.turn ?? {};
        if (turn.status === 'failed') run.emit({ type: 'error', message: turn.error?.message ?? run.lastError ?? 'Codex 턴 실패' });
        else run.emit({ type: 'done' });
        this.runsByThread.delete(threadId!);
        run.resolve();
        return;
      }
      default:
        return;
    }
  }

  // ---------- public ----------
  async status(): Promise<AgentStatus> {
    const version = await new Promise<string | null>((resolve) => {
      const spec = spawnSpec(this.opts.bin, ['--version']);
      execFile(spec.command, spec.args, { ...spec.options, timeout: 15000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    });
    if (!version) {
      return { available: false, version: null, loggedIn: null, models: [], detail: `'${this.opts.bin}' 를 실행할 수 없습니다. Codex CLI 설치와 PATH 를 확인하세요 (npm i -g @openai/codex).` };
    }
    try {
      await this.ensureProcess();
      const [account, models] = await Promise.all([
        this.request('account/read', {}).catch(() => null),
        this.request('model/list', {}).catch(() => null),
      ]);
      const list: ModelInfo[] = (models?.data ?? [])
        .filter((m: any) => !m.hidden)
        .map((m: any) => ({
          id: m.id, label: m.displayName || m.id,
          efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => e.reasoningEffort),
          defaultEffort: m.defaultReasoningEffort ?? null, isDefault: !!m.isDefault,
        }));
      if (list.length) this.modelsCache = list;
      const loggedIn = account ? !!account.account : null;
      this.loggedIn = loggedIn === true;
      return {
        available: true, version, loggedIn, models: list,
        detail: loggedIn === false ? '로그인이 필요합니다: 허브를 돌리는 PC 에서 `codex login` 을 실행하세요.' : account?.account?.type ? `로그인: ${account.account.type}` : null,
      };
    } catch (e) {
      return { available: true, version, loggedIn: null, models: this.modelsCache ?? [], detail: `app-server 초기화 실패: ${(e as Error).message}` };
    }
  }

  private async ensureThread(ctx: RunContext, emit: Emit): Promise<string> {
    const p = ctx.participant;
    const cached = this.threadByParticipant.get(p.id);
    if (cached && cached === p.agentSessionId) return cached;

    const common = {
      model: p.model || undefined,
      cwd: ctx.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: p.permissionMode || 'workspace-write',
      developerInstructions: ctx.systemPrompt,
    };
    if (p.agentSessionId) {
      try {
        const res = await this.request('thread/resume', { threadId: p.agentSessionId, excludeTurns: true, ...common });
        const id = res?.thread?.id ?? p.agentSessionId;
        this.threadByParticipant.set(p.id, id);
        return id;
      } catch (e) {
        emit({ type: 'text', delta: '' });
        // 세션 파일이 사라졌거나 버전이 바뀐 경우 새 스레드로 진행
      }
    }
    const res = await this.request('thread/start', common);
    const id = res.thread.id as string;
    this.threadByParticipant.set(p.id, id);
    emit({ type: 'session', sessionId: id });
    return id;
  }

  async run(ctx: RunContext, input: string, emit: Emit, signal: AbortSignal): Promise<void> {
    await this.ensureProcess();
    // 로그인이 안 돼 있으면 turn/start 가 재시도만 반복하므로 먼저 확인해 빨리 실패시킨다
    if (!this.loggedIn) {
      const account = await this.request('account/read', {}).catch(() => null);
      this.loggedIn = !!account?.account;
      if (!this.loggedIn) throw new Error('Codex 에 로그인되어 있지 않습니다. 허브를 돌리는 PC 에서 `codex login` 을 실행한 뒤 다시 보내세요.');
    }
    const threadId = await this.ensureThread(ctx, emit);
    if (this.runsByThread.has(threadId)) throw new Error('이 Codex 참가자는 이미 응답 중입니다');

    await new Promise<void>((resolve, reject) => {
      const run: ActiveRun = { emit, resolve, turnId: null, itemText: new Map(), lastError: null };
      this.runsByThread.set(threadId, run);
      const onAbort = () => { if (run.turnId) this.request('turn/interrupt', { threadId, turnId: run.turnId }).catch(() => {}); };
      signal.addEventListener('abort', onAbort, { once: true });

      this.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: input, text_elements: [] }],
        model: ctx.participant.model || undefined,
        effort: ctx.participant.effort || undefined,
        cwd: ctx.cwd,
        approvalsReviewer: 'user',
      }).then((res) => {
        run.turnId = res?.turn?.id ?? null;
      }).catch((e: Error) => {
        this.runsByThread.delete(threadId);
        emit({ type: 'error', message: `turn/start 실패: ${e.message}` });
        resolve();
      });
    });
  }

  async interrupt(participantId: string): Promise<void> {
    const threadId = this.threadByParticipant.get(participantId);
    const run = threadId ? this.runsByThread.get(threadId) : undefined;
    if (threadId && run?.turnId) await this.request('turn/interrupt', { threadId, turnId: run.turnId }).catch(() => {});
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child) {
      try { child.stdin.end(); } catch { /* ignore */ }
      setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500);
    }
  }
}
