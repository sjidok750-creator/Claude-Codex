import { useState } from 'react';
import type { ProfileId, TurnPolicy } from '@claude-codex/protocol';

const EMOJIS = ['💬', '🧭', '📝', '🐛', '📈', '🗣', '🧪', '🎯', '📚', '🛠', '🍳', '✈️'];

const POLICIES: Array<{ id: TurnPolicy; label: string; desc: string }> = [
  { id: 'mention', label: 'mention', desc: '지목 없으면 둘 다, @claude/@codex 로 지목하면 그쪽만' },
  { id: 'roundtable', label: 'roundtable', desc: '항상 둘 다 동시에 답' },
  { id: 'sequential', label: 'sequential', desc: 'Claude → Codex 순서로, 뒤 사람이 앞 답을 보고 답' },
  { id: 'relay', label: 'relay', desc: '둘이 몇 라운드 주고받은 뒤 멈춤 (토론)' },
];

interface Props {
  profile: ProfileId;
  onClose: () => void;
  onCreate: (input: { title: string; emoji: string; turnPolicy: TurnPolicy; systemPrompt: string; workingDir: string }) => Promise<void>;
}

export function NewTopicDialog({ profile, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('💬');
  const [policy, setPolicy] = useState<TurnPolicy>('mention');
  const [prompt, setPrompt] = useState('');
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) { setErr('제목을 적어 주세요'); return; }
    setBusy(true); setErr(null);
    try { await onCreate({ title: title.trim(), emoji, turnPolicy: policy, systemPrompt: prompt.trim(), workingDir: dir.trim() }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="새 방">
        <h2>새 방 <span className="tag">{profile}</span></h2>
        <div className="field">
          <label htmlFor="nt-title">제목</label>
          <input id="nt-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 이번 주 식단, 결제모듈 리팩터링" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        </div>
        <div className="field">
          <label>이모지</label>
          <div className="emoji-row">
            {EMOJIS.map((e) => <button key={e} type="button" className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
        </div>
        <div className="field">
          <label htmlFor="nt-policy">턴 정책</label>
          <select id="nt-policy" value={policy} onChange={(e) => setPolicy(e.target.value as TurnPolicy)}>
            {POLICIES.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.desc}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nt-prompt">이 방의 추가 규칙 (선택)</label>
          <textarea id="nt-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="예: 이 방은 영어 회화 연습방. Codex 는 원어민 친구 역할, Claude 는 내 문장을 교정." />
        </div>
        <div className="field">
          <label htmlFor="nt-dir">작업 폴더 (선택, 허브 PC 기준 절대경로)</label>
          <input id="nt-dir" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="비우면 허브 기본 워크스페이스" />
          <span className="help">코드나 파일을 다루는 방이 아니면 비워 두세요.</span>
        </div>
        {err && <div className="errtext">{err}</div>}
        <div className="actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '만드는 중…' : '만들기'}</button>
        </div>
      </div>
    </div>
  );
}
