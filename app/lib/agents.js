'use strict';
// The agents. Each one loads its instructions from the repository file, so what the UI shows is what the model gets.
const claude = require('./claude');
const files = require('./files');
const F = require('./fields');

const FIELDS_SPEC = `
Reply with ONLY JSON:
{"reply":"your next single question, or a short closing summary when complete",
 "fields":{"why":"","beneficiaries":"","problem":"","outcome":"","howItWorks":"","acceptance":["..."],"touches":["from: ${F.TOUCH_OPTIONS.join(' | ')}"],"outOfScope":"","undecided":[{"question":"","owner":"a role"}]},
 "ready":false}
Fill "fields" with everything learned so far, in the person's own facts (not only the latest answer). Leave a field empty if it has not been answered; never invent content.
Set ready true only when every one of these is answered: why, beneficiaries, problem, outcome, howItWorks, at least two acceptance checks, and touches.`;

// ---------- Requirement interviewer ----------
const QUESTIONS = [
  ['why', 'Why is this needed? What is the business or patient reason, and what happens if we do not do it?'],
  ['beneficiaries', 'Who will benefit from it, and how?'],
  ['problem', 'What happens today that this fixes? A real example helps.'],
  ['outcome', 'What should be different when it is done?'],
  ['howItWorks', 'How should it work? Walk me through what a user does, step by step.'],
  ['acceptance', 'How would you know it works? Give at least two checks that anyone could do.'],
  ['touches', 'Does it touch any of these: payments, login or permissions, personal or health data, clinical thresholds or advice? Say "none" if not.'],
  ['undecided', 'What is still undecided, and who decides it? Say "none" if nothing.'],
];

