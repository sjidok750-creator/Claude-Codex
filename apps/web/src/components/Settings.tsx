import { useEffect, useRef, useState } from 'react';
import type { AvatarMap, Participant, ParticipantKind, RunnerStatus, Topic, TurnPolicy } from '@claude-codex/protocol';
import { api } from '../api';
import { Avatar } from './Avatar';

interface Props {
  open: boolean;
  topic: Topic;
  participants: Participant[];
  runner: RunnerStatus | null;
  avatars: AvatarMap;
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

export function Settings({ open, topic, participants, runner, avatars, onClose, onArchived }: Props) {
  const [title, setTitle] = useState(topic.title);
  const [prompt, setPrompt] = useState(topic.systemPrompt ?? '');
  const [dir, setDir] = useState(topic.workingDir ?? '');
  useEffect(() => { setTitle(topic.title); setPrompt(topic.systemPrompt ?? ''); setDir(topic.workingDir ?? ''); }, [topic.id, topic.title, topic.systemPrompt, topic.workingDir]);

  const saveTopic = (patch: Parameters<typeof api.updateTopic>[1]) => api.updateTopic(topic.id, patch).catch((e) => alert((e as Error).message));

  return (
    <>
      {open && <div className="overlay sheet-overlay" style={{ zIndex: 14, background: 'rgba(0,0,0,.4)' }} onClick={onClose} />}
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
          {participants.filter((p) => p.kind === 'user').map((p) => (
            <div className="pcard" key={p.id}>
              <div className="phead">
                <AvatarPicker kind="user" avatars={avatars} />
                <b>{p.displayName}</b>
              </div>
              <div className="field">
                <label htmlFor={`me-${p.id}`}>내 이름 (에이전트가 이렇게 부릅니다)</label>
                <input id={`me-${p.id}`} defaultValue={p.displayName} placeholder="예: 상국" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.displayName) void api.updateParticipant(p.id, { displayName: v }); }} />
              </div>
            </div>
          ))}
          {participants.filter((p) => p.kind !== 'user').map((p) => (
            <ParticipantCard key={p.id} p={p} runner={runner} avatars={avatars} />
          ))}
        </section>

        <section>
          <h3>러너 · {runner?.hostname.replace(/\.local$/, '') ?? '-'}{runner?.mock ? ' (MOCK)' : ''}</h3>
          <div className="session" title={runner?.claude.detail ?? ''}>claude {runner?.claude.version?.replace(' (Claude Code)', '') ?? '없음'}{runner?.claude.detail ? ` · ${runner.claude.detail}` : ''}</div>
          <div className="session" title={runner?.codex.detail ?? ''}>codex {runner?.codex.version?.replace('codex-cli ', '') ?? '없음'}{runner?.codex.detail ? ` · ${runner.codex.detail}` : ''}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="iconbtn" onClick={() => void api.refreshRunner()}>상태 새로고침</button>
            <button className="iconbtn danger" onClick={() => { if (confirm('이 방을 보관함으로 옮길까요? (대화는 DB 에 남습니다)')) void api.archiveTopic(topic.id).then(onArchived); }}>방 보관</button>
          </div>
        </section>
      </aside>
    </>
  );
}

function ParticipantCard({ p, runner, avatars }: { p: Participant; runner: RunnerStatus | null; avatars: AvatarMap }) {
  const st = p.kind === 'claude' ? runner?.claude : runner?.codex;
  const models = st?.models ?? [];
  const known = models.find((m) => m.id === p.model);
  const efforts = known?.efforts ?? (p.kind === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh']);
  const perms = p.kind === 'claude' ? CLAUDE_PERMS : CODEX_SANDBOX;
  const update = (patch: Parameters<typeof api.updateParticipant>[1]) => api.updateParticipant(p.id, patch).catch((e) => alert((e as Error).message));

  return (
    <div className="pcard">
      <div className="phead">
        <AvatarPicker kind={p.kind} avatars={avatars} />
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
        {p.kind === 'claude' && <span className="help">전체 이름(예: claude-sonnet-5)은 채팅에서 <code>/model claude 이름</code> 으로.</span>}
      </div>
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
    </div>
  );
}

/** 아바타를 클릭하면 이미지 파일을 골라 업로드. 우클릭(또는 길게)으로 제거 */
function AvatarPicker({ kind, avatars }: { kind: ParticipantKind; avatars: AvatarMap }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { await api.uploadAvatar(kind, file); } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <span className="avatar-picker" title="클릭해서 아바타 이미지 바꾸기">
      <button type="button" className="avatar-btn" disabled={busy} onClick={() => input.current?.click()}
        onContextMenu={(e) => { e.preventDefault(); if (avatars[kind] && confirm('아바타 이미지를 지울까요?')) void api.removeAvatar(kind); }}>
        <Avatar kind={kind} avatars={avatars} size={40} />
        <span className="avatar-edit">{busy ? '…' : '✎'}</span>
      </button>
      <input ref={input} id={`avatar-${kind}`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
    </span>
  );
}
