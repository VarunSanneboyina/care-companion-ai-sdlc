'use strict';
// Tests the code agent RUNNER with a fake Claude. They prove the rules around the model
// (allowed files, exact edits, tests must pass, no guessing), not the quality of Claude's code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const RUNNER = path.join(REPO, 'scripts', 'code_agent.js');

function fakeClaude(replies) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push(JSON.parse(b));
      const r = replies[Math.min(seen.length - 1, replies.length - 1)];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, () => ok({ srv, seen, url: 'http://127.0.0.1:' + srv.address().port })));
}

function fixture(opts) {
  opts = opts || {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  const w = (p, c) => { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), c); };
  w('agents/code-agent.md', 'instructions'); w('CLAUDE.md', 'rules');
  w('app/lib/greet.js', "module.exports = { greet: () => 'hello' };\n");
  w('tests/greet.test.js', '');
  w('intent.md', '# spec v1\n');
  const g = (c) => execSync(c, { cwd: d, stdio: 'ignore' });
  g('git init -q -b main'); g('git config user.email a@b'); g('git config user.name x'); g('git add -A'); g('git commit -qm one');
  w('intent.md', '# spec v1.1\n## Change 1.1\n- greet says hello twice\n' + (opts.open ? '| D1 | q | o | Open | |\n' : ''));
  g('git add -A'); g('git commit -qm two');
  return d;
}

function run(root, env) {
  return new Promise((ok) => {
    let log = '';
    const p = spawn('node', [RUNNER], { env: Object.assign({}, process.env, { AGENT_ROOT: root, DRY_RUN: '1', ANTHROPIC_API_KEY: 'k', MAX_ATTEMPTS: '3',
      TEST_CMDS: JSON.stringify(['node -e "process.exit(require(\'./app/lib/greet.js\').greet() === \'hello hello\' ? 0 : 1)"']) }, env) });
    p.stdout.on('data', (c) => (log += c)); p.stderr.on('data', (c) => (log += c));
    p.on('close', (code) => ok({ code, log }));
  });
}

const GOOD = { title: 'Greet twice', summary: 'greet says hello twice', switchOff: 'revert', assumptions: [], questions: [],
  edits: [{ path: 'app/lib/greet.js', action: 'replace', find: "'hello'", replace: "'hello hello'" }] };

test('a good plan is applied, tests pass, dry run reports a pull request', async () => {
  const c = await fakeClaude([GOOD]); const d = fixture();
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 0, r.log);
  assert.match(r.log, /DRY RUN: would open a pull request/);
  assert.match(r.log, /app\/lib\/greet\.js/);
  assert.strictEqual(c.seen.length, 1);
  assert.match(JSON.stringify(c.seen[0].messages[0]), /hello twice/); // the model was shown the spec change
});

test('edits to forbidden files are rejected and the model must correct itself', async () => {
  const bad = Object.assign({}, GOOD, { edits: GOOD.edits.concat([{ path: '.github/workflows/ci.yml', action: 'create', content: 'x' }]) });
  const c = await fakeClaude([bad, GOOD]); const d = fixture();
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 0, r.log);
  assert.strictEqual(c.seen.length, 2);
  assert.match(JSON.stringify(c.seen[1].messages.slice(-1)), /Not allowed to change/);
  assert.ok(!fs.existsSync(path.join(d, '.github')));
});

test('a find text that does not match exactly once is rejected', async () => {
  const bad = Object.assign({}, GOOD, { edits: [{ path: 'app/lib/greet.js', action: 'replace', find: 'nope', replace: 'x' }] });
  const c = await fakeClaude([bad, GOOD]); const d = fixture();
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 0, r.log);
  assert.match(JSON.stringify(c.seen[1].messages.slice(-1)), /matched 0 times/);
});

test('failing tests go back to the model; after three failures no pull request is opened', async () => {
  const wrong = Object.assign({}, GOOD, { edits: [{ path: 'app/lib/greet.js', action: 'replace', find: "'hello'", replace: "'hello once'" }] });
  const c = await fakeClaude([wrong]); const d = fixture();
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 1, r.log);
  assert.strictEqual(c.seen.length, 3);
  assert.match(r.log, /No pull request was opened/);
  assert.strictEqual(fs.readFileSync(path.join(d, 'app/lib/greet.js'), 'utf8'), "module.exports = { greet: () => 'hello' };\n"); // tree restored
});

test('the model can ask questions instead of guessing', async () => {
  const c = await fakeClaude([{ questions: ['What is the maximum value?'], edits: [] }]); const d = fixture();
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 0, r.log);
  assert.match(r.log, /It will not guess/);
  assert.ok(fs.existsSync(path.join(d, 'agent-questions.md')));
});

test('an Open decision in intent.md blocks the build before the model is called', async () => {
  const c = await fakeClaude([GOOD]); const d = fixture({ open: true });
  const r = await run(d, { ANTHROPIC_BASE_URL: c.url });
  c.srv.close();
  assert.strictEqual(r.code, 0, r.log);
  assert.match(r.log, /still has Open decisions/);
  assert.strictEqual(c.seen.length, 0);
});

test('without an API key it stops and changes nothing', async () => {
  const d = fixture();
  const r = await run(d, { ANTHROPIC_API_KEY: '' });
  assert.strictEqual(r.code, 1);
  assert.match(r.log, /ANTHROPIC_API_KEY/);
});
