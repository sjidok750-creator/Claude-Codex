import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AgentStatus } from '@claude-codex/protocol';
import { CLAUDE_MODEL_ALIASES } from '@claude-codex/protocol';
import type { AgentAdapter, Emit, RunContext } from './types.js';
import { spawnSpec } from './types.js';

/**
 * Claude Code CLI 를 헤드리스(stream-json) 모드로 구동하는 어댑터.
 *
 * 참가자(=토픽의 Claude 자리)마다 장수 프로세스 하나를 둔다.
 *   claude -p --input-format stream-json --output-format stream-json ...
 * stdin 에 user 메시지 JSON 라인을 넣고, stdout 의 이벤트 라인을 읽는다.
 * 모델/권한/작업폴더가 바뀌면 프로세스를 내리고 --resume 으로 다시 띄운다(대화 맥락 유지).
 *
 * 구독 인증은 CLI 가 알아서 처리한다(`claude login` 또는 `claude setup-token`).
 */

interface Turn {
  emit: Emit;
  resolve: () => void;
  gotInit: boolean;
  toolInputs: Map<string, string>;
}

interface Proc {
  key: string;
  child: ChildProcessWithoutNullStreams;
  sessionId: string;
  signature: string;
  turn: Turn | null;
  idleTimer: NodeJS.Timeout | null;
  stderrTail: string[];
  exited: boolean;
  initialized: boolean;
  initWaiters: Array<(ok: boolean) => void>;
}

export interface ClaudeAdapterOptions {
  bin: string;
  idleMs: number;
  promptDir: string;
}

/** CLI 버전에 따라 달라지는 플래그. `claude --help` 를 한 번 읽어 결정한다. */
interface CliFeatures {
  version: string | null;
  appendSystemPromptFile: boolean; // --append-system-prompt-file (없으면 --append-system-prompt <텍스트>)
  permissionPrompts: boolean;      // --permission-prompts host (없으면 --permission-prompt-tool stdio)
  effort: boolean;
  name: boolean;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly kind = 'claude' as const;
  private procs = new Map<string, Proc>();
  private features: CliFeatures | null = null;

  constructor(private opts: ClaudeAdapterOptions) {
    fs.mkdirSync(opts.promptDir, { recursive: true });
  }

  private exec(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const spec = spawnSpec(this.opts.bin, args);
      execFile(spec.command, spec.args, { ...spec.options, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    });
  }

  private async detect(): Promise<CliFeatures | null> {
    if (this.features) return this.features;
    const version = await this.exec(['--version']);
    if (!version) return null;
    const help = (await this.exec(['--help'])) ?? '';
    this.features = {
      version: version.trim(),
      appendSystemPromptFile: help.includes('--append-system-prompt-file'),
      permissionPrompts: help.includes('--permission-prompts '),
      effort: help.includes('--effort'),
      name: help.includes('--name '),
    };
    return this.features;
  }

  async status(): Promise<AgentStatus> {
    const f = await this.detect();
    if (!f) {
      return { available: false, version: null, loggedIn: null, models: CLAUDE_MODEL_ALIASES, detail: `'${this.opts.bin}' 를 실행할 수 없습니다. Claude Code 설치와 PATH 를 확인하세요.` };
    }
    const legacy = !f.permissionPrompts || !f.appendSystemPromptFile;
    return {
      available: true, version: f.version, loggedIn: null, models: CLAUDE_MODEL_ALIASES,
      detail: (legacy ? '구버전 CLI 플래그로 동작 중. ' : '') + '로그인 여부는 첫 대화에서 확인됩니다 (claude login 또는 claude setup-token).',
    };
  }

  private signatureOf(ctx: RunContext): string {
    const p = ctx.participant;
    return JSON.stringify([p.model, p.effort, p.permissionMode, ctx.cwd, ctx.systemPrompt]);
  }

  private promptFile(ctx: RunContext): string {
    const file = path.join(this.opts.promptDir, `${ctx.participant.id}.md`);
    fs.writeFileSync(file, ctx.systemPrompt, 'utf8');
    return file;
  }

  private spawnProc(ctx: RunContext, sessionId: string, resume: boolean, f: CliFeatures): Proc {
    const p = ctx.participant;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode', p.permissionMode || 'acceptEdits',
      '--model', p.model || 'opus',
    ];
    // 승인 요청을 stdin/stdout 으로 받는 방법은 버전마다 다르다
    if (f.permissionPrompts) args.push('--permission-prompts', 'host');
    else args.push('--permission-prompt-tool', 'stdio');
    if (f.appendSystemPromptFile) args.push('--append-system-prompt-file', this.promptFile(ctx));
    else args.push('--append-system-prompt', ctx.systemPrompt);
    if (f.name) args.push('--name', `claude-codex:${ctx.topic.title}`.slice(0, 60));
    if (p.effort && f.effort) args.push('--effort', p.effort);
    if (resume) args.push('--resume', sessionId);
    else args.push('--session-id', sessionId);

