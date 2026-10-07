'use strict';
// End-to-end API tests. Run: node --test --test-force-exit app/test/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
const mock = require('./mock-anthropic');

let base, M, server;
const H = (role, extra) => Object.assign({ 'content-type': 'application/json', 'x-role': role || 'requester' }, extra || {});
async function call(method, url, body, role, extra) {
  const r = await fetch(base + url, { method, headers: H(role, extra), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const FULL = (over) => Object.assign({ why: 'Coordinators need one view', beneficiaries: 'Coordinators and patients', problem: 'Hard to scan the list', outcome: 'Sort the list', howItWorks: 'Click sort and the list reorders', acceptance: ['Sorts high to low', 'Sorts low to high'], touches: ['None of these'], undecided: [] }, over || {});

test.before(async () => {
  M = await mock.start(0);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + M.srv.address().port;
  server = require('../server').server;
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server.close(); M.srv.close(); });

// ---------- configuration ----------
test('config reports live model; health is open', async () => {
  const c = await call('GET', '/api/config');
  assert.strictEqual(c.json.live, true);
  assert.strictEqual((await call('GET', '/api/health')).json.ok, true);
});

// ---------- request workspace: completeness ----------
let id;
test('creating a request starts the interviewer, using the instruction file as the system prompt', async () => {
  const r = await call('POST', '/api/requests', { title: 'Hypertension tracking', wish: 'Add blood pressure', requester: 'Lohi' });
  assert.strictEqual(r.status, 200);
  id = r.json.id;
  assert.strictEqual(r.json.conversation.length, 2);
  const used = M.calls[M.calls.length - 1];
  assert.match(used.system, /Requirement Interviewer Agent/);
  assert.match(used.system, /Care Companion: intent\.md/);
  assert.strictEqual(used.key, 'test-key');
});

test('while details are missing the request is not ready and cannot be drafted', async () => {
  const r = await call('GET', `/api/requests/${id}`);
  assert.strictEqual(r.json.ready, false);
  assert.ok(r.json.missing.length >= 5, 'lists what is still needed');
  const d = await call('POST', `/api/requests/${id}/draft`);
  assert.strictEqual(d.status, 400);
  assert.match(d.json.error, /Still needed/);
});

test('interview completes only when every required detail is present; unknown touch options are dropped', async () => {
  await call('POST', `/api/requests/${id}/chat`, { message: 'Coordinators' });
  const r = await call('POST', `/api/requests/${id}/chat`, { message: 'Show it' });
  assert.strictEqual(r.json.ready, true);
  assert.strictEqual(r.json.missing.length, 0);
  assert.deepStrictEqual(r.json.fields.touches, ['Personal or health data']);
  assert.match(r.json.fields.why, /one view/);
});

test('removing a required detail puts the request back to not ready (code decides, not the model)', async () => {
  const c = await call('POST', '/api/requests', { title: 'Vague', wish: 'make it better' });
  await call('POST', `/api/requests/${c.json.id}/chat`, { message: 'a' });
  const r = await call('POST', `/api/requests/${c.json.id}/chat`, { message: 'b' }); // mock says ready, but only fills nothing new on turn 3? it fills all
  // Force the gap: wipe a field by hand-editing, which must put it back to not ready.
  const e = await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL({ howItWorks: '' }) });
  assert.strictEqual(e.json.ready, false);
  assert.deepStrictEqual(e.json.missing, ['How will it work, step by step?']);
  assert.ok(r.status === 200);
});

test('editing fields: acceptance needs at least two checks', async () => {
  const c = await call('POST', '/api/requests', { title: 'One check', wish: 'x' });
  const e = await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL({ acceptance: ['only one'] }) });
  assert.strictEqual(e.json.ready, false);
  assert.match(e.json.missing[0], /at least two/);
});

test('cannot submit before drafting', async () => {
  assert.strictEqual((await call('POST', `/api/requests/${id}/submit`)).status, 400);
});

test('draft creates spec, screen and decisions', async () => {
  const r = await call('POST', `/api/requests/${id}/draft`);
  assert.strictEqual(r.status, 200);
  assert.match(r.json.draft.section, /blood pressure/);
  assert.strictEqual(r.json.decisions.length, 1);
  assert.strictEqual(r.json.decisions[0].status, 'Open');
});

// ---------- risk and routing ----------
test('submit runs the risk check: health data means the engineer lane', async () => {
  const r = await call('POST', `/api/requests/${id}/submit`);
  assert.strictEqual(r.json.status, 'po_review');
  assert.strictEqual(r.json.risk.verdict, 'HUMAN_REVIEW');
  assert.ok(r.json.risk.categories.includes('PERSONAL_DATA'));
  assert.match(r.json.risk.layer, /rules \+ model/);
});

