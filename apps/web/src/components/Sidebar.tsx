import type { ProfileId, Topic } from '@claude-codex/protocol';

interface Props {
  open: boolean;
  connected: boolean;
  profile: ProfileId;
  onProfile: (p: ProfileId) => void;
  topics: Topic[];
  activeTopicId: string | null;
  active: Record<string, string[]>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export function Sidebar({ open, connected, profile, onProfile, topics, activeTopicId, active, onSelect, onNew, onClose }: Props) {
  return (
    <>
      {open && <div className="overlay" style={{ zIndex: 14, background: 'rgba(0,0,0,.4)' }} onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className={`dot ${connected ? 'on' : ''}`} title={connected ? '허브 연결됨' : '허브 연결 끊김'} />
          <b>claude-codex</b>
          <span>hub</span>
        </div>
        <div className="profiles" role="tablist" aria-label="프로필">
          <button role="tab" aria-selected={profile === 'work'} className={`work ${profile === 'work' ? 'on' : ''}`} onClick={() => onProfile('work')}>work</button>
          <button role="tab" aria-selected={profile === 'personal'} className={`personal ${profile === 'personal' ? 'on' : ''}`} onClick={() => onProfile('personal')}>personal</button>
        </div>
        <div className="topics">
          {topics.length === 0 && <div className="empty-topics">방이 없습니다. 아래에서 만드세요.</div>}
          {topics.map((t) => (
            <button key={t.id} className={`topic-item ${t.id === activeTopicId ? 'on' : ''}`} onClick={() => onSelect(t.id)}>
              <span className="emoji">{t.emoji && t.emoji !== '💬' ? t.emoji : '#'}</span>
              <span className="title">{t.title}</span>
              {(active[t.id]?.length ?? 0) > 0 ? <span className="live" title="응답 중" /> : <span className="policy">{t.turnPolicy}</span>}
            </button>
          ))}
        </div>
        <button className="new-topic" onClick={onNew}>+ 새 방</button>
      </aside>
    </>
  );
}