function scriptedInterview(req) {
  const answers = req.conversation.filter((m) => m.role === 'user').map((m) => m.content).slice(1); // [0] is the opening wish
  const f = F.empty();
  QUESTIONS.forEach(([key], i) => {
    const a = answers[i];
    if (a === undefined) return;
    if (key === 'acceptance') f.acceptance = a.split(/\n|;|\. (?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
    else if (key === 'touches') f.touches = /^\s*none/i.test(a) ? ['None of these'] : F.TOUCH_OPTIONS.filter((o) => o !== 'None of these' && new RegExp(o.split(' ')[0], 'i').test(a));
    else if (key === 'undecided') f.undecided = /^\s*none/i.test(a) ? [] : a.split(/\n|;/).map((x) => x.trim()).filter(Boolean).map((q) => ({ question: q, owner: 'Product owner' }));
    else f[key] = a;
  });
  const next = QUESTIONS[answers.length];
  const miss = F.missing(f);
  const ready = !next && miss.length === 0;
  const reply = next ? next[1] : ready ? 'Thank you. I have everything I need. Review the request, then draft the spec.'
    : 'A few answers were too short. Still needed: ' + miss.map((m) => m.label).join(' ');
  return { reply, fields: F.normalize(f), ready, layer: 'scripted (no model connected)' };
}

async function interview(req) {
  if (!claude.live()) return scriptedInterview(req);
  const system = files.read('agents/requirement-interviewer.md') +
    '\n\n--- CURRENT intent.md ---\n' + files.read('intent.md') +
    '\n\n--- TEMPLATE ---\n' + files.read('templates/intent-template.md') +
    '\n\n--- FIELDS SO FAR ---\n' + JSON.stringify(req.fields) + '\n' + FIELDS_SPEC;
  const messages = req.conversation.map((m) => ({ role: m.role, content: m.content }));
  // Remind the model of the output format right where it reads the latest answer.
  const last = messages[messages.length - 1];
  messages[messages.length - 1] = { role: last.role, content: last.content + '\n\n[Reply with ONLY the JSON object described in your instructions.]' };
  try {
    const r = await claude.askJson({ system, messages, maxTokens: 1000 });
    const f = F.normalize(r.fields || {}, req.fields); // empty/missing keys keep earlier answers
    // Completeness is decided by code, never by the model.
    const miss = F.missing(f);
    let reply = String(r.reply || '');
    let ready = miss.length === 0 && !!r.ready;
    if (r.ready && miss.length) reply = 'Before we finish I still need: ' + miss.map((m) => m.label).join(' ');
    if (!r.ready && miss.length === 0 && !reply) ready = true;
    return { reply, fields: f, ready, layer: 'model (' + claude.model() + ')' };
  } catch (e) {
    // Claude answered, but not as JSON. Use its own words as the next message rather than dropping to canned questions.
    if (e.raw && e.raw.length > 3 && !/^\s*[\[{]/.test(e.raw)) {
      const miss = F.missing(req.fields);
      return { reply: e.raw.slice(0, 1200), fields: req.fields, ready: false, missing: miss, layer: 'model (' + claude.model() + ', plain-text reply: answers were not captured into the template, so please edit them in tab 2)' };
    }
    const s = scriptedInterview(req);
    s.layer = 'scripted (model call failed: ' + e.message.slice(0, 80) + ')';
    return s;
  }
}

// ---------- Spec drafter + design ----------
function scriptedDraft(req) {
  const f = req.fields;
  const lines = [
    '- Why: ' + f.why,
    '- Who benefits: ' + f.beneficiaries,
    '- How it works: ' + f.howItWorks,
    ...(f.outOfScope ? ['- Out of scope: ' + f.outOfScope] : []),
    ...f.acceptance.map((a) => '- Acceptance: ' + a),
  ];
  return {
    section: lines.join('\n'),
    screen: 'Scripted placeholder (no model connected).\nProblem today: ' + f.problem + '\nWhat changes: ' + f.outcome + '\nNot changing: everything else in intent.md.',
    decisions: [],
    layer: 'scripted (no model connected)',
  };
}

async function draft(req) {
  if (!claude.live()) return scriptedDraft(req);
  const system = files.read('agents/spec-drafter.md') +
    '\n\n--- DESIGN INSTRUCTIONS ---\n' + files.read('agents/design-agent.md') +
    '\n\n--- CURRENT intent.md ---\n' + files.read('intent.md') +
    '\n\n--- TEMPLATE ---\n' + files.read('templates/intent-template.md') +
    '\n\nReply with ONLY the JSON described under "Output".';
  try {
    const r = await claude.askJson({
      system,
      messages: [{ role: 'user', content: 'Title: ' + req.title + '\n' + JSON.stringify(req.fields, null, 2) }],
      maxTokens: 1400,
    });
    return {
      section: String(r.section || '').trim(),
      screen: String(r.screen || '').trim(),
      decisions: Array.isArray(r.decisions) ? r.decisions.filter((d) => d && d.question).map((d) => ({ question: String(d.question), owner: String(d.owner || 'Product owner') })) : [],
      layer: 'model (' + claude.model() + ')',
    };
  } catch (e) {
    const s = scriptedDraft(req);
    s.layer = 'scripted (model call failed: ' + e.message.slice(0, 80) + ')';
    return s;
  }
}

// ---------- Vision reader ----------
async function readImage(mediaType, base64) {
  if (!claude.live()) return { kind: 'unknown', a1c: null, sys: null, dia: null, confidence: 'low', note: 'Demo mode: no model is connected, so please type the value.', layer: 'none' };
  const r = await claude.askJson({
    system: files.read('agents/vision-reader.md'),
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Read the number(s) in this photo. Reply with only the JSON described in your instructions.' },
    ] }],
    maxTokens: 300,
  });
  return {
    kind: ['hba1c', 'bp', 'unknown'].includes(r.kind) ? r.kind : 'unknown',
    a1c: typeof r.a1c === 'number' ? r.a1c : null,
    sys: typeof r.sys === 'number' ? r.sys : null,
    dia: typeof r.dia === 'number' ? r.dia : null,
    confidence: r.confidence === 'high' ? 'high' : 'low',
    note: String(r.note || '').slice(0, 200),
    layer: 'model (' + claude.model() + ')',
  };
}

// ---------- Compose intent.md from several requests (pure code) ----------
function compose(baseIntent, reqs) {
  const vm = baseIntent.match(/\(v(\d+)\.(\d+)\)/);
  let major = vm ? +vm[1] : 1, minor = vm ? +vm[2] : 0;
  const maxD = Math.max(0, ...[...baseIntent.matchAll(/\|\s*D(\d+)\s*\|/g)].map((m) => +m[1]));
  let n = maxD;
  const sections = [], rows = [];
  for (const r of reqs) {
    minor += 1;
    sections.push('## Change ' + major + '.' + minor + ': ' + r.title + '\n' + (r.draft.section || '').trim());
    for (const d of r.decisions || []) {
      n += 1;
      rows.push('| D' + n + ' | ' + d.question.replace(/\|/g, '/') + ' | ' + d.owner.replace(/\|/g, '/') + ' | ' + (d.status === 'Resolved' ? 'Resolved' : 'Open') + ' | ' + (d.status === 'Resolved' ? (d.resolution || '').replace(/\|/g, '/') : '') + ' |');
    }
  }
  let out = baseIntent.replace(/\(v\d+\.\d+\)/, '(v' + major + '.' + minor + ')');
  out = out.replace(/\n## Decisions/, '\n' + sections.join('\n\n') + '\n\n## Decisions');
  out = out.replace(/\s*$/, '\n') + rows.join('\n') + (rows.length ? '\n' : '');
  const open = (out.match(/\| Open \|/g) || []).length;
  return { markdown: out, version: major + '.' + minor, openDecisions: open, ready: open === 0 };
}

module.exports = { interview, draft, readImage, compose, QUESTIONS };
