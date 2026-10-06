'use strict';
// Risk-check agent, JavaScript version (the GitHub Action uses scripts/risk_check.py with the same rules).
// Two layers: keyword rules (always) + model judgement (if a key is set). The STRICTER result wins.

const claude = require('./claude');
const files = require('./files');

const RULES = {
  PAYMENTS: /\b(pay|payment|billing|bill|invoice|refund|fee|price|charge|card|subscription|checkout|wallet|upi)\b/i,
  SECURITY: /\b(login|log in|sign in|password|otp|2fa|token|role|permission|access|admin|auth|session|encrypt)\b/i,
  PERSONAL_DATA: /\b(blood pressure|bp|diagnos|prescription|medication|phone|email|address|aadhaar|dob|date of birth|export|share|upload|photo|image|record|consent)\b/i,
  CLINICAL_LOGIC: /\b(threshold|target|alert|risk score|dose|dosing|advice|recommend|above target|below target|critical|normal range)\b/i,
};
const TOUCH_MAP = {
  'Payments': 'PAYMENTS',
  'Login or permissions': 'SECURITY',
  'Personal or health data': 'PERSONAL_DATA',
  'Clinical thresholds or advice': 'CLINICAL_LOGIC',
};
const TOUCH_OPTIONS = require('./fields').TOUCH_OPTIONS;

function rulesLayer(text, touches) {
  const cats = new Set(Object.entries(RULES).filter(([, rx]) => rx.test(text)).map(([c]) => c));
  (touches || []).forEach((t) => TOUCH_MAP[t] && cats.add(TOUCH_MAP[t]));
  return [...cats].sort();
}

function requestText(req) {
  const f = req.fields || {};
  return [req.title, req.wish, f.why, f.beneficiaries, f.problem, f.outcome, f.howItWorks, f.outOfScope,
    (f.acceptance || []).join('\n'), (f.undecided || []).map((u) => u.question).join('\n')].filter(Boolean).join('\n');
}

const SYSTEM = [
  'You are the Risk-check agent for Care Companion, a sample healthcare product.',
  'Decide whether the change request needs a human engineer.',
  'Send to HUMAN_REVIEW if it touches ANY of: PAYMENTS, SECURITY, PERSONAL_DATA, CLINICAL_LOGIC.',
  'Changes that only filter or reorder data already shown, or only change appearance, are AUTO.',
  'When unsure, choose HUMAN_REVIEW.',
  'Reply with ONLY JSON: {"verdict":"AUTO"|"HUMAN_REVIEW","categories":[...],"reason":"one sentence","checklist":["what the engineer should verify"]}',
].join('\n');

async function assess(req) {
  const text = requestText(req);
  const cats = rulesLayer(text, (req.fields || {}).touches);
  let verdict = cats.length ? 'HUMAN_REVIEW' : 'AUTO';
  let reason = cats.length ? 'Rules layer matched: ' + cats.join(', ') : 'No risk keywords and nothing ticked.';
  let checklist = [];
  let layer = 'rules only (no model connected)';
  let outCats = cats;

  if (claude.live()) {
    try {
      const m = await claude.askJson({
        system: SYSTEM + '\n\nCurrent spec (intent.md):\n' + files.read('intent.md'),
        messages: [{ role: 'user', content: text }],
        maxTokens: 600,
      });
      layer = 'rules + model (' + claude.model() + ')';
      outCats = [...new Set([...cats, ...(m.categories || [])])].sort();
      checklist = Array.isArray(m.checklist) ? m.checklist : [];
      if (m.verdict === 'HUMAN_REVIEW') {
        verdict = 'HUMAN_REVIEW';
        reason = m.reason || reason;
      } else if (cats.length) {
        reason += ' (model said AUTO; the stricter rules result is kept)';
      } else {
        reason = m.reason || reason;
      }
    } catch (e) {
      layer = 'rules only (model call failed: ' + e.message.slice(0, 80) + ')';
    }
  }
  return { verdict, categories: outCats, reason, checklist, layer, at: new Date().toISOString() };
}

module.exports = { assess, rulesLayer, TOUCH_OPTIONS, TOUCH_MAP };
