import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentKind, AvatarMap, CreateTopicInput, HubState, ParticipantKind, RunnerStatus, ServerEvent, UpdateParticipantInput, UpdateTopicInput } from '@claude-codex/protocol';
import { DEFAULTS } from '@claude-codex/protocol';
import { config } from './config.js';
import { HubDb } from './db.js';
import { Bus } from './bus.js';
import { Orchestrator } from './orchestrator.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { CodexAdapter } from './adapters/codex.js';
import { MockAdapter } from './adapters/mock.js';
import type { AgentAdapter } from './adapters/types.js';

const db = new HubDb(config.dbPath);
const stale = db.failStaleStreaming();
if (stale) console.log(`[hub] 끊긴 응답 ${stale}건을 정리했습니다`);
db.expirePendingApprovals();

const bus = new Bus();
const adapters: Record<AgentKind, AgentAdapter> = config.mockAgents
  ? { claude: new MockAdapter('claude'), codex: new MockAdapter('codex') }
  : {
    claude: new ClaudeAdapter({ bin: config.claudeBin, idleMs: config.claudeIdleMs, promptDir: path.join(config.dataDir, 'prompts') }),
    codex: new CodexAdapter({ bin: config.codexBin, cwd: config.workspace }),
  };
const orchestrator = new Orchestrator(db, bus, adapters, {
  workspace: config.workspace, promptsDir: config.promptsDir, approvalTimeoutMs: config.approvalTimeoutMs, turnStallMs: config.turnStallMs,
});

let runner: RunnerStatus = {
  hostname: config.hostname, mock: config.mockAgents, workspace: config.workspace,
  claude: { available: false, version: null, loggedIn: null, models: [], detail: '확인 중…' },
  codex: { available: false, version: null, loggedIn: null, models: [], detail: '확인 중…' },
};

async function refreshRunner(): Promise<RunnerStatus> {
  const [claude, codex] = await Promise.all([adapters.claude.status(), adapters.codex.status()]);
  runner = { ...runner, claude, codex };
  bus.emit({ type: 'runner.status', runner });
  return runner;
}

