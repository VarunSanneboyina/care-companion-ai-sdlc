'use strict';
// A stand-in for the Anthropic API so the app can be tested without a key or network.
const http = require('http');

let mode = 'json'; // 'json' | 'prose-then-json' | 'prose'
function setMode(m) { mode = m; }

function reply(system, body) {
  const last = body.messages[body.messages.length - 1];
  const lastText = typeof last.content === 'string' ? last.content : '';
  const isRetry = /not valid JSON/.test(lastText);
  if (mode === 'prose' || (mode === 'prose-then-json' && !isRetry)) return 'Thanks! Could you tell me a bit more about who will benefit from this?';
  if (/Vision Reader/.test(system)) {
    return JSON.stringify({ kind: 'hba1c', a1c: 7.4, sys: null, dia: null, confidence: 'high', note: 'Reads 7.4 %' });
  }
  if (/Risk-check agent for Care Companion/.test(system)) {
    const sec = /card|payment/i.test(lastText);
    return JSON.stringify({ verdict: sec ? 'HUMAN_REVIEW' : 'AUTO', categories: sec ? ['PAYMENTS'] : [], reason: sec ? 'Stores card details.' : 'Display only.', checklist: sec ? ['Confirm no card data stored'] : [] });
  }
  if (/Spec Drafter/.test(system)) {
    return JSON.stringify({ section: '- Patients submit blood pressure.\n- Acceptance: invalid readings are rejected.', screen: 'Two new fields: Systolic and Diastolic.', decisions: /blood pressure|hypertension/i.test(lastText) ? [{ question: 'Who approves the thresholds?', owner: 'Clinical lead' }] : [] });
  }
  if (/Requirement Interviewer/.test(system)) {
    const n = body.messages.filter((m) => m.role === 'user').length;
    const done = n >= 3;
    return JSON.stringify({
      reply: done ? 'I have what I need.' : 'Question ' + n + '?',
      fields: done ? { why: 'Care coordinators want one view of diabetes and hypertension.', beneficiaries: 'Care coordinators and patients.', problem: 'Coordinators cannot see blood pressure.', outcome: 'Show blood pressure beside HbA1c.', howItWorks: 'Patient enters two numbers; the list shows the latest.', acceptance: ['Invalid values rejected', 'Valid values appear'], touches: ['Personal or health data', 'Not a real option'], undecided: [] } : { why: 'Care coordinators want one view.' },
      ready: done,
    });
  }
  return '{}';
}

function start(port) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      calls.push({ url: req.url, key: req.headers['x-api-key'], system: body.system, model: body.model });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: reply(body.system || '', body) }] }));
    });
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({ srv, calls })));
}
module.exports = { start, setMode };
