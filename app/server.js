'use strict';
// Care Companion platform server. No dependencies. Node 20+.
// API for three separately hosted front-ends: Control Room, Request Workspace, Patient Portal.
const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const claude = require('./lib/claude');
const files = require('./lib/files');
const risk = require('./lib/risk');
const agents = require('./lib/agents');
const V = require('./lib/validate');
const F = require('./lib/fields');

const ROLES = ['requester', 'product_owner', 'engineer'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' };

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

function send(res, status, body, headers) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  }, headers || {}));
  res.end(data);
}

function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Simple per-IP limit on calls that spend model credits.
const hits = new Map();
function limit(req) {
  const max = +(process.env.MODEL_CALLS_PER_HOUR || 60);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (arr.length >= max) throw new HttpError(429, 'Too many model calls from this address this hour. Try again later.');
  arr.push(now); hits.set(ip, arr);
}

function role(req) {
  const r = String(req.headers['x-role'] || 'requester');
  if (!ROLES.includes(r)) throw bad('Unknown role');
  return r;
}
function need(req, wanted) {
  const r = role(req);
  if (r !== wanted) throw new HttpError(403, 'Only the ' + wanted.replace('_', ' ') + ' can do this.');
  const code = wanted === 'product_owner' ? process.env.PO_CODE : wanted === 'engineer' ? process.env.ENGINEER_CODE : '';
  if (code && req.headers['x-role-code'] !== code) throw new HttpError(403, 'Role code required for ' + wanted.replace('_', ' ') + '.');
  return r;
}

function getReq(id) {
  const r = store.get().requests.find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'Request not found');
  return r;
}
const log = (r, actor, event, detail) => store.audit(r && r.id, actor, event, detail);
const refresh = (r) => { r.missing = F.missing(r.fields).map((m) => m.label); return r; };

function summary(r) {
  return { id: r.id, title: r.title, status: r.status, requester: r.requester, createdAt: r.createdAt,
    verdict: r.risk && r.risk.verdict, hasDraft: !!r.draft, missing: (r.missing || []).length, pr: r.github || null,
    openDecisions: (r.decisions || []).filter((d) => d.status !== 'Resolved').length };
}

function buildBrief(r) {
  return [
    'Implement change request ' + r.id + ': ' + r.title,
    '',
    'Follow agents/code-agent.md and CLAUDE.md. Update intent.md first, then code, then tests.',
    'Risk lane: ' + (r.risk && r.risk.verdict === 'HUMAN_REVIEW' ? 'ENGINEER REVIEW REQUIRED (' + r.risk.categories.join(', ') + ')' : 'fast lane'),
    '',
    'Why: ' + r.fields.why,
    'Who benefits: ' + r.fields.beneficiaries,
    'How it works: ' + r.fields.howItWorks,
    '',
    'Spec section to add:',
    r.draft ? r.draft.section : '(none)',
    '',
    'Screen description:',
    r.draft ? r.draft.screen : '(none)',
    '',
    'Resolved decisions:',
    ...r.decisions.map((d) => '- ' + d.question + ' -> ' + (d.resolution || 'OPEN')),
  ].join('\n');
}

// ---------- routes ----------
const routes = [];
const route = (method, rx, fn, opts) => routes.push({ method, rx, fn, opts: opts || {} });

route('GET', /^\/api\/health$/, () => ({ ok: true }), { open: true });
route('GET', /^\/api\/config$/, () => ({
  live: claude.live(), model: claude.live() ? claude.model() : null,
  needsCode: !!process.env.ACCESS_CODE,
  github: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
  touchOptions: risk.TOUCH_OPTIONS,
}), { open: true });

route('GET', /^\/api\/state$/, () => {
  const s = store.get();
  return { requests: s.requests.map(summary), audit: s.audit.slice(-60).reverse(), flags: s.flags,
    agents: files.listAgents(), live: claude.live(), model: claude.live() ? claude.model() : null };
});

route('GET', /^\/api\/file$/, (req, res, m, q) => {
  if (!files.allowed(String(q.path || ''))) throw new HttpError(404, 'File not available');
  return { path: q.path, content: files.read(q.path) };
});