// ---------- 아바타 (data/avatars/<kind>.<ext>) ----------
const avatarDir = path.join(config.dataDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });
const AVATAR_KINDS: ParticipantKind[] = ['user', 'claude', 'codex'];
const AVATAR_EXTS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function avatarFile(kind: ParticipantKind): { file: string; type: string } | null {
  for (const [type, ext] of Object.entries(AVATAR_EXTS)) {
    const file = path.join(avatarDir, `${kind}.${ext}`);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

function avatars(): AvatarMap {
  const out = { user: null, claude: null, codex: null } as AvatarMap;
  for (const kind of AVATAR_KINDS) {
    const f = avatarFile(kind);
    if (f) out[kind] = Math.floor(fs.statSync(f.file).mtimeMs);
  }
  return out;
}

function state(): HubState {
  return { topics: db.listTopics(), participants: db.listParticipants(), runner, avatars: avatars() };
}

// ---------- HTTP ----------
const app = new Hono();
app.use('*', cors());

const authorized = (token: string | undefined): boolean => !config.hubToken || token === config.hubToken;

app.use('*', async (c, next) => {
  if (!config.hubToken) return next();
  const q = c.req.query('token');
  if (q && q === config.hubToken) {
    setCookie(c, 'cc_token', q, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return next();
  }
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (authorized(bearer) || authorized(getCookie(c, 'cc_token'))) return next();
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'unauthorized' }, 401);
  return c.text('접근 토큰이 필요합니다. 주소 뒤에 ?token=… 을 붙여 한 번 열어 주세요.', 401);
});

app.get('/api/health', (c) => c.json({ ok: true, hostname: config.hostname, mock: config.mockAgents }));

app.get('/avatars/:kind', (c) => {
  const kind = c.req.param('kind') as ParticipantKind;
  const f = AVATAR_KINDS.includes(kind) ? avatarFile(kind) : null;
  if (!f) return c.notFound();
  return c.body(fs.readFileSync(f.file), 200, { 'content-type': f.type, 'cache-control': 'public, max-age=31536000, immutable' });
});

app.post('/api/avatars/:kind', async (c) => {
  const kind = c.req.param('kind') as ParticipantKind;
  if (!AVATAR_KINDS.includes(kind)) return c.json({ error: 'kind 는 user|claude|codex' }, 400);
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim();
  const ext = AVATAR_EXTS[type];
  if (!ext) return c.json({ error: 'png, jpg, webp, gif 만 됩니다' }, 400);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return c.json({ error: '이미지는 5MB 이하' }, 400);
  for (const e of Object.values(AVATAR_EXTS)) { const old = path.join(avatarDir, `${kind}.${e}`); if (fs.existsSync(old)) fs.unlinkSync(old); }
  fs.writeFileSync(path.join(avatarDir, `${kind}.${ext}`), buf);
  const map = avatars();
  bus.emit({ type: 'avatars', avatars: map });
  return c.json(map);
});

app.delete('/api/avatars/:kind', (c) => {
  const kind = c.req.param('kind') as ParticipantKind;
  for (const e of Object.values(AVATAR_EXTS)) { const old = path.join(avatarDir, `${kind}.${e}`); if (fs.existsSync(old)) fs.unlinkSync(old); }
  const map = avatars();
  bus.emit({ type: 'avatars', avatars: map });
  return c.json(map);
});
app.get('/api/state', (c) => c.json(state()));
app.post('/api/runner/refresh', async (c) => c.json(await refreshRunner()));

app.post('/api/topics', async (c) => {
  const body = (await c.req.json()) as CreateTopicInput;
  if (!body?.title?.trim()) return c.json({ error: '제목이 필요합니다' }, 400);
  if (body.profile !== 'work' && body.profile !== 'personal') return c.json({ error: 'profile 은 work 또는 personal' }, 400);
  const defaults = {
    claudeModel: body.claudeModel ?? null,
    codexModel: body.codexModel
      ?? (runner.codex.models.some((m) => m.id === DEFAULTS.codexModel) || runner.codex.models.length === 0 ? DEFAULTS.codexModel : runner.codex.models.find((m) => m.isDefault)?.id ?? DEFAULTS.codexModel),
  };
  const { topic, participants } = db.createTopic({ ...body, title: body.title.trim(), ...defaults });
  bus.emit({ type: 'topic.upsert', topic });
  for (const p of participants) bus.emit({ type: 'participant.upsert', participant: p });
  return c.json({ topic, participants });
});

app.patch('/api/topics/:id', async (c) => {
  const patch = (await c.req.json()) as UpdateTopicInput;
  const topic = db.updateTopic(c.req.param('id'), patch);
  if (!topic) return c.json({ error: 'not found' }, 404);
  bus.emit({ type: 'topic.upsert', topic });
  return c.json(topic);
});

app.delete('/api/topics/:id', (c) => {
  const topic = db.updateTopic(c.req.param('id'), { archivedAt: new Date().toISOString() });
  if (!topic) return c.json({ error: 'not found' }, 404);
  bus.emit({ type: 'topic.upsert', topic });
  return c.json(topic);
});

app.get('/api/topics/:id/messages', (c) => {
  const after = Number(c.req.query('after') ?? 0);
  return c.json({ messages: db.listMessages(c.req.param('id'), after), approvals: db.listPendingApprovals(c.req.param('id')), active: orchestrator.isActive(c.req.param('id')) });
});

app.post('/api/topics/:id/messages', async (c) => {
  const topic = db.getTopic(c.req.param('id'));
  if (!topic) return c.json({ error: 'not found' }, 404);
  const { text } = (await c.req.json()) as { text: string };
  if (!text?.trim()) return c.json({ error: '내용이 비었습니다' }, 400);
  const message = await orchestrator.onUserMessage(topic, text.trim());
  return c.json(message);
});

app.post('/api/topics/:id/interrupt', async (c) => {
  await orchestrator.interrupt(c.req.param('id'));
  return c.json({ ok: true });
});

app.patch('/api/participants/:id', async (c) => {
  const patch = (await c.req.json()) as UpdateParticipantInput;
  const before = db.getParticipant(c.req.param('id'));
  const participant = db.updateParticipant(c.req.param('id'), patch);
  if (!participant || !before) return c.json({ error: 'not found' }, 404);
  bus.emit({ type: 'participant.upsert', participant });
  const changes: string[] = [];
  if (patch.model !== undefined && patch.model !== before.model) changes.push(`모델 ${before.model ?? '-'} → ${participant.model}`);
  if (patch.effort !== undefined && patch.effort !== before.effort) changes.push(`effort ${before.effort ?? '-'} → ${participant.effort}`);
  if (patch.enabled !== undefined && patch.enabled !== before.enabled) changes.push(participant.enabled ? '참여' : '음소거');
  if (changes.length) bus.emit({ type: 'system.notice', topicId: participant.topicId, text: `${participant.displayName}: ${changes.join(', ')}` });
  return c.json(participant);
});

app.post('/api/approvals/:id', async (c) => {
  const { decision } = (await c.req.json()) as { decision: 'accept' | 'decline' };
  const approval = orchestrator.decide(c.req.param('id'), decision === 'accept' ? 'accept' : 'decline');
  if (!approval) return c.json({ error: 'not found' }, 404);
  return c.json(approval);
});

// 정적 웹 (빌드 결과가 있을 때)
if (fs.existsSync(config.webDist)) {
  const rel = path.relative(process.cwd(), config.webDist) || '.';
  app.use('/*', serveStatic({ root: rel }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8')));
} else {
  app.get('/', (c) => c.text('웹 UI 가 아직 빌드되지 않았습니다. `pnpm build` 를 실행하거나 개발 모드(`pnpm dev`)에서는 http://localhost:5173 을 여세요.'));
}

// ---------- HTTP + WS 서버 ----------
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port, createServer }, (info) => {
  console.log(`[hub] http://${info.address === '0.0.0.0' ? 'localhost' : info.address}:${info.port}  (data: ${config.dataDir}${config.mockAgents ? ', MOCK' : ''})`);
});

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  if (config.hubToken) {
    const cookie = req.headers.cookie ?? '';
    const m = /(?:^|;\s*)cc_token=([^;]+)/.exec(cookie);
    const token = url.searchParams.get('token') ?? (m ? decodeURIComponent(m[1]) : undefined);
    if (!authorized(token)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', state: state() } satisfies ServerEvent));
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      // 클라이언트 → 서버는 REST 를 쓰고, WS 는 ping 정도만 받는다
      if (String(raw) === 'ping') ws.send('pong');
    });
  });
});

bus.on((event) => {
  const data = JSON.stringify(event);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
});

void refreshRunner();
setInterval(() => void refreshRunner(), 5 * 60 * 1000).unref();

async function shutdown(signal: string) {
  console.log(`\n[hub] ${signal} → 종료 중`);
  await orchestrator.shutdown();
  for (const ws of clients) ws.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
