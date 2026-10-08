import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createApp, ROOT } from './server.mjs';
import { SAMPLES, mockAnalyze, newTicket, decide } from './core.js';
import { validateAnalysis, liveAnalyze } from './providers.mjs';

const tempRoot = path.join(ROOT, '.test-data');
mkdirSync(tempRoot, { recursive: true });
async function fixture(t, config = {}, fetcher) {
  const dataDir = config.dataDir || mkdtempSync(path.join(tempRoot, 'run-'));
  const app = createApp({ config: { dataDir, mode: 'mock', llmKey: '', llmModel: '', crmUrl: '', crmToken: '', apiToken: '', ...config }, fetcher });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); if (app.server.listening) await new Promise(r => app.server.close(r)); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  const cookie = health.headers.get('set-cookie').split(';')[0];
  const call = async (route, body, extra = {}) => {
    const response = await fetch(`${base}/api/${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { ...app, base, call, cookie, dataDir };
}
const sample = { text: SAMPLES[1].text, synthetic: true };

for (const item of SAMPLES) test(`mock: ${item.language} resolves language, summary and matching reply`, () => {
  const result = mockAnalyze(item.text);
  assert.equal(result.languageCode, item.language);
  assert.ok(result.draftReply.length > 30);
  assert.match(result.summaryRu, /Тема/);
  assert.notEqual(result.category, 'general');
});
test('urgency and sentiment are independent of category', () => {
  assert.equal(mockAnalyze(SAMPLES[1].text).urgency, 'high');
  assert.equal(mockAnalyze('Hello, I have a refund question. Thank you.').sentiment, 'positive');
  assert.equal(mockAnalyze('Hello, I have a refund question. Thank you.').urgency, 'medium');
});
test('unknown language has no fabricated English reply; manual choice works', () => {
  const unknown = mockAnalyze('안녕하세요 배송 문의');
  assert.equal(unknown.languageCode, 'und'); assert.equal(unknown.draftReply, '');
  assert.equal(mockAnalyze('Test 123', 'de').languageCode, 'de');
  assert.throws(() => decide(newTicket(unknown, 'mock'), { decision: 'approve', version: 1, reply: '' }), /Введите текст/);
});
test('analysis → edit → approve demo; duplicate and invalid transitions', async t => {
  const f = await fixture(t);
  const created = await f.call('analyze', sample); assert.equal(created.status, 201);
  let record = created.data; assert.equal(record.status, 'review');
  const edit = await f.call('approve', { id: record.id, version: 1, decision: 'edit', reply: 'Hello, please describe the issue.' });
  assert.equal(edit.data.status, 'edited'); assert.equal(edit.data.draftReply, 'Hello, please describe the issue.');
  assert.equal((await f.call('approve', { id: record.id, version: 1, decision: 'approve', reply: 'Hello!' })).status, 409);
  const approved = await f.call('approve', { id: record.id, version: 2, decision: 'approve', reply: edit.data.draftReply });
  assert.equal(approved.data.status, 'approved_demo');
  const duplicate = await f.call('approve', { id: record.id, version: 2, decision: 'approve', reply: 'Must not replace reply' });
  assert.deepEqual(duplicate.data, approved.data);
  assert.equal((await f.call('approve', { id: record.id, version: 3, decision: 'edit', reply: 'Changed' })).status, 409);
});
test('reject is terminal and does not send', async t => {
  const f = await fixture(t);
  const { data: r } = await f.call('analyze', sample);
  const rejected = await f.call('approve', { id: r.id, version: 1, decision: 'reject' });
  assert.equal(rejected.data.status, 'rejected');
  assert.equal((await f.call('approve', { id: r.id, version: 2, decision: 'approve', reply: 'Hi!' })).status, 409);
});
test('persist only metadata; recover history after restart without storing text', async t => {
  const f = await fixture(t);
  const { data: r } = await f.call('analyze', { synthetic: true, text: 'Hello, email test@example.test, phone +1 202 555 0142. My order is late.' });
  await f.call('approve', { id: r.id, version: 1, decision: 'edit', reply: 'Private draft marker' });
  const saved = readFileSync(path.join(f.dataDir, 'journal.json'), 'utf8');
  for (const forbidden of ['test@example', '555', 'Private draft', 'summaryRu', 'draftReply', 'My order']) assert.equal(saved.includes(forbidden), false);
  const log = (await f.call('logs')).data.records[0]; assert.equal(log.available, true);
  f.server.closeAllConnections(); await new Promise(r => f.server.close(r));
  const restarted = await fixture(t, { dataDir: f.dataDir });
  const history = (await restarted.call('logs')).data.records;
  assert.equal(history.length, 1); assert.equal(history[0].status, 'edited'); assert.equal(history[0].available, false);
  assert.equal((await restarted.call(`tickets/${r.id}`)).status, 404);
});
test('CRM failure is explicit; retry uses frozen payload and same idempotency key', async t => {
  const calls = []; let success = false;
  const f = await fixture(t, { crmUrl: 'https://crm.example.test/hook' }, async (url, args) => {
    calls.push({ url, args }); return new Response('', { status: success ? 200 : 500 });
  });
  const { data: r } = await f.call('analyze', sample); assert.equal(calls.length, 0);
  const failed = await f.call('approve', { id: r.id, version: 1, decision: 'approve', reply: 'Hello, your request will be reviewed.' });
  assert.equal(failed.data.status, 'delivery_failed');
  assert.equal((await f.call('approve', { id: r.id, version: failed.data.version, decision: 'edit', reply: 'Changed' })).status, 409);
  success = true;
  const done = await f.call('approve', { id: r.id, version: failed.data.version, decision: 'retry', reply: 'Must be ignored' });
  assert.equal(done.data.status, 'delivered'); assert.equal(calls.length, 2);
  assert.equal(calls[0].args.headers['Idempotency-Key'], r.id);
  assert.equal(calls[0].args.body, calls[1].args.body);
  await f.call('approve', { id: r.id, version: done.data.version, decision: 'approve' }); assert.equal(calls.length, 2);
});
test('concurrent approval cannot trigger duplicate CRM call', async t => {
  let started, finish;
  const ready = new Promise(r => { started = r; });
  const released = new Promise(r => { finish = r; });
  let count = 0;
  const f = await fixture(t, { crmUrl: 'https://crm.example.test/hook' }, async () => { count++; started(); await released; return new Response(''); });
  const { data: r } = await f.call('analyze', sample);
  const body = { id: r.id, version: 1, decision: 'approve', reply: 'Hello!' };
  const first = f.call('approve', body); await ready;
  try { assert.equal((await f.call('approve', body)).status, 409); assert.equal(count, 1); }
  finally { finish(); }
  assert.equal((await first).data.status, 'delivered');
});
test('HTTP input validation, session/origin isolation and static allowlist', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('analyze', { text: 'Hello' })).status, 400);
  assert.equal((await f.call('analyze', { text: '', synthetic: true })).status, 400);
  assert.equal((await f.call('analyze', { text: 'x'.repeat(4001), synthetic: true })).status, 400);
  assert.equal((await f.call('analyze', { ...sample, mode: 'live' })).status, 409);
  assert.equal((await f.call('analyze', sample, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await fetch(`${f.base}/api/logs`)).status, 401);
  for (const file of ['.env', '.env.example', '.data/journal.json', 'server.mjs', 'providers.mjs', 'package.json', '../server.mjs', '%2eenv']) {
    assert.equal((await fetch(`${f.base}/${file}`)).status, 404, file);
  }
  const invalid = await fetch(`${f.base}/api/analyze`, { method: 'POST', headers: { Cookie: f.cookie, 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(invalid.status, 400);
  assert.equal((await f.call('analyze', sample, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.call('analyze', { ...sample, text: 'x'.repeat(40000) })).status, 413);
  assert.equal((await fetch(f.base)).status, 200);
});
const liveConfig = { llmKey: 'synthetic-test-key', llmModel: 'synthetic-model', timeoutMs: 50 };
test('automation bearer token works without browser cookie; wrong token is rejected', async t => {
  const f = await fixture(t, { apiToken: 'synthetic-automation-token' });
  for (const [token, expected] of [['wrong', 401], ['synthetic-automation-token', 201]]) {
    const result = await fetch(`${f.base}/api/analyze`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(sample) });
    assert.equal(result.status, expected);
    if (expected === 201) assert.equal((await result.json()).status, 'review');
  }
});
test('n8n intake template has valid connections, authentication and no automatic approval', () => {
  const workflow = JSON.parse(readFileSync(path.join(ROOT, 'n8n-workflow.json'), 'utf8'));
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
  assert.equal(workflow.settings.saveDataErrorExecution, 'none');
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.equal(workflow.nodes.length, 4);
  const names = new Set(workflow.nodes.map(n => n.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [source, groups] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source));
    for (const edge of groups.main.flat()) assert.ok(names.has(edge.node));
  }
  const intake = workflow.nodes.find(n => n.type.endsWith('.webhook'));
  assert.equal(intake.parameters.authentication, 'headerAuth');
  const request = workflow.nodes.find(n => n.type.endsWith('.httpRequest'));
  assert.match(request.parameters.url, /\/api\/analyze/);
  assert.equal(JSON.stringify(workflow).includes('/api/approve'), false);
  const code = workflow.nodes.find(n => n.type.endsWith('.code')).parameters.jsCode;
  const normalize = new Function('$json', code);
  assert.deepEqual(normalize({ body: sample })[0].json, { ...sample, languageHint: '' });
  assert.throws(() => normalize({ body: { text: 'Hello' } }), /Synthetic/);
  assert.throws(() => normalize({ body: { ...sample, text: 'a'.repeat(4001) } }), /Synthetic/);
});
const output = mockAnalyze(SAMPLES[1].text);
function response(data) { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }); }
test('live Responses contract, strict schema and redaction without real API call', async () => {
  let request;
  const data = await liveAnalyze('Hello test@example.test', '', liveConfig, async (url, args) => {
    request = JSON.parse(args.body); assert.equal(url, 'https://api.openai.com/v1/responses');
    return response({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
  });
  assert.deepEqual(data, output); assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
  assert.equal(JSON.stringify(request.input).includes('test@example.test'), false);
  assert.equal('tools' in request, false);
  assert.throws(() => validateAnalysis({ ...output, status: 'delivered' }), /некорректный/);
  assert.throws(() => validateAnalysis({ ...output, urgency: 'urgent' }), /некорректный/);
});
test('provider refusal, truncation, malformed JSON and timeout fail without mock fallback', async () => {
  for (const payload of [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] },
  ]) await assert.rejects(liveAnalyze('Hello', '', liveConfig, async () => response(payload)));
  await assert.rejects(liveAnalyze('Hello', '', liveConfig, async () => { throw new Error('timeout with secret'); }), /недоступен/);
  await assert.rejects(liveAnalyze('Hello', '', {}, async () => {}), /не настроен/);
});
test('live mode errors do not create a ticket; result cannot bypass approval', async t => {
  let broken = true;
  const f = await fixture(t, { mode: 'live', ...liveConfig }, async () => broken ? new Response('private provider error', { status: 500 }) : response({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }));
  const failed = await f.call('analyze', sample); assert.equal(failed.status, 502);
  assert.equal((await f.call('logs')).data.records.length, 0);
  broken = false;
  assert.equal((await f.call('analyze', sample)).data.status, 'review');
});