test('roles are enforced', async () => {
  assert.strictEqual((await call('POST', `/api/requests/${id}/po`, { decision: 'approve' }, 'requester')).status, 403);
  assert.strictEqual((await call('POST', `/api/requests/${id}/po`, { decision: 'approve' }, 'engineer')).status, 403);
});

test('Definition of Ready: product owner cannot approve with an Open decision', async () => {
  const r = await call('POST', `/api/requests/${id}/po`, { decision: 'approve' }, 'product_owner');
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /Definition of Ready/);
});

test('compose shows Open decision and fails readiness; resolving makes it pass', async () => {
  let c = await call('POST', '/api/intent/compose', { ids: [id] });
  assert.strictEqual(c.json.ready, false);
  assert.match(c.json.markdown, /\(v1\.1\)/);
  assert.match(c.json.markdown, /\| D2 \| Who approves the thresholds\? \| Clinical lead \| Open \|/);
  await call('POST', `/api/requests/${id}/decisions/0`, { resolution: 'Clinical lead signs off' }, 'product_owner');
  c = await call('POST', '/api/intent/compose', { ids: [id] });
  assert.strictEqual(c.json.ready, true);
  assert.match(c.json.markdown, /Resolved \| Clinical lead signs off/);
});

test('approve routes to engineer; engineer approves; brief available', async () => {
  let r = await call('POST', `/api/requests/${id}/po`, { decision: 'approve', note: 'ok' }, 'product_owner');
  assert.strictEqual(r.json.status, 'engineer_review');
  assert.strictEqual((await call('GET', `/api/requests/${id}/brief`)).status, 409);
  r = await call('POST', `/api/requests/${id}/engineer`, { decision: 'approve' }, 'engineer');
  assert.strictEqual(r.json.status, 'approved');
  const b = await call('GET', `/api/requests/${id}/brief`);
  assert.match(b.json.brief, /ENGINEER REVIEW REQUIRED/);
  assert.match(b.json.brief, /Why: Care coordinators/);
});

test('a fast-lane request goes straight to approved after the product owner', async () => {
  const c = await call('POST', '/api/requests', { title: 'Sort', wish: 'Sort by HbA1c' });
  await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL() });
  await call('POST', `/api/requests/${c.json.id}/draft`);
  const s = await call('POST', `/api/requests/${c.json.id}/submit`);
  assert.strictEqual(s.json.risk.verdict, 'AUTO');
  const p = await call('POST', `/api/requests/${c.json.id}/po`, { decision: 'approve' }, 'product_owner');
  assert.strictEqual(p.json.status, 'approved', JSON.stringify(p.json.error || p.json.risk));
});

test('the model can never downgrade a rules flag', async () => {
  const c = await call('POST', '/api/requests', { title: 'Card on file', wish: 'Keep a card' });
  await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL({ outcome: 'Keep a payment card' }) });
  await call('POST', `/api/requests/${c.json.id}/draft`);
  const s = await call('POST', `/api/requests/${c.json.id}/submit`);
  assert.strictEqual(s.json.risk.verdict, 'HUMAN_REVIEW');
});

test('request changes sends it back to the requester, who can edit and resubmit', async () => {
  const c = await call('POST', '/api/requests', { title: 'Changes', wish: 'x' });
  await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL() });
  await call('POST', `/api/requests/${c.json.id}/draft`);
  await call('POST', `/api/requests/${c.json.id}/submit`);
  const r = await call('POST', `/api/requests/${c.json.id}/po`, { decision: 'changes', note: 'Add who decides' }, 'product_owner');
  assert.strictEqual(r.json.status, 'changes_requested');
  assert.strictEqual((await call('POST', `/api/requests/${c.json.id}/fields`, { fields: FULL({ outOfScope: 'No export' }) })).status, 200);
  assert.strictEqual((await call('POST', `/api/requests/${c.json.id}/draft`)).status, 200);
  assert.strictEqual((await call('POST', `/api/requests/${c.json.id}/submit`)).json.status, 'po_review');
});

