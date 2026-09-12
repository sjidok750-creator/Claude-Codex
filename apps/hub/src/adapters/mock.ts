import { randomUUID } from 'node:crypto';
import type { AgentKind, AgentStatus } from '@claude-codex/protocol';
import { CLAUDE_MODEL_ALIASES } from '@claude-codex/protocol';
import type { AgentAdapter, Emit, RunContext } from './types.js';

/**
 * 실제 CLI 없이 UI 와 대화 흐름을 개발·시험하기 위한 가짜 에이전트.
 * MOCK_AGENTS=1 로 허브를 띄우면 사용된다.
 */
export class MockAdapter implements AgentAdapter {
  private sessions = new Map<string, string>();

  constructor(readonly kind: AgentKind) {}

  async status(): Promise<AgentStatus> {
    return {
      available: true, version: 'mock', loggedIn: true,
      models: this.kind === 'claude'
        ? CLAUDE_MODEL_ALIASES
        : [
          { id: 'gpt-6-astra', label: 'GPT-6-Astra (mock)', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'low', isDefault: true },
          { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol (mock)', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'low' },
          { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra (mock)', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
        ],
      detail: '가짜 에이전트 (MOCK_AGENTS=1)',
    };
  }

  async run(ctx: RunContext, input: string, emit: Emit, signal: AbortSignal): Promise<void> {
    const key = ctx.participant.id;
    if (!this.sessions.has(key)) {
      const id = randomUUID();
      this.sessions.set(key, id);
      emit({ type: 'session', sessionId: id });
    }
    const me = this.kind === 'claude' ? 'Claude' : 'Codex';
    const other = this.kind === 'claude' ? 'Codex' : 'Claude';
    const lastUser = [...input.matchAll(/<msg from="(?!Claude"|Codex")[^"]*"[^>]*>([\s\S]*?)<\/msg>/g)].pop()?.[1]?.trim() ?? '';
    // 마지막 사용자 메시지가 상대만 지목했으면 넘긴다
    const mentionsOther = new RegExp(`@${other.toLowerCase()}`, 'i').test(lastUser) && !new RegExp(`@${me.toLowerCase()}|@all|@모두`, 'i').test(lastUser);
    const lastOther = [...input.matchAll(new RegExp(`<msg from="${other}"[^>]*>([\\s\\S]*?)</msg>`, 'g'))].pop()?.[1]?.trim();

    const say = async (text: string) => {
      for (const chunk of text.match(/.{1,6}/gs) ?? []) {
        if (signal.aborted) return;
        emit({ type: 'text', delta: chunk });
        await new Promise((r) => setTimeout(r, 25));
      }
    };

    if (mentionsOther) {
      await say('PASS');
    } else {
      if (/파일|코드|디렉토리|실행/.test(lastUser ?? '')) {
        const id = randomUUID();
        emit({ type: 'tool.start', id, name: this.kind === 'claude' ? 'Bash' : 'shell', input: 'ls -la' });
        await new Promise((r) => setTimeout(r, 400));
        emit({ type: 'tool.update', id, output: 'total 0\n(mock) 작업 폴더가 비어 있습니다', status: 'done' });
      }
      const parts = [
        lastUser ? `${me} 입니다. "${lastUser.slice(0, 40)}${lastUser.length > 40 ? '…' : ''}" 에 대해 제 생각을 말할게요.` : `${me} 입니다.`,
        lastOther ? ` ${other}, 네 의견 중 "${lastOther.slice(0, 30)}…" 부분은 동의하지만 한 가지 보탤 게 있어.` : '',
        this.kind === 'claude'
          ? ' 먼저 전제를 정리하고, 선택지를 두세 개로 좁힌 뒤 하나를 권하는 방식이 좋겠어요. (mock 응답, 모델: ' + (ctx.participant.model ?? '?') + ')'
          : ' 나는 바로 실행 가능한 순서대로 정리하는 걸 선호해. 1) 목표 2) 제약 3) 첫 행동. (mock 응답, 모델: ' + (ctx.participant.model ?? '?') + ')',
      ];
      await say(parts.join(''));
    }
    emit({ type: 'usage', input: 120, output: 60 });
    emit({ type: 'done' });
  }

  async interrupt(): Promise<void> { /* noop */ }
  async shutdown(): Promise<void> { /* noop */ }
}
