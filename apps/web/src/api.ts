import type {
  Approval, CreateTopicInput, HubState, Message, Participant, RunnerStatus, Topic,
  UpdateParticipantInput, UpdateTopicInput,
} from '@claude-codex/protocol';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  state: () => req<HubState>('GET', '/api/state'),
  refreshRunner: () => req<RunnerStatus>('POST', '/api/runner/refresh'),
  createTopic: (input: CreateTopicInput) => req<{ topic: Topic; participants: Participant[] }>('POST', '/api/topics', input),
  updateTopic: (id: string, patch: UpdateTopicInput) => req<Topic>('PATCH', `/api/topics/${id}`, patch),
  archiveTopic: (id: string) => req<Topic>('DELETE', `/api/topics/${id}`),
  messages: (topicId: string, after = 0) => req<{ messages: Message[]; approvals: Approval[]; active: string[] }>('GET', `/api/topics/${topicId}/messages?after=${after}`),
  send: (topicId: string, text: string) => req<Message>('POST', `/api/topics/${topicId}/messages`, { text }),
  interrupt: (topicId: string) => req<{ ok: true }>('POST', `/api/topics/${topicId}/interrupt`),
  updateParticipant: (id: string, patch: UpdateParticipantInput) => req<Participant>('PATCH', `/api/participants/${id}`, patch),
  decide: (approvalId: string, decision: 'accept' | 'decline') => req<Approval>('POST', `/api/approvals/${approvalId}`, { decision }),
};
