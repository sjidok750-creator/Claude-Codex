import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Approval, Block, Message, Participant, RunnerStatus, Topic } from '@claude-codex/protocol';
import { api } from '../api';
import type { Notice } from '../hub';
import { StatusBar } from './StatusBar';

interface Props {
  topic: Topic;
  participants: Participant[];
  messages: Message[];
  approvals: Approval[];
  notices: Notice[];
  active: string[];
  runner: RunnerStatus | null;
  onMenu: () => void;
  onSettings: () => void;
}

const AV: Record<string, string> = { user: '나', claude: '✳', codex: '⬢' };

function hhmm(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Thread({ topic, participants, messages, approvals, notices, active, runner, onMenu, onSettings }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const claude = participants.find((p) => p.kind === 'claude');
  const codex = participants.find((p) => p.kind === 'codex');
  const pending = approvals.filter((a) => a.decision === 'pending');

  // 사용자가 바닥 근처에 있을 때만 자동 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending.length, notices.length]);

  // 메시지와 공지를 시간순으로 섞어 렌더
  const items = useMemo(() => {
    const out: Array<{ key: string; at: number; node: JSX.Element }> = [];
    for (const m of messages) out.push({ key: m.id, at: Date.parse(m.createdAt), node: <MessageView key={m.id} m={m} streaming={m.status === 'streaming'} /> });
    for (const n of notices) out.push({ key: `n${n.id}`, at: n.at, node: <div key={`n${n.id}`} className="notice">{n.text}</div> });
    return out.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  }, [messages, notices]);

  return (
    <>
      <div className="topbar">
        <button className="iconbtn menubtn" onClick={onMenu} aria-label="토픽 목록">☰</button>
        <span>{topic.emoji}</span>
        <span className="title">{topic.title}</span>
        <span className="tag">{topic.turnPolicy}{topic.turnPolicy === 'relay' ? ` ×${topic.relayMaxRounds}` : ''}</span>
        {claude && <span className="tag claude hide-sm" title={`effort ${claude.effort ?? '기본'}`}>✳ {claude.model}{!claude.enabled ? ' · muted' : ''}</span>}
        {codex && <span className="tag codex hide-sm" title={`effort ${codex.effort ?? '기본'}`}>⬢ {codex.model}{!codex.enabled ? ' · muted' : ''}</span>}
        <span className="spacer" />
        {active.length > 0 && <button className="iconbtn danger" onClick={() => void api.interrupt(topic.id)}>■ 중단</button>}
        <button className="iconbtn" onClick={onSettings} aria-label="설정">⚙</button>
      </div>

      <div className="thread" ref={scrollRef}>
        <div className="thread-inner">
          {messages.length === 0 && (
            <div className="notice">첫 메시지를 보내면 {topic.turnPolicy === 'mention' ? 'Claude 와 Codex 가 함께' : topic.turnPolicy} 답합니다</div>
          )}
          {items.map((it) => it.node)}
          {pending.map((a) => <ApprovalCard key={a.id} a={a} participants={participants} />)}
        </div>
      </div>

      <Composer topic={topic} participants={participants} busy={active.length > 0} runner={runner} />
      <StatusBar runner={runner} connected={true} participants={participants} />
    </>
  );
}

function MessageView({ m, streaming }: { m: Message; streaming: boolean }) {
  if (m.status === 'passed') return <div className="passed">{m.displayName} 는 넘겼습니다 (PASS)</div>;
  return (
    <div className={`msg ${m.kind} ${m.status === 'error' ? 'error' : ''}`}>
      <span className={`avatar ${m.kind}`}>{AV[m.kind]}</span>
      <div>
        <div className="meta">
          <b>{m.displayName}</b>
          {m.model && <span className="model">{m.model}</span>}
          <span title={m.usage && (m.usage.input || m.usage.output) ? `토큰 입력 ${m.usage.input ?? 0} · 출력 ${m.usage.output ?? 0}` : undefined}>{hhmm(m.createdAt)}</span>
          {m.round > 1 && <span className="round">r{m.round}</span>}
        </div>
        <div className="body">
          {m.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          {m.kind === 'user'
            ? <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            : m.content
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              : streaming ? <span className="meta">생각 중…</span> : null}
          {streaming && m.content && <span className="cursor" />}
          {m.error && <div className="errtext">{m.error}</div>}
        </div>
      </div>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.type !== 'tool') return null;
  return (
    <details className="toolblock">
      <summary>
        <span className={`st ${b.status}`} />
        <span className="name">{b.name}</span>
        <span className="in">{b.input.split('\n')[0].slice(0, 120)}</span>
      </summary>
      {b.input && <pre className="in">{b.input}</pre>}
      {b.output && <pre className="out">{b.output}</pre>}
    </details>
  );
}

function ApprovalCard({ a, participants }: { a: Approval; participants: Participant[] }) {
  const who = participants.find((p) => p.id === a.participantId)?.displayName ?? '에이전트';
  return (
    <div className="approval">
      <div className="head">⚠ {who} 의 {a.kind === 'exec' ? '명령 실행' : a.kind === 'edit' ? '파일 변경' : '도구 사용'} 승인 요청</div>
      <div className="title">{a.title}</div>
      {a.detail && a.detail !== a.title && <pre>{a.detail}</pre>}
      <div className="actions">
        <button className="ok" onClick={() => void api.decide(a.id, 'accept')}>✓ 허용</button>
        <button className="no" onClick={() => void api.decide(a.id, 'decline')}>✕ 거부</button>
      </div>
    </div>
  );
}

// ---------- composer ----------
interface Suggestion { insert: string; label: string; desc: string }

function Composer({ topic, participants, busy, runner }: { topic: Topic; participants: Participant[]; busy: boolean; runner: RunnerStatus | null }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const claude = participants.find((p) => p.kind === 'claude');
  const codex = participants.find((p) => p.kind === 'codex');

  const suggestions: Suggestion[] = useMemo(() => {
    const m = /(^|\s)([@/][\w.\-가-힣]*)$/.exec(text);
    if (!m) return [];
    const tok = m[2].toLowerCase();
    if (tok.startsWith('@')) {
      return [
        { insert: '@claude ', label: '@claude', desc: 'Claude 에게만' },
        { insert: '@codex ', label: '@codex', desc: 'Codex 에게만' },
        { insert: '@all ', label: '@all', desc: '둘 다에게' },
      ].filter((s) => s.label.startsWith(tok));
    }
    const cmds: Suggestion[] = [
      { insert: '/model claude ', label: '/model claude <모델>', desc: `지금 ${claude?.model ?? '-'}` },
      { insert: '/model codex ', label: '/model codex <모델>', desc: `지금 ${codex?.model ?? '-'}` },
      { insert: '/effort claude ', label: '/effort claude <수준>', desc: 'low·medium·high·xhigh·max' },
      { insert: '/effort codex ', label: '/effort codex <수준>', desc: 'low·medium·high·xhigh' },
      { insert: '/mode ', label: '/mode <정책>', desc: 'mention·roundtable·sequential·relay' },
      { insert: '/rounds ', label: '/rounds <N>', desc: 'relay 최대 라운드' },
      { insert: '/mute ', label: '/mute claude|codex', desc: '잠시 빼기' },
      { insert: '/unmute ', label: '/unmute claude|codex', desc: '다시 넣기' },
      { insert: '/stop', label: '/stop', desc: '진행 중 응답 중단' },
    ];
    return cmds.filter((c) => c.label.toLowerCase().startsWith(tok));
  }, [text, claude?.model, codex?.model]);

  useEffect(() => { setSel(0); }, [suggestions.length]);

  const applySuggestion = (s: Suggestion) => {
    setText((t) => t.replace(/([@/][\w.\-가-힣]*)$/, s.insert));
    ref.current?.focus();
  };

  const runCommand = async (line: string): Promise<boolean> => {
    const [cmd, a1, ...rest] = line.slice(1).trim().split(/\s+/);
    const who = (a1 ?? '').toLowerCase();
    const target = who === 'claude' ? claude : who === 'codex' ? codex : undefined;
    const val = rest.join(' ');
    switch (cmd) {
      case 'model':
        if (!target || !val) throw new Error('사용법: /model claude|codex <모델>');
        await api.updateParticipant(target.id, { model: val }); return true;
      case 'effort':
        if (!target || !val) throw new Error('사용법: /effort claude|codex <수준>');
        await api.updateParticipant(target.id, { effort: val }); return true;
      case 'mode':
        if (!['mention', 'roundtable', 'sequential', 'relay'].includes(who)) throw new Error('사용법: /mode mention|roundtable|sequential|relay');
        await api.updateTopic(topic.id, { turnPolicy: who as Topic['turnPolicy'] }); return true;
      case 'rounds':
        await api.updateTopic(topic.id, { relayMaxRounds: Math.max(1, Math.min(10, Number(a1) || 3)) }); return true;
      case 'mute':
      case 'unmute':
        if (!target) throw new Error(`사용법: /${cmd} claude|codex`);
        await api.updateParticipant(target.id, { enabled: cmd === 'unmute' }); return true;
      case 'stop':
        await api.interrupt(topic.id); return true;
      default:
        return false; // 명령이 아니면 일반 메시지로
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr(null);
    try {
      if (t.startsWith('/')) {
        const handled = await runCommand(t);
        if (handled) { setText(''); return; }
      }
      await api.send(topic.id, t);
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
      return;
    }
    if (suggestions.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && /[@/][\w.\-가-힣]*$/.test(text) && !text.includes(' ', text.lastIndexOf('@'))))) {
      if (e.key === 'Tab' || suggestions.length === 1 || text.endsWith('@') || text.endsWith('/')) {
        e.preventDefault(); applySuggestion(suggestions[sel]); return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !isTouch()) { e.preventDefault(); void send(); }
  };

  // textarea 자동 높이
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  const notReady = runner && !runner.mock && ((claude?.enabled && !runner.claude.available) || (codex?.enabled && !runner.codex.available));

  return (
    <div className="composer">
      <div className="composer-inner">
        {suggestions.length > 0 && (
          <div className="suggest" role="listbox">
            {suggestions.map((s, i) => (
              <button key={s.label} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}>
                <span>{s.label}</span><span className="d">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        <div className="box">
          <textarea
            id={`composer-${topic.id}`}
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={busy ? '응답 중 (보내면 끼어들기)' : '메시지 · @claude @codex 지목 · / 명령'}
            rows={1}
          />
          <button type="button" className="sendbtn" disabled={!text.trim() || sending} onClick={() => void send()} aria-label="보내기">{sending ? '…' : '↑'}</button>
        </div>
        {(notReady || err) && (
          <div className="hint">
            {notReady && <span style={{ color: 'var(--warn)' }}>⚠ 러너 상태를 확인하세요 (⚙ → 러너)</span>}
            {err && <span style={{ color: 'var(--err)' }}>{err}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function isTouch() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
