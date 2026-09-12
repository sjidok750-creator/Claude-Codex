import type { Participant, RunnerStatus } from '@claude-codex/protocol';

interface Props { runner: RunnerStatus | null; connected: boolean; participants: Participant[] }

export function StatusBar({ runner, connected, participants }: Props) {
  const claude = participants.find((p) => p.kind === 'claude');
  const codex = participants.find((p) => p.kind === 'codex');
  const agent = (label: string, cls: string, st: RunnerStatus['claude'] | undefined, p: Participant | undefined) => {
    if (!st) return <span><span className={cls}>{label}</span> …</span>;
    const state = !st.available ? <span className="off">없음</span>
      : st.loggedIn === false ? <span className="warn">로그인 필요</span>
      : p && !p.enabled ? <span>muted</span>
      : <span className="on">ready</span>;
    return <span title={st.detail ?? undefined}><span className={cls}>{label}</span> {state}</span>;
  };
  return (
    <div className="statusbar">
      <span className={connected ? 'on' : 'off'}>● {connected ? 'connected' : 'disconnected'}</span>
      {runner && <span>{runner.hostname.replace(/\.local$/, '')}{runner.mock ? ' · MOCK' : ''}</span>}
      {agent('claude', 'c', runner?.claude, claude)}
      {agent('codex', 'x', runner?.codex, codex)}
    </div>
  );
}