// ---------- push intent.md to GitHub ----------
function fakeGithub() {
  const state = { calls: [], intent: '# Care Companion: intent.md (v1.0)\n\n## Purpose\nx\n\n## Decisions\n\n| # | Decision | Owner | Status | Resolution |\n| --- | --- | --- | --- | --- |\n| D1 | Demo uses sample data only | Product owner | Resolved | Yes |\n' };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; state.calls.push({ m: req.method, u: req.url, auth: req.headers.authorization, body });
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'GET' && req.url.startsWith('/repos/me/repo/contents/intent.md')) return send(200, { sha: 'filesha', content: Buffer.from(state.intent).toString('base64') });
      if (req.method === 'GET' && req.url === '/repos/me/repo/git/ref/heads/main') return send(200, { object: { sha: 'basesha' } });
      if (req.method === 'POST' && req.url === '/repos/me/repo/git/refs') return send(201, {});
      if (req.method === 'PUT' && req.url === '/repos/me/repo/contents/intent.md') { state.pushed = Buffer.from(body.content, 'base64').toString('utf8'); return send(200, {}); }
      if (req.method === 'POST' && req.url === '/repos/me/repo/pulls') return send(201, { number: 12, html_url: 'https://github.com/me/repo/pull/12' });
      if (req.method === 'POST' && /labels$/.test(req.url)) return send(200, {});
      send(404, { message: 'no route ' + req.url });
    });
  });
  return new Promise((resolve) => srv.listen(0, () => resolve({ srv, state })));
}

test('push: not configured returns a clear message', async () => {
  const r = await call('POST', '/api/intent/push', { ids: [id] }, 'product_owner');
  assert.strictEqual(r.status, 501);
});

test('push: only the product owner, only approved requests', async () => {
  const gh = await fakeGithub();
  process.env.GITHUB_API_BASE = 'http://127.0.0.1:' + gh.srv.address().port;
  process.env.GITHUB_TOKEN = 't0k'; process.env.GITHUB_REPO = 'me/repo';
  assert.strictEqual((await call('POST', '/api/intent/push', { ids: [id] }, 'requester')).status, 403);
  const c = await call('POST', '/api/requests', { title: 'Not approved', wish: 'x' });
  const r = await call('POST', '/api/intent/push', { ids: [c.json.id] }, 'product_owner');
  assert.strictEqual(r.status, 409);
  assert.match(r.json.error, /Only approved/);
  gh.srv.close();
});

test('push: builds on the repository\'s current intent.md and opens a pull request', async () => {
  const gh = await fakeGithub();
  process.env.GITHUB_API_BASE = 'http://127.0.0.1:' + gh.srv.address().port;
  process.env.GITHUB_TOKEN = 't0k'; process.env.GITHUB_REPO = 'me/repo';
  const r = await call('POST', '/api/intent/push', { ids: [id] }, 'product_owner');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.number, 12);
  const seq = gh.state.calls.map((c) => c.m + ' ' + c.u.split('?')[0]);
  assert.deepStrictEqual(seq.slice(0, 5), ['GET /repos/me/repo/contents/intent.md', 'GET /repos/me/repo/git/ref/heads/main', 'POST /repos/me/repo/git/refs', 'PUT /repos/me/repo/contents/intent.md', 'POST /repos/me/repo/pulls']);
  assert.ok(gh.state.calls.every((c) => c.auth === 'Bearer t0k'));
  assert.match(gh.state.pushed, /\(v1\.1\)/);
  assert.match(gh.state.pushed, /## Change 1\.1: Hypertension tracking/);
  assert.match(gh.state.pushed, /\| D2 \| Who approves the thresholds\? \| Clinical lead \| Resolved \|/);
  const put = gh.state.calls.find((c) => c.m === 'PUT');
  assert.strictEqual(put.body.sha, 'filesha');
  assert.match(put.body.branch, /^intent\/r-001-/);
  const pr = gh.state.calls.find((c) => c.u === '/repos/me/repo/pulls');
  assert.match(pr.body.body, /ENGINEER REVIEW/);
  assert.ok(gh.state.calls.some((c) => /labels$/.test(c.u)), 'engineer-lane PR is labelled');
  const after = await call('GET', `/api/requests/${id}`);
  assert.strictEqual(after.json.github.number, 12);
  gh.srv.close();
});

test('release: only an engineer, only approved', async () => {
  assert.strictEqual((await call('POST', `/api/requests/${id}/release`, {}, 'product_owner')).status, 403);
  assert.strictEqual((await call('POST', `/api/requests/${id}/release`, {}, 'engineer')).json.status, 'released');
});

