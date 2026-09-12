import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProfileId, Topic } from '@claude-codex/protocol';
import { useHub } from './hub';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { Thread } from './components/Thread';
import { Settings } from './components/Settings';
import { StatusBar } from './components/StatusBar';
import { NewTopicDialog } from './components/NewTopicDialog';

const LS_TOPIC = 'cc.topic';
const LS_PROFILE = 'cc.profile';

function readLs(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function App() {
  const { state, actions } = useHub();
  const [profile, setProfile] = useState<ProfileId>(() => (readLs(LS_PROFILE) === 'personal' ? 'personal' : 'work'));
  const [topicId, setTopicId] = useState<string | null>(() => readLs(LS_TOPIC));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 861px)').matches);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const showSettings = !!topicId && (wide || settingsOpen);
  const [showNew, setShowNew] = useState(false);

  const topics = useMemo(
    () => Object.values(state.topics).filter((t) => !t.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.topics],
  );
  const visibleTopics = topics.filter((t) => t.profile === profile);
  const topic: Topic | null = topicId ? state.topics[topicId] ?? null : null;

  // 선택된 토픽이 없거나 다른 프로필이면 그 프로필의 첫 토픽으로
  useEffect(() => {
    if (!state.loaded) return;
    if (topic && topic.profile === profile && !topic.archivedAt) return;
    setTopicId(visibleTopics[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded, profile, topics.length]);

  useEffect(() => { if (topicId) writeLs(LS_TOPIC, topicId); }, [topicId]);
  useEffect(() => { writeLs(LS_PROFILE, profile); }, [profile]);

  // 토픽 메시지 로드 (재접속 시 loadedTopics 가 비워지므로 다시 로드된다)
  useEffect(() => {
    if (topicId && state.connected && !state.loadedTopics[topicId]) void actions.loadMessages(topicId);
  }, [topicId, state.connected, state.loadedTopics, actions]);

  const selectTopic = useCallback((id: string) => { setTopicId(id); setSidebarOpen(false); }, []);

  const participants = useMemo(
    () => Object.values(state.participants).filter((p) => p.topicId === topicId).sort((a, b) => a.order - b.order),
    [state.participants, topicId],
  );

  const onCreate = async (input: { title: string; emoji: string; turnPolicy: Topic['turnPolicy']; systemPrompt: string; workingDir: string }) => {
    const r = await api.createTopic({
      profile, title: input.title, emoji: input.emoji, turnPolicy: input.turnPolicy,
      systemPrompt: input.systemPrompt || null, workingDir: input.workingDir || null,
    });
    setShowNew(false);
    setTopicId(r.topic.id);
  };

  return (
    <div className={`app ${showSettings && topic ? 'with-settings' : ''}`}>
      <Sidebar
        open={sidebarOpen}
        connected={state.connected}
        profile={profile}
        onProfile={(p) => { setProfile(p); }}
        topics={visibleTopics}
        activeTopicId={topicId}
        active={state.active}
        onSelect={selectTopic}
        onNew={() => { setShowNew(true); setSidebarOpen(false); }}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="main">
        {topic ? (
          <Thread
            key={topic.id}
            topic={topic}
            participants={participants}
            messages={state.messages[topic.id] ?? []}
            approvals={Object.values(state.approvals).filter((a) => a.topicId === topic.id)}
            notices={state.notices.filter((n) => n.topicId === topic.id || n.topicId === null)}
            active={state.active[topic.id] ?? []}
            runner={state.runner}
            onMenu={() => setSidebarOpen(true)}
            onSettings={() => setSettingsOpen((v) => !v)}
            profile={profile}
          />
        ) : (
          <>
            <div className="topbar">
              <button className="iconbtn menubtn" onClick={() => setSidebarOpen(true)} aria-label="토픽 목록">☰</button>
              <span className="title">Claude-Codex</span>
            </div>
            <div className="welcome">
              <div className="box">
                <div className="trio"><span className="avatar user">나</span><span className="avatar claude">✳</span><span className="avatar codex">⬢</span></div>
                <div><b>{profile === 'work' ? 'work' : 'personal'}</b> 프로필에 아직 방이 없습니다.</div>
                <div>방을 하나 만들고 아무 주제나 던져 보세요. 기본 정책은 <code>mention</code>: 지목이 없으면 둘 다 답하고, <code>@claude</code> / <code>@codex</code> 로 지목하면 그쪽만 답합니다.</div>
                <div><button className="iconbtn" onClick={() => setShowNew(true)}>+ 새 방 만들기</button></div>
              </div>
            </div>
            <StatusBar runner={state.runner} connected={state.connected} participants={[]} />
          </>
        )}
      </div>
      {topic && showSettings && (
        <Settings
          open={settingsOpen || wide}
          topic={topic}
          participants={participants}
          runner={state.runner}
          onClose={() => setSettingsOpen(false)}
          onArchived={() => { setTopicId(null); }}
        />
      )}
      {showNew && <NewTopicDialog profile={profile} onClose={() => setShowNew(false)} onCreate={onCreate} />}
    </div>
  );
}
