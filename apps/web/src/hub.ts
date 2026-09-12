import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Approval, HubState, Message, Participant, RunnerStatus, ServerEvent, Topic } from '@claude-codex/protocol';
import { api } from './api';

export interface Notice { id: number; topicId: string | null; text: string; at: number }

export interface State {
  connected: boolean;
  loaded: boolean;
  topics: Record<string, Topic>;
  participants: Record<string, Participant>;
  messages: Record<string, Message[]>; // topicId → 정렬된 메시지
  loadedTopics: Record<string, boolean>;
  approvals: Record<string, Approval>;
  active: Record<string, string[]>; // topicId → 응답 중인 participantId
  runner: RunnerStatus | null;
  notices: Notice[];
}

type Action =
  | { type: 'ws'; event: ServerEvent }
  | { type: 'connected'; value: boolean }
  | { type: 'messages'; topicId: string; messages: Message[]; approvals: Approval[]; active: string[] };

const initial: State = {
  connected: false, loaded: false, topics: {}, participants: {}, messages: {}, loadedTopics: {},
  approvals: {}, active: {}, runner: null, notices: [],
};

let noticeSeq = 1;

function upsertMessage(list: Message[] | undefined, m: Message): Message[] {
  const arr = list ? [...list] : [];
  const i = arr.findIndex((x) => x.id === m.id);
  if (i >= 0) arr[i] = m; else arr.push(m);
  arr.sort((a, b) => a.seq - b.seq);
  return arr;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'connected':
      return { ...s, connected: a.value };
    case 'messages': {
      const approvals = { ...s.approvals };
      for (const ap of a.approvals) approvals[ap.id] = ap;
      return {
        ...s,
        messages: { ...s.messages, [a.topicId]: a.messages },
        loadedTopics: { ...s.loadedTopics, [a.topicId]: true },
        approvals,
        active: { ...s.active, [a.topicId]: a.active },
      };
    }
    case 'ws': {
      const e = a.event;
      switch (e.type) {
        case 'hello': {
          const st: HubState = e.state;
          return {
            ...s, loaded: true, runner: st.runner,
            topics: Object.fromEntries(st.topics.map((t) => [t.id, t])),
            participants: Object.fromEntries(st.participants.map((p) => [p.id, p])),
            loadedTopics: {}, // 재접속 시 메시지를 다시 불러온다
          };
        }
        case 'topic.upsert':
          return { ...s, topics: { ...s.topics, [e.topic.id]: e.topic } };
        case 'topic.delete': {
          const topics = { ...s.topics }; delete topics[e.id];
          return { ...s, topics };
        }
        case 'participant.upsert':
          return { ...s, participants: { ...s.participants, [e.participant.id]: e.participant } };
        case 'message.upsert':
          return { ...s, messages: { ...s.messages, [e.message.topicId]: upsertMessage(s.messages[e.message.topicId], e.message) } };
        case 'message.delta': {
          const list = s.messages[e.topicId];
          if (!list) return s;
          const i = list.findIndex((m) => m.id === e.id);
          if (i < 0) return s;
          const next = [...list];
          next[i] = { ...next[i], content: next[i].content + e.delta };
          return { ...s, messages: { ...s.messages, [e.topicId]: next } };
        }
        case 'approval.upsert':
          return { ...s, approvals: { ...s.approvals, [e.approval.id]: e.approval } };
        case 'runner.status':
          return { ...s, runner: e.runner };
        case 'topic.activity':
          return { ...s, active: { ...s.active, [e.topicId]: e.active } };
        case 'system.notice':
          return { ...s, notices: [...s.notices.slice(-20), { id: noticeSeq++, topicId: e.topicId, text: e.text, at: Date.now() }] };
        default:
          return s;
      }
    }
    default:
      return s;
  }
}

export function useHub() {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry = 500;
    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws${location.search}`);
      wsRef.current = ws;
      ws.onopen = () => { retry = 500; dispatch({ type: 'connected', value: true }); };
      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        try { dispatch({ type: 'ws', event: JSON.parse(ev.data as string) as ServerEvent }); } catch { /* ignore */ }
      };
      ws.onclose = () => {
        dispatch({ type: 'connected', value: false });
        if (!stopped) setTimeout(connect, retry = Math.min(retry * 2, 8000));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const ping = setInterval(() => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping'); }, 25000);
    return () => { stopped = true; clearInterval(ping); wsRef.current?.close(); };
  }, []);

  const actions = useMemo(() => ({
    async loadMessages(topicId: string) {
      const r = await api.messages(topicId);
      dispatch({ type: 'messages', topicId, messages: r.messages, approvals: r.approvals, active: r.active });
    },
  }), []);

  return { state, actions };
}
