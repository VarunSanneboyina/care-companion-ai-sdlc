#!/usr/bin/env node
'use strict';
// Code agent runner. Runs in GitHub Actions after an intent.md change is merged to main.
//
// The split, as everywhere in this project:
//   MODEL (Claude) : reads the spec change and the code, proposes edits.
//   THIS SCRIPT    : decides which files may be touched, applies edits exactly, runs the tests,
//                    feeds failures back, opens the pull request. It never merges.
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL, BASE_SHA (commit before the merge), HEAD_SHA,
//      DRY_RUN=1 (apply + test, but no git push / no pull request), MAX_ATTEMPTS (default 3).
//      ANTHROPIC_BASE_URL is honoured by app/lib/claude.js (used by the tests to fake Claude).

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = process.env.AGENT_ROOT || path.join(__dirname, '..');
process.chdir(ROOT);
const claude = require(path.join(__dirname, '..', 'app', 'lib', 'claude.js'));
const risk = require(path.join(__dirname, '..', 'app', 'lib', 'risk.js'));

const DRY = process.env.DRY_RUN === '1';
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);
const MAX_EDITS = 30;
const MAX_BYTES = 80 * 1024;

// ---- Code decides what the agent may touch ----
const ALLOWED = [
  /^app\/server\.js$/, /^app\/lib\/[\w.-]+\.js$/, /^app\/web\/(patient|control-room|shared)\/[\w.-]+$/,
  /^app\/test\/[\w.-]+\.js$/, /^docs\/[\w.-]+$/, /^tests\/[\w.-]+\.js$/,
];
const FORBIDDEN = [/^\.github\//, /^agents\//, /^CLAUDE\.md$/, /^intent\.md$/, /^scripts\//, /^render\.yaml$/, /(^|\/)\.env/, /node_modules/];
const allowed = (p) => ALLOWED.some((r) => r.test(p)) && !FORBIDDEN.some((r) => r.test(p)) && !p.includes('..');

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function out(name, value) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, name + '=' + value + '\n'); }
function summary(md) { console.log(md); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); }

function listCode() {
  const found = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.posix.join(d === '.' ? '' : d.replace(/\\/g, '/'), n);
      if (n === 'node_modules' || n === '.git' || n === 'data') continue;
      if (fs.statSync(p).isDirectory()) walk(p); else if (allowed(p)) found.push(p);
    }
  })('.');
  return found.sort();
}

function applyEdits(edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('No edits were proposed.');
  if (edits.length > MAX_EDITS) throw new Error('Too many edits (' + edits.length + '). Keep the change small.');
  let bytes = 0;
  const touched = new Set();
  for (const e of edits) {
    const p = String(e.path || '');
    if (!allowed(p)) throw new Error('Not allowed to change "' + p + '". Allowed: the app, its tests, docs/ and tests/. Never .github, agents, scripts, intent.md.');
    if (e.action === 'create') {
      if (fs.existsSync(p)) throw new Error('"' + p + '" already exists; use a replace edit.');
      if (typeof e.content !== 'string') throw new Error('Create edit for "' + p + '" has no content.');
      bytes += e.content.length;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, e.content);
    } else if (e.action === 'replace') {
      if (!fs.existsSync(p)) throw new Error('"' + p + '" does not exist.');
      const cur = fs.readFileSync(p, 'utf8');
      const find = String(e.find || ''), rep = typeof e.replace === 'string' ? e.replace : null;
      if (!find || rep === null) throw new Error('Replace edit for "' + p + '" needs "find" and "replace".');
      const n = cur.split(find).length - 1;
      if (n !== 1) throw new Error('In "' + p + '" the "find" text matched ' + n + ' times (must be exactly 1): ' + find.slice(0, 80).replace(/\n/g, '\\n'));
      bytes += rep.length;
      fs.writeFileSync(p, cur.replace(find, () => rep));
    } else throw new Error('Unknown action "' + e.action + '" for "' + p + '".');
    touched.add(p);
  }
  if (bytes > MAX_BYTES) throw new Error('The change is too large (' + bytes + ' bytes). Keep it small.');
  return [...touched];
}

