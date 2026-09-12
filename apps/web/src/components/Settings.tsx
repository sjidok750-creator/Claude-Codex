import { useEffect, useState } from 'react';
import type { Participant, RunnerStatus, Topic, TurnPolicy } from '@claude-codex/protocol';
import { api } from '../api';

interface Props {
  open: boolean;
  topic: Topic;
  participants: Participant[];
  runner: RunnerStatus | null;
  onClose: () => void;
  onArchived: () => void;
}

const CLAUDE_PERMS = [
  { id: 'plan', label: 'plan (읽기만)' },
  { id: 'acceptEdits', label: 'acceptEdits (파일 수정 자동, 명령은 승인)' },
  { id: 'auto', label: 'auto (분류기 판단)' },
  { id: 'dontAsk', label: 'dontAsk (묻지 않음, 규칙 밖은 거부)' },
  { id: 'bypassPermissions', label: 'bypassPermissions (전부 허용, 위험)' },
];
const CODEX_SANDBOX = [
  { id: 'read-only', label: 'read-only' },
  { id: 'workspace-write', label: 'workspace-write (작업 폴더만 쓰기)' },
  { id: 'danger-full-access', label: 'danger-full-access (위험)' },
];

export function Settings({ open, topic, participants, runner, onClose, onArchived }: Props) {
  const [title, setTitle] = useState(topic.title);
  const [prompt, setPrompt] = useState(topic.systemPrompt ?? '');
  const [dir, setDir] = useState(topic.workingDir ?? '');
  useEffect(() => { setTitle(topic.title); setPrompt(topic.systemPrompt ?? ''); setDir(topic.workingDir ?? ''); }, [topic.id, topic.title, topic.systemPrompt, topic.workingDir]);

  const saveTopic = (patch: Parameters<typeof api.updateTopic>[1]) => api.updateTopic(topic.id, patch).catch((e) => alert((e as Error).message));

  return (
    <>
      {open && <div className="overlay" style={{ zIndex: 14, background: 'rgba(0,0,0,.4)' }} onClick={onClose} />}
      <aside className={`settings ${open ? 'open' : ''}`} aria-label="방 설정">
        <section>
          <h3>방</h3>
          <div className="field">
            <label htmlFor="st-title">제목</label>
            <input id="st-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== topic.title) void saveTopic({ title: title.trim() }); }} />
          </div>
          <div className="field">
            <label htmlFor="st-policy">턴 정책</label>
            <select id="st-policy" value={topic.turnPolicy} onChange={(e) => void saveTopic({ turnPolicy: e.target.value as TurnPolicy })}>
              <option value="mention">mention — 지목한 쪽만, 없으면 둘 다</option>
              <option value="roundtable">roundtable — 항상 둘 다 동시에</option>
              <option value="sequential">sequential — 순서대로, 뒤가 앞을 보고</option>
              <option value="relay">relay — 둘이 N라운드 토론</option>
            </select>
          </div>
          {topic.turnPolicy === 'relay' && (
            <div className="field">
              <label htmlFor="st-rounds">최대 라운드</label>
              <input id="st-rounds" type="number" min={1} max={10} value={topic.relayMaxRounds} onChange={(e) => void saveTopic({ relayMaxRounds: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
            </div>
          )}
          <div className="field">
            <label htmlFor="st-prompt">이 방의 추가 규칙</label>
            <textarea id="st-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={() => { if (prompt !== (topic.systemPrompt ?? '')) void saveTopic({ systemPrompt: prompt.trim() || null }); }} />
            <span className="help">저장하면 다음 턴부터 적용됩니다 (Claude 는 프로세스를 다시 띄우지만 대화 맥락은 유지).</span>
          </div>
          <div className="field">
            <label htmlFor="st-dir">작업 폴더</label>
            <input id="st-dir" value={dir} onChange={(e) => setDir(e.target.value)} onBlur={() => { if (dir !== (topic.workingDir ?? '')) void saveTopic({ workingDir: dir.trim() || null }); }} placeholder={runner ? `${runner.workspace}/${topic.profile}` : ''} />
          </div>
        </section>

        <section style={{ display: 'grid', gap: 10 }}>
          <h3>참가자</h3>
          {participants.filter((p) => p.kind !== 'user').map((p) => (
            <ParticipantCard key={p.id} p={p} runner={runner} />
          ))}
        </section>

        <section>
          <h3>러너</h3>
          <div className="session">{runner?.hostname ?? '-'} · {runner?.mock ? 'MOCK' : 'real'}</div>
          <div className="session">claude: {runner?.claude.version ?? '없음'} — {runner?.claude.detail ?? ''}</div>
          <div className="session">codex: {runner?.codex.version ?? '없음'} — {runner?.codex.detail ?? ''}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="iconbtn" onClick={() => void api.refreshRunner()}>상태 새로고침</button>
            <button className="iconbtn danger" onClick={() => { if (confirm('이 방을 보관함으로 옮길까요? (대화는 DB 에 남습니다)')) void api.archiveTopic(topic.id).then(onArchived); }}>방 보관</button>
          </div>
        </section>
      </aside>
    </>
  );
}

function ParticipantCard({ p, runner }: { p: Participant; runner: RunnerStatus | null }) {
  const st = p.kind === 'claude' ? runner?.claude : runner?.codex;
  const models = st?.models ?? [];
  const known = models.find((m) => m.id === p.model);
  const efforts = known?.efforts ?? (p.kind === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh']);
  const perms = p.kind === 'claude' ? CLAUDE_PERMS : CODEX_SANDBOX;
  const update = (patch: Parameters<typeof api.updateParticipant>[1]) => api.updateParticipant(p.id, patch).catch((e) => alert((e as Error).message));

  return (
    <div className="pcard">
      <div className="phead">
        <span className={`avatar ${p.kind}`}>{p.kind === 'claude' ? '✳' : '⬢'}</span>
        <b>{p.displayName}</b>
        <label className="switch"><input type="checkbox" checked={p.enabled} onChange={(e) => void update({ enabled: e.target.checked })} /> 참여</label>
      </div>
      <div className="field">
        <label htmlFor={`m-${p.id}`}>모델</label>
        <select id={`m-${p.id}`} value={p.model ?? ''} onChange={(e) => {
          const m = models.find((x) => x.id === e.target.value);
          void update({ model: e.target.value, effort: m?.efforts.includes(p.effort ?? '') ? p.effort : (m?.defaultEffort ?? p.effort) });
        }}>
          {!known && p.model && <option value={p.model}>{p.model}</option>}
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.isDefault ? ' · 기본' : ''}</option>)}
        </select>
        {p.kind === 'claude' && <span className="help">별칭 대신 전체 이름(예: claude-sonnet-5)도 됩니다. 아래 입력칸에 직접 적으세요.</span>}
      </div>
      {p.kind === 'claude' && (
        <div className="field">
          <label htmlFor={`mf-${p.id}`}>모델 직접 입력</label>
          <input id={`mf-${p.id}`} defaultValue={p.model ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.model) void update({ model: v }); }} />
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor={`e-${p.id}`}>effort</label>
          <select id={`e-${p.id}`} value={p.effort ?? ''} onChange={(e) => void update({ effort: e.target.value || null })}>
            <option value="">(기본)</option>
            {efforts.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`p-${p.id}`}>{p.kind === 'claude' ? '권한 모드' : '샌드박스'}</label>
          <select id={`p-${p.id}`} value={p.permissionMode ?? ''} onChange={(e) => void update({ permissionMode: e.target.value })}>
            {perms.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
      </div>
      <div className="session" title={p.agentSessionId ?? ''}>session: {p.agentSessionId ? p.agentSessionId.slice(0, 8) + '…' : '(첫 대화에서 생성)'}</div>
    </div>
  );
}