    const spec = spawnSpec(this.opts.bin, args);
    const child = spawn(spec.command, spec.args, {
      cwd: ctx.cwd,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'claude-codex-hub' },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...spec.options,
    });

    const proc: Proc = {
      key: p.id, child, sessionId, signature: this.signatureOf(ctx), turn: null,
      idleTimer: null, stderrTail: [], exited: false, initialized: false, initWaiters: [],
    };

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => this.onLine(proc, line));
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      for (const l of text.split('\n')) if (l.trim()) proc.stderrTail.push(l.trim());
      if (proc.stderrTail.length > 40) proc.stderrTail.splice(0, proc.stderrTail.length - 40);
    });
    child.on('exit', (code) => {
      proc.exited = true;
      for (const w of proc.initWaiters) w(false);
      proc.initWaiters = [];
      if (proc.turn) {
        const tail = proc.stderrTail.slice(-6).join('\n');
        proc.turn.emit({ type: 'error', message: `Claude 프로세스가 종료됐습니다 (code ${code}).\n${tail}` });
        proc.turn.resolve();
        proc.turn = null;
      }
      if (this.procs.get(proc.key) === proc) this.procs.delete(proc.key);
    });
    child.on('error', (err) => {
      proc.stderrTail.push(String(err));
    });
    return proc;
  }

  private waitInit(proc: Proc, ms: number): Promise<boolean> {
    if (proc.initialized) return Promise.resolve(true);
    if (proc.exited) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(proc.initialized), ms);
      proc.initWaiters.push((ok) => { clearTimeout(t); resolve(ok); });
    });
  }

  private armIdle(proc: Proc): void {
    if (proc.idleTimer) clearTimeout(proc.idleTimer);
    proc.idleTimer = setTimeout(() => {
      if (!proc.turn) this.kill(proc);
    }, this.opts.idleMs);
  }

  private kill(proc: Proc): void {
    if (proc.idleTimer) clearTimeout(proc.idleTimer);
    try { proc.child.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (!proc.exited) proc.child.kill(); }, 2000);
    if (this.procs.get(proc.key) === proc) this.procs.delete(proc.key);
  }

  private onLine(proc: Proc, line: string): void {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    const turn = proc.turn;

    if (msg.type === 'system' && msg.subtype === 'init') {
      proc.initialized = true;
      if (typeof msg.session_id === 'string') proc.sessionId = msg.session_id;
      for (const w of proc.initWaiters) w(true);
      proc.initWaiters = [];
      turn?.emit({ type: 'session', sessionId: proc.sessionId });
      return;
    }

    if (msg.type === 'control_request') {
      this.onControlRequest(proc, msg);
      return;
    }

    if (!turn) return;

    if (msg.type === 'stream_event' && msg.parent_tool_use_id == null) {
      const ev = msg.event ?? {};
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        const id = ev.content_block.id as string;
        turn.toolInputs.set(id, '');
        turn.emit({ type: 'tool.start', id, name: ev.content_block.name, input: '' });
      } else if (ev.type === 'content_block_delta') {
        const d = ev.delta ?? {};
        if (d.type === 'text_delta' && typeof d.text === 'string') turn.emit({ type: 'text', delta: d.text });
      }
      return;
    }

    if (msg.type === 'assistant' && msg.parent_tool_use_id == null) {
      const content = msg.message?.content ?? [];
      for (const block of content) {
        if (block?.type === 'tool_use') {
          const input = JSON.stringify(block.input ?? {}, null, 2);
          if (!turn.toolInputs.has(block.id)) turn.emit({ type: 'tool.start', id: block.id, name: block.name, input });
          else turn.emit({ type: 'tool.update', id: block.id, input });
          turn.toolInputs.set(block.id, input);
        }
      }
      if (msg.error) turn.emit({ type: 'error', message: String(msg.error) });
      return;
    }

    if (msg.type === 'user' && msg.parent_tool_use_id == null) {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') {
            const out = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content) ? block.content.map((c: any) => c?.text ?? '').join('\n') : JSON.stringify(block.content ?? '');
            turn.emit({ type: 'tool.update', id: block.tool_use_id, output: out.slice(0, 20000), status: block.is_error ? 'error' : 'done' });
          }
        }
      }
      return;
    }

    if (msg.type === 'result') {
      const u = msg.usage ?? {};
      turn.emit({ type: 'usage', input: u.input_tokens, output: u.output_tokens, costUsd: msg.total_cost_usd });
      if (msg.is_error) {
        let text = typeof msg.result === 'string' && msg.result ? msg.result : (msg.subtype || 'unknown error');
        if (/authenticat|401|OAuth|login/i.test(text)) {
          text += '\n\n→ 허브 PC 터미널에서 `claude setup-token` 을 실행해 나온 토큰을 .env 의 CLAUDE_CODE_OAUTH_TOKEN= 에 넣고 허브를 재시작하세요. (또는 `claude` 안에서 /logout 후 /login)';
        }
        turn.emit({ type: 'error', message: text });
      } else {
        turn.emit({ type: 'done' });
      }
      proc.turn = null;
      turn.resolve();
      this.armIdle(proc);
    }
  }

  private onControlRequest(proc: Proc, msg: any): void {
    const req = msg.request ?? {};
    const requestId = msg.request_id as string;
    const reply = (response: Record<string, unknown>) => {
      this.write(proc, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    };
    const replyError = (error: string) => {
      this.write(proc, { type: 'control_response', response: { subtype: 'error', request_id: requestId, error } });
    };

    if (req.subtype === 'can_use_tool') {
      const toolName = String(req.tool_name ?? 'tool');
      const input = req.input ?? {};
      const title = toolName === 'Bash' && typeof input.command === 'string' ? `$ ${input.command}` : `${toolName}`;
      const detail = [req.decision_reason ? `사유: ${req.decision_reason}` : null, JSON.stringify(input, null, 2)].filter(Boolean).join('\n');
      const kind = toolName === 'Bash' ? 'exec' : /Edit|Write|MultiEdit|NotebookEdit/.test(toolName) ? 'edit' : 'tool';
      if (!proc.turn) { reply({ behavior: 'deny', message: '진행 중인 턴이 없어 거부됨' }); return; }
      proc.turn.emit({
        type: 'approval', kind, title, detail,
        respond: (accept) => reply(accept ? { behavior: 'allow' } : { behavior: 'deny', message: '사용자가 허브에서 거부했습니다', interrupt: false }),
      });
      return;
    }
    if (req.subtype === 'request_user_dialog' || req.subtype === 'elicitation') {
      replyError('claude-codex 허브는 이 대화상자를 지원하지 않습니다');
      return;
    }
    // hook callbacks 등 나머지는 성공으로 응답해 세션이 막히지 않게 한다.
    reply({});
  }

  private write(proc: Proc, obj: unknown): void {
    if (proc.exited) return;
    proc.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  private async getProc(ctx: RunContext, emit: Emit): Promise<Proc> {
    const key = ctx.participant.id;
    const sig = this.signatureOf(ctx);
    let proc = this.procs.get(key);
    if (proc && (proc.exited || proc.signature !== sig)) {
      this.kill(proc);
      proc = undefined;
    }
    if (proc) return proc;

    const f = await this.detect();
    if (!f) throw new Error(`'${this.opts.bin}' 를 실행할 수 없습니다. Claude Code 설치와 PATH 를 확인하세요.`);

    const existing = ctx.participant.agentSessionId;
    if (existing) {
      proc = this.spawnProc(ctx, existing, true, f);
      this.procs.set(key, proc);
      // --resume 실패(세션 파일 없음 등)는 init 없이 곧바로 종료된다 → 새 세션으로 재시도
      const ok = await this.waitInit(proc, 20000);
      if (ok || !proc.exited) return proc;
      this.procs.delete(key);
    }
    const fresh = randomUUID();
    proc = this.spawnProc(ctx, fresh, false, f);
    this.procs.set(key, proc);
    emit({ type: 'session', sessionId: fresh });
    return proc;
  }

  async run(ctx: RunContext, input: string, emit: Emit, signal: AbortSignal): Promise<void> {
    const proc = await this.getProc(ctx, emit);
    if (proc.turn) throw new Error('이 Claude 참가자는 이미 응답 중입니다');
    if (proc.idleTimer) clearTimeout(proc.idleTimer);

    await new Promise<void>((resolve) => {
      proc.turn = { emit, resolve, gotInit: proc.initialized, toolInputs: new Map() };
      const onAbort = () => this.write(proc, { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
      signal.addEventListener('abort', onAbort, { once: true });
      this.write(proc, { type: 'user', message: { role: 'user', content: input }, parent_tool_use_id: null, session_id: proc.sessionId });
    });
  }

  async interrupt(participantId: string): Promise<void> {
    const proc = this.procs.get(participantId);
    if (proc && proc.turn) this.write(proc, { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
  }

  async shutdown(): Promise<void> {
    for (const proc of this.procs.values()) this.kill(proc);
    this.procs.clear();
  }
}
