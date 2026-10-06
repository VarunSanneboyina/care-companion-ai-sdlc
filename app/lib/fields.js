'use strict';
// The request template as data. Completeness is checked in CODE, not by the model:
// a request is ready only when every required field is answered.
const TOUCH_OPTIONS = ['Payments', 'Login or permissions', 'Personal or health data', 'Clinical thresholds or advice', 'None of these'];

const REQUIRED = [
  ['why', 'Why is this needed?'],
  ['beneficiaries', 'Who will benefit, and how?'],
  ['problem', 'What happens today that this fixes?'],
  ['outcome', 'What should be different when it is done?'],
  ['howItWorks', 'How will it work, step by step?'],
  ['acceptance', 'How will we know it works? (at least two checks)'],
  ['touches', 'Does it touch payments, login, health data or clinical rules?'],
];

const empty = () => ({ why: '', beneficiaries: '', problem: '', outcome: '', howItWorks: '', acceptance: [], touches: [], outOfScope: '', undecided: [] });

function missing(f) {
  const out = [];
  for (const [key, label] of REQUIRED) {
    const v = f[key];
    const ok = key === 'acceptance' ? Array.isArray(v) && v.filter(Boolean).length >= 2
      : key === 'touches' ? Array.isArray(v) && v.length > 0
        : typeof v === 'string' && v.trim().length >= 3;
    if (!ok) out.push({ key, label });
  }
  return out;
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 2000);

function normalize(b, prev) {
  b = b || {}; prev = prev || empty();
  const pick = (k) => (b[k] === undefined ? prev[k] : b[k]);
  return {
    why: str(pick('why')), beneficiaries: str(pick('beneficiaries')), problem: str(pick('problem')),
    outcome: str(pick('outcome')), howItWorks: str(pick('howItWorks')), outOfScope: str(pick('outOfScope')),
    acceptance: (Array.isArray(pick('acceptance')) ? pick('acceptance') : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 12),
    touches: (Array.isArray(pick('touches')) ? pick('touches') : []).filter((t) => TOUCH_OPTIONS.includes(t)),
    undecided: (Array.isArray(pick('undecided')) ? pick('undecided') : []).filter((u) => u && u.question)
      .map((u) => ({ question: str(u.question, 300), owner: str(u.owner || 'Product owner', 60) })).slice(0, 10),
  };
}

module.exports = { TOUCH_OPTIONS, REQUIRED, empty, missing, normalize };