// --- requests ---
route('POST', /^\/api\/requests$/, async (req) => {
  limit(req);
  const b = await readBody(req);
  const title = String(b.title || '').trim().slice(0, 120);
  const wish = String(b.wish || '').trim().slice(0, 2000);
  if (!title || !wish) throw bad('Give the request a title and describe what you want.');
  const s = store.get();
  s.seq += 1;
  const r = { id: 'R-' + String(s.seq).padStart(3, '0'), title, wish, requester: String(b.requester || 'Requester').slice(0, 60),
    status: 'intake', createdAt: new Date().toISOString(), conversation: [{ role: 'user', content: wish }],
    fields: F.empty(), missing: [], ready: false,
    draft: null, decisions: [], risk: null, po: null, engineer: null, github: null };
  s.requests.push(r);
  log(r, r.requester, 'request created', title);
  const out = await agents.interview(r);
  r.fields = out.fields; r.ready = out.ready; refresh(r);
  r.conversation.push({ role: 'assistant', content: out.reply, layer: out.layer });
  log(r, 'requirement-interviewer', 'asked first question', out.layer);
  store.save();
  return r;
});

route('GET', /^\/api\/requests\/([\w-]+)$/, (req, res, m) => getReq(m[1]));

route('POST', /^\/api\/requests\/([\w-]+)\/chat$/, async (req, res, m) => {
  limit(req);
  const r = getReq(m[1]);
  if (!['intake', 'changes_requested'].includes(r.status)) throw new HttpError(409, 'This request is already submitted.');
  const b = await readBody(req);
  const msg = String(b.message || '').trim().slice(0, 2000);
  if (!msg) throw bad('Write a message.');
  if (r.conversation.filter((x) => x.role === 'user').length >= 12) throw new HttpError(409, 'Conversation limit reached. Edit the fields directly.');
  r.conversation.push({ role: 'user', content: msg });
  const out = await agents.interview(r);
  r.fields = out.fields; r.ready = out.ready; refresh(r);
  r.conversation.push({ role: 'assistant', content: out.reply, layer: out.layer });
  log(r, 'requirement-interviewer', out.ready ? 'request complete' : 'asked a question', out.layer);
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/fields$/, async (req, res, m) => {
  const r = getReq(m[1]);
  if (!['intake', 'changes_requested'].includes(r.status)) throw new HttpError(409, 'This request is already submitted.');
  r.fields = F.normalize((await readBody(req)).fields || {}, F.empty());
  refresh(r); r.ready = r.missing.length === 0;
  r.draft = null; // fields changed, so any earlier draft is stale
  log(r, role(req), 'fields edited');
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/draft$/, async (req, res, m) => {
  limit(req);
  const r = getReq(m[1]);
  if (!['intake', 'changes_requested'].includes(r.status)) throw new HttpError(409, 'This request is already submitted.');
  const f = r.fields;
  const miss = F.missing(f);
  if (miss.length) throw bad('The request is not complete yet. Still needed: ' + miss.map((m) => m.label).join(' | '));
  const d = await agents.draft(r);
  const old = new Map((r.decisions || []).map((x) => [x.question.toLowerCase(), x]));
  const all = [...f.undecided, ...d.decisions];
  const seen = new Set();
  r.decisions = all.filter((x) => { const k = x.question.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((x) => old.get(x.question.toLowerCase()) || { question: x.question, owner: x.owner, status: 'Open', resolution: '' });
  r.draft = { section: d.section, screen: d.screen, layer: d.layer, at: new Date().toISOString() };
  log(r, 'spec-drafter', 'drafted spec section and screen', d.layer);
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/submit$/, async (req, res, m) => {
  limit(req);
  const r = getReq(m[1]);
  if (!['intake', 'changes_requested'].includes(r.status)) throw new HttpError(409, 'Already submitted.');
  if (!r.draft) throw bad('Draft the spec first, so the product owner has something to review.');
  r.risk = await risk.assess(r);
  r.status = 'po_review'; r.po = null; r.engineer = null;
  log(r, 'risk-check-agent', 'verdict ' + r.risk.verdict, r.risk.categories.join(', ') + ' | ' + r.risk.layer);
  log(r, 'system', 'routed to product owner', r.risk.verdict === 'HUMAN_REVIEW' ? 'engineer lane' : 'fast lane');
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/decisions\/(\d+)$/, async (req, res, m) => {
  need(req, 'product_owner');
  const r = getReq(m[1]);
  const d = r.decisions[+m[2]];
  if (!d) throw new HttpError(404, 'Decision not found');
  const text = String((await readBody(req)).resolution || '').trim().slice(0, 300);
  d.status = text ? 'Resolved' : 'Open'; d.resolution = text;
  log(r, 'product_owner', text ? 'resolved a decision' : 'reopened a decision', d.question);
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/po$/, async (req, res, m) => {
  need(req, 'product_owner');
  const r = getReq(m[1]);
  if (r.status !== 'po_review') throw new HttpError(409, 'Not waiting for the product owner.');
  const b = await readBody(req);
  const note = String(b.note || '').slice(0, 500);
  if (b.decision === 'approve') {
    const open = r.decisions.filter((d) => d.status !== 'Resolved');
    if (open.length) throw new HttpError(409, 'Definition of Ready failed: ' + open.length + ' decision(s) still Open. Resolve them first.');
    r.status = r.risk.verdict === 'HUMAN_REVIEW' ? 'engineer_review' : 'approved';
  } else if (b.decision === 'changes') r.status = 'changes_requested';
  else if (b.decision === 'reject') r.status = 'rejected';
  else throw bad('decision must be approve, changes or reject');
  r.po = { decision: b.decision, note, at: new Date().toISOString() };
  log(r, 'product_owner', 'decision: ' + b.decision, note);
  if (r.status === 'engineer_review') log(r, 'system', 'routed to engineer', r.risk.categories.join(', '));
  store.save();
  return r;
});

route('POST', /^\/api\/requests\/([\w-]+)\/engineer$/, async (req, res, m) => {
  need(req, 'engineer');
  const r = getReq(m[1]);
  if (r.status !== 'engineer_review') throw new HttpError(409, 'Not waiting for an engineer.');
  const b = await readBody(req);
  const note = String(b.note || '').slice(0, 500);
  if (b.decision === 'approve') r.status = 'approved';
  else if (b.decision === 'changes') r.status = 'changes_requested';
  else throw bad('decision must be approve or changes');
  r.engineer = { decision: b.decision, note, checklist: r.risk.checklist, at: new Date().toISOString() };
  log(r, 'engineer', 'decision: ' + b.decision, note);
  store.save();
  return r;
});

route('GET', /^\/api\/requests\/([\w-]+)\/brief$/, (req, res, m) => {
  const r = getReq(m[1]);
  if (!['approved', 'released'].includes(r.status)) throw new HttpError(409, 'Available after approval.');
  return { brief: buildBrief(r) };
});

route('POST', /^\/api\/requests\/([\w-]+)\/release$/, (req, res, m) => {
  need(req, 'engineer');
  const r = getReq(m[1]);
  if (r.status !== 'approved') throw new HttpError(409, 'Only approved changes can be released.');
  r.status = 'released';
  log(r, 'engineer', 'marked released', 'after tests and merge');
  store.save();
  return r;
});


// --- push approved intent.md to GitHub as a pull request (product owner only) ---
async function gh(method, p, body) {
  const base = process.env.GITHUB_API_BASE || 'https://api.github.com';
  const r = await fetch(base + '/repos/' + process.env.GITHUB_REPO + p, {
    method,
    headers: { authorization: 'Bearer ' + process.env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'care-companion' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw new HttpError(502, 'GitHub ' + method + ' ' + p.split('?')[0] + ' said ' + r.status + ': ' + (j.message || text).slice(0, 150));
  return j;
}

route('POST', /^\/api\/intent\/push$/, async (req) => {
  need(req, 'product_owner');
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) throw new HttpError(501, 'GitHub is not connected. Set GITHUB_TOKEN and GITHUB_REPO on the API service.');
  const ids = (await readBody(req)).ids || [];
  const reqs = ids.map(getReq);
  if (!reqs.length) throw bad('Choose at least one request.');
  const notReady = reqs.filter((r) => r.status !== 'approved');
  if (notReady.length) throw new HttpError(409, 'Only approved requests can be pushed. Not approved yet: ' + notReady.map((r) => r.id).join(', '));
  const branch = process.env.GITHUB_BRANCH || 'main';
  // Build on the CURRENT intent.md in the repository, not a stale copy.
  const file = await gh('GET', '/contents/intent.md?ref=' + encodeURIComponent(branch));
  const current = Buffer.from(file.content, 'base64').toString('utf8');
  const doc = agents.compose(current, reqs);
  if (!doc.ready) throw new HttpError(409, 'Definition of Ready failed: ' + doc.openDecisions + ' decision(s) Open.');
  const head = await gh('GET', '/git/ref/heads/' + encodeURIComponent(branch));
  const slug = reqs.map((r) => r.id.toLowerCase()).join('-');
  const name = 'intent/' + slug + '-' + Math.random().toString(36).slice(2, 6);
  await gh('POST', '/git/refs', { ref: 'refs/heads/' + name, sha: head.object.sha });
  await gh('PUT', '/contents/intent.md', {
    message: 'Spec v' + doc.version + ': ' + reqs.map((r) => r.title).join('; '),
    content: Buffer.from(doc.markdown, 'utf8').toString('base64'), sha: file.sha, branch: name,
  });
  const eng = reqs.some((r) => r.risk && r.risk.verdict === 'HUMAN_REVIEW');
  const body = ['Approved in the Request Workspace by the product owner.', '',
    ...reqs.flatMap((r) => ['### ' + r.id + ': ' + r.title, '- Why: ' + r.fields.why, '- Who benefits: ' + r.fields.beneficiaries,
      '- Risk lane: ' + (r.risk.verdict === 'HUMAN_REVIEW' ? 'ENGINEER REVIEW (' + r.risk.categories.join(', ') + ')' : 'fast lane'),
      '- Product owner note: ' + ((r.po && r.po.note) || 'none'), '- Engineer note: ' + ((r.engineer && r.engineer.note) || 'n/a'), '']),
    'The Definition of Ready check runs on this pull request. Merge only after it passes.'].join('\n');
  const pr = await gh('POST', '/pulls', { title: 'Spec v' + doc.version + ': ' + reqs.map((r) => r.title).join('; '), head: name, base: branch, body });
  if (eng) { try { await gh('POST', '/issues/' + pr.number + '/labels', { labels: ['risk:engineer'] }); } catch (e) { /* label is a nicety */ } }
  for (const r of reqs) { r.github = { number: pr.number, url: pr.html_url, branch: name }; log(r, 'product_owner', 'pushed intent.md as a pull request', '#' + pr.number + ' ' + name); }
  store.save();
  return { number: pr.number, url: pr.html_url, branch: name, version: doc.version };
});

route('POST', /^\/api\/intent\/compose$/, async (req) => {
  const ids = (await readBody(req)).ids || [];
  const reqs = ids.map(getReq);
  if (!reqs.length) throw bad('Choose at least one request.');
  if (reqs.some((r) => !r.draft)) throw bad('Every chosen request needs a draft.');
  const out = agents.compose(files.read('intent.md'), reqs);
  log(null, role(req), 'composed intent.md', 'v' + out.version + ' from ' + ids.join(', '));
  store.save();
  return out;
});

// --- patient portal ---
route('GET', /^\/api\/patients$/, () => {
  const s = store.get();
  return { flags: s.flags, config: { a1cTarget: V.CONFIG.a1cTarget, a1cMin: V.CONFIG.a1cMin, a1cMax: V.CONFIG.a1cMax },
    patients: s.patients.map((p) => ({ id: p.id, name: p.name, readings: p.readings.slice(-12).map((x) => Object.assign({}, x, { status: V.a1cStatus(x.a1c) })) })) };
});

route('POST', /^\/api\/patients\/(\w+)\/readings$/, async (req, res, m) => {
  const s = store.get();
  const p = s.patients.find((x) => x.id === m[1]);
  if (!p) throw new HttpError(404, 'Patient not found');
  const b = await readBody(req);
  const a = V.validateHbA1c(b.a1c); if (!a.ok) throw bad(a.error);
  const d = V.validateDate(b.date); if (!d.ok) throw bad(d.error);
  const reading = { id: 'r' + Math.random().toString(36).slice(2, 8), a1c: a.value, date: b.date, source: b.source === 'photo' ? 'photo' : 'manual' };
  const hasBp = (b.sys !== undefined && b.sys !== '') || (b.dia !== undefined && b.dia !== '');
  if (hasBp) {
    if (!s.flags.bp) throw bad('Blood pressure tracking is not switched on.');
    const bp = V.validateBP(b.sys, b.dia); if (!bp.ok) throw bad(bp.error);
    reading.sys = bp.sys; reading.dia = bp.dia;
  }
  p.readings.push(reading);
  log(null, 'patient', 'reading added', p.name + (reading.source === 'photo' ? ' (from photo)' : ''));
  store.save();
  return { ok: true, reading: Object.assign({}, reading, { status: V.a1cStatus(reading.a1c) }) };
});

route('POST', /^\/api\/vision$/, async (req) => {
  limit(req);
  const b = await readBody(req);
  const mt = String(b.mediaType || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mt)) throw bad('Use a JPEG, PNG or WebP photo.');
  const data = String(b.data || '');
  if (!data || data.length > 5 * 1024 * 1024) throw bad('Photo is missing or too large.');
  let out;
  try { out = await agents.readImage(mt, data); }
  catch (e) { out = { kind: 'unknown', a1c: null, sys: null, dia: null, confidence: 'low', note: 'The reader could not process this photo. Please type the value.', layer: 'failed' }; }
  // Code validates what the model read.
  if (out.a1c != null && !V.validateHbA1c(out.a1c).ok) { out.note = 'The number read is outside the possible range, so it was discarded.'; out.a1c = null; out.kind = 'unknown'; }
  if (out.sys != null && !V.validateBP(out.sys, out.dia).ok) { out.sys = null; out.dia = null; if (out.kind === 'bp') out.kind = 'unknown'; }
  log(null, 'vision-reader', 'photo read', out.kind + ' | ' + out.layer);
  return out; // the image is not stored
});

// --- feature flag (kill switch) ---
route('POST', /^\/api\/flags$/, async (req) => {
  const r = role(req);
  if (r === 'requester') throw new HttpError(403, 'Only the product owner or an engineer can change a feature switch.');
  if (r !== 'engineer') need(req, 'product_owner'); else need(req, 'engineer');
  const b = await readBody(req);
  store.get().flags.bp = !!b.bp;
  log(null, r, 'blood pressure tracking ' + (b.bp ? 'switched ON' : 'switched OFF'));
  store.save();
  return store.get().flags;
});

route('POST', /^\/api\/demo\/reset$/, (req) => {
  if (process.env.ALLOW_RESET === '0') throw new HttpError(403, 'Reset disabled.');
  need(req, 'product_owner');
  store.reset();
  return { ok: true };
});

// ---------- server ----------
// Local/one-host mode: the server also serves the three front-ends. On Render they are separate static sites.
const WEB = path.join(__dirname, 'web');
function serveStatic(req, res, pathname) {
  if (pathname === '/') { res.writeHead(302, { location: '/control-room/' }); return res.end(); }
  let rel = pathname.replace(/\/+$/, '/index.html' ).replace(/\/$/, '/index.html');
  if (/^\/(control-room|workspace|patient)$/.test(pathname)) { res.writeHead(302, { location: pathname + '/' }); return res.end(); }
  if (/\/$/.test(pathname)) rel = pathname + 'index.html';
  rel = rel.replace(/^\/(control-room|workspace|patient)\/shared\//, '/shared/');
  const full = path.normalize(path.join(WEB, rel));
  if (!full.startsWith(WEB)) return send(res, 404, 'Not found');
  fs.readFile(full, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

function cors(req, res) {
  const allow = process.env.CORS_ORIGINS || '*';
  const origin = req.headers.origin;
  const ok = allow === '*' || (origin && allow.split(',').map((x) => x.trim()).includes(origin));
  if (ok) {
    res.setHeader('access-control-allow-origin', allow === '*' ? '*' : origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type,x-access-code,x-role,x-role-code');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  try {
    const rt = routes.find((r) => r.method === req.method && r.rx.test(pathname));
    if (!rt) throw new HttpError(404, 'Not found');
    if (!rt.opts.open && process.env.ACCESS_CODE && req.headers['x-access-code'] !== process.env.ACCESS_CODE) throw new HttpError(401, 'Access code required.');
    const out = await rt.fn(req, res, pathname.match(rt.rx), Object.fromEntries(url.searchParams));
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
  }
});

if (require.main === module) {
  const port = +process.env.PORT || 3000;
  store.load();
  server.listen(port, () => console.log('Care Companion on :' + port + ' | model: ' + (claude.live() ? claude.model() : 'not connected (scripted mode)')));
}
module.exports = { server };