function runTests() {
  const cmds = process.env.TEST_CMDS ? JSON.parse(process.env.TEST_CMDS) : ['node --test tests/*.test.js', 'node --test --test-force-exit app/test/*.test.js'];
  let log = '';
  for (const c of cmds) {
    const r = spawnSync('bash', ['-c', c], { encoding: 'utf8', timeout: 180000 });
    const text = (r.stdout || '') + (r.stderr || '');
    const fails = text.split('\n').filter((l) => /^\s*(not ok|# (fail|pass|tests))|Error|expected|actual/i.test(l)).slice(0, 60).join('\n');
    log += '$ ' + c + '\n' + fails + '\n';
    if (r.status !== 0) return { ok: false, log };
  }
  return { ok: true, log };
}

function resetTree() { sh('git checkout -- . && git clean -fdq -- app docs tests'); }

(async () => {
  if (!claude.live()) { summary('The code agent needs the ANTHROPIC_API_KEY repository secret. Nothing was changed.'); process.exit(1); }

  // 1. What changed in the spec (the merged intent.md)
  const head = sh('git rev-parse ' + (process.env.HEAD_SHA || 'HEAD')).trim();
  const base = process.env.BASE_SHA && !/^0+$/.test(process.env.BASE_SHA) ? process.env.BASE_SHA : head + '~1';
  let diff = '';
  try { diff = sh('git diff ' + base + ' ' + head + ' -- intent.md'); } catch (e) { diff = ''; }
  const intent = fs.readFileSync('intent.md', 'utf8');
  if (!diff.trim()) { summary('intent.md did not change in this commit. Nothing to build.'); out('result', 'nothing'); return; }

  // 2. Definition of Ready, enforced in code
  const open = intent.split('\n').filter((l) => /\|\s*Open\s*\|/.test(l));
  if (open.length) { summary('Stopped: intent.md still has Open decisions, so the spec is not ready to build.\n\n' + open.join('\n')); out('result', 'blocked'); return; }

  // 3. Build the prompt: instructions file + spec + code
  const system = fs.readFileSync('agents/code-agent.md', 'utf8') + '\n\n---\n' + fs.readFileSync('CLAUDE.md', 'utf8');
  const code = listCode().map((p) => '=== FILE: ' + p + ' ===\n' + fs.readFileSync(p, 'utf8')).join('\n\n');
  const baseMsg = 'The product owner merged this change to intent.md (git diff):\n\n' + diff +
    '\n\nFull current intent.md:\n\n' + intent + '\n\nCurrent code you may change:\n\n' + code +
    '\n\nReply with ONLY the JSON object described in your instructions.';
  const messages = [{ role: 'user', content: baseMsg }];

  let plan = null, touched = [], tests = null, lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log('Attempt ' + attempt + ' of ' + MAX_ATTEMPTS);
    plan = await claude.askJson({ system, messages, maxTokens: 16000 });
    messages.push({ role: 'assistant', content: JSON.stringify(plan) });
    if (Array.isArray(plan.questions) && plan.questions.length && !(plan.edits || []).length) {
      const md = '## The code agent has questions\nIt will not guess. The spec needs these answered, then re-run:\n\n' + plan.questions.map((q) => '- ' + q).join('\n');
      fs.writeFileSync('agent-questions.md', md); summary(md); out('result', 'questions'); return;
    }
    resetTree();
    try { touched = applyEdits(plan.edits); }
    catch (e) { lastError = e.message; messages.push({ role: 'user', content: 'Your edits could not be applied: ' + e.message + '\nReturn the COMPLETE corrected JSON again (all edits, not only the fix).' }); continue; }
    tests = runTests();
    if (tests.ok) break;
    lastError = tests.log;
    messages.push({ role: 'user', content: 'The edits applied but the tests failed:\n' + tests.log + '\nReturn the COMPLETE corrected JSON again (all edits, starting from the original code).' });
    tests = null;
  }
  if (!tests || !tests.ok) {
    resetTree();
    summary('## The code agent could not produce a passing change in ' + MAX_ATTEMPTS + ' attempts\nNo pull request was opened.\n\n```\n' + String(lastError).slice(0, 3000) + '\n```');
    out('result', 'failed'); process.exit(1);
  }

  // 4. Risk: code decides the lane, the model cannot lower it
  const diffText = sh('git diff') + '\n' + diff;
  const cats = risk.rulesLayer(diffText, []);
  const engineer = cats.length > 0;
  const files = sh('git status --porcelain -uall').split('\n').filter(Boolean).map((l) => l.slice(3));

  const title = String(plan.title || 'Implement the merged spec change').slice(0, 90);
  const body = [
    '## What this change does', plan.summary || '', '',
    '## Why', 'The product owner merged a spec change to `intent.md`. This pull request builds it. The agent made no decisions that are not in the spec.', '',
    '## Files changed', ...files.map((f) => '- `' + f + '`'), '',
    '## Tests', 'The agent ran the full test suites before opening this pull request: **passed**.', '',
    '## Risk', engineer ? 'Keyword rules flagged: **' + cats.join(', ') + '**. **An engineer must review this** using `agents/engineer-review-checklist.md`.' : 'No risk keywords matched. Fast lane: a human still reviews and merges.', '',
    '## How to switch it off', plan.switchOff || 'See the Control Room feature switch if one was added; otherwise revert this pull request.', '',
    '## Assumptions and open points', ...((plan.assumptions || []).length ? plan.assumptions.map((a) => '- ' + a) : ['None.']), '',
    '_Written by the code agent (`agents/code-agent.md`, model ' + claude.model() + '). A human reviews and merges. The agent never merges its own work._',
  ].join('\n');

  if (DRY) { summary('DRY RUN: would open a pull request.\n\n' + title + '\n\n' + body); out('result', 'dry-run'); return; }

  // 5. Branch, commit, push, pull request
  const branch = 'agent/code-' + head.slice(0, 7);
  sh('git config user.name "care-companion-code-agent"');
  sh('git config user.email "code-agent@users.noreply.github.com"');
  sh('git checkout -b ' + branch);
  sh('git add -- ' + files.map((f) => JSON.stringify(f)).join(' '));
  fs.writeFileSync('.agent-commit-msg', title + '\n\nBuilt by the code agent from the merged change to intent.md.\n');
  sh('git commit -F .agent-commit-msg'); fs.unlinkSync('.agent-commit-msg');
  sh('git push -u origin ' + branch);
  fs.writeFileSync('.agent-pr-body.md', body);
  const labels = engineer ? ['risk:engineer'] : ['risk:auto'];
  labels.forEach((l) => { try { sh('gh label create "' + l + '" --force'); } catch (e) { /* label may exist */ } });
  const url = sh('gh pr create --title ' + JSON.stringify(title) + ' --body-file .agent-pr-body.md --base main --head ' + branch + ' --label ' + labels[0]).trim();
  summary('Opened pull request: ' + url);
  out('result', 'pr'); out('url', url);
})().catch((e) => { summary('The code agent crashed: ' + e.message); process.exit(1); });