// ---------- patient portal ----------
test('patients: HbA1c validated in code; blood pressure only when switched on', async () => {
  let r = await call('POST', '/api/patients/p1/readings', { a1c: '25', date: '2026-10-01' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/patients/p1/readings', { a1c: '7.2', date: '2026-10-01', sys: '120', dia: '80' });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /not switched on/);
  r = await call('POST', '/api/patients/p1/readings', { a1c: '7.2', date: '2099-01-01' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/patients/p1/readings', { a1c: '7.2', date: '2026-10-01' });
  assert.strictEqual(r.json.ok, true);
});

test('kill switch: requester cannot flip it; product owner can; BP then works and validates', async () => {
  assert.strictEqual((await call('POST', '/api/flags', { bp: true }, 'requester')).status, 403);
  assert.strictEqual((await call('POST', '/api/flags', { bp: true }, 'product_owner')).json.bp, true);
  let r = await call('POST', '/api/patients/p2/readings', { a1c: '6.5', date: '2026-10-01', sys: '80', dia: '120' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/patients/p2/readings', { a1c: '6.5', date: '2026-10-01', sys: '125', dia: '82' });
  assert.strictEqual(r.json.ok, true);
  await call('POST', '/api/flags', { bp: false }, 'engineer');
  assert.strictEqual((await call('GET', '/api/patients')).json.flags.bp, false);
});

test('vision: model value is validated by code and the photo is not stored', async () => {
  const r = await call('POST', '/api/vision', { mediaType: 'image/jpeg', data: 'AAAA' });
  assert.strictEqual(r.json.kind, 'hba1c');
  assert.strictEqual(r.json.a1c, 7.4);
  assert.strictEqual((await call('POST', '/api/vision', { mediaType: 'application/pdf', data: 'AAAA' })).status, 400);
  assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'state.json'), 'utf8').includes('AAAA'));
});

// ---------- files, access, hosting ----------
test('instruction files: only whitelisted files can be read', async () => {
  assert.strictEqual((await call('GET', '/api/file?path=agents/risk-check-agent.md')).status, 200);
  assert.strictEqual((await call('GET', '/api/file?path=../../etc/passwd')).status, 404);
  assert.strictEqual((await call('GET', '/api/file?path=app/server.js')).status, 404);
  assert.strictEqual((await call('GET', '/api/file?path=agents/../.env')).status, 404);
});

test('access code protects the API; CORS allows the separate sites', async () => {
  process.env.ACCESS_CODE = 'sesame';
  assert.strictEqual((await call('GET', '/api/state')).status, 401);
  assert.strictEqual((await call('GET', '/api/state', null, 'requester', { 'x-access-code': 'sesame' })).status, 200);
  assert.strictEqual((await call('GET', '/api/config')).status, 200);
  const pre = await fetch(base + '/api/state', { method: 'OPTIONS', headers: { origin: 'https://site.example', 'access-control-request-method': 'GET' } });
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), '*');
  delete process.env.ACCESS_CODE;
});

test('static: the three front-ends are served locally', async () => {
  for (const p of ['/control-room/', '/workspace/', '/patient/']) {
    const r = await fetch(base + p);
    assert.strictEqual(r.status, 200, p);
    assert.match(await r.text(), /<title>/);
  }
  assert.strictEqual((await fetch(base + '/workspace/shared/shared.js')).status, 200);
  assert.strictEqual((await fetch(base + '/control-room/config.js')).status, 200);
});

test('scripted mode (no model key) still runs the interview and enforces completeness', async () => {
  const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    let r = await call('POST', '/api/requests', { title: 'Scripted', wish: 'Keep a card on file' });
    assert.match(r.json.conversation[1].content, /Why is this needed/);
    assert.match(r.json.conversation[1].layer, /scripted/);
    for (const a of ['Faster follow-up consults', 'Patients', 'They re-enter details each time', 'One tap payment', 'Patient taps Save card', 'Card is saved\nPays in one tap', 'payments', 'none']) {
      r = await call('POST', `/api/requests/${r.json.id}/chat`, { message: a });
    }
    assert.strictEqual(r.json.ready, true);
    assert.deepStrictEqual(r.json.fields.touches, ['Payments']);
    assert.strictEqual(r.json.fields.acceptance.length, 2);
  } finally { process.env.ANTHROPIC_API_KEY = saved; }
});

// ---------- real-world Claude behaviour: answering in prose instead of JSON ----------
test('if Claude answers in prose once, the app asks again and recovers', async () => {
  mock.setMode('prose-then-json');
  try {
    const before = M.calls.length;
    const r = await call('POST', '/api/requests', { title: 'Prose then JSON', wish: 'Sort the list' });
    assert.strictEqual(r.status, 200);
    assert.match(r.json.conversation[1].layer, /^model/);
    assert.ok(M.calls.length - before >= 2, 'a corrective second call was made');
    assert.ok(!/scripted/.test(r.json.conversation[1].layer));
  } finally { mock.setMode('json'); }
});

test('if Claude keeps answering in prose, its own words are shown (not canned questions) and nothing breaks', async () => {
  mock.setMode('prose');
  try {
    const r = await call('POST', '/api/requests', { title: 'Always prose', wish: 'Sort the list' });
    assert.strictEqual(r.status, 200);
    const msg = r.json.conversation[1];
    assert.match(msg.content, /who will benefit/);
    assert.match(msg.layer, /plain-text reply/);
    assert.strictEqual(r.json.ready, false);
  } finally { mock.setMode('json'); }
});
