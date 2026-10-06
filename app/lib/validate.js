'use strict';
// Validation is CODE, never the model. HbA1c rules are shared with the Pages app (docs/logic.js).
const path = require('path');
const L = require(path.join(__dirname, '..', '..', 'docs', 'logic.js'));

function validateBP(sys, dia) {
  const s = Number(sys), d = Number(dia);
  if (sys === '' || dia === '' || sys == null || dia == null || !isFinite(s) || !isFinite(d)) return { ok: false, error: 'Enter both blood pressure numbers.' };
  if (s < 50 || s > 300 || d < 30 || d > 200) return { ok: false, error: 'Blood pressure is outside the possible range.' };
  if (s <= d) return { ok: false, error: 'Systolic must be higher than diastolic.' };
  return { ok: true, sys: s, dia: d };
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Choose a date.' };
  const t = Date.parse(date + 'T00:00:00Z');
  if (!isFinite(t)) return { ok: false, error: 'Choose a valid date.' };
  if (t > Date.now() + 86400000) return { ok: false, error: 'The date cannot be in the future.' };
  return { ok: true };
}

module.exports = { validateBP, validateDate, validateHbA1c: L.validateHbA1c, a1cStatus: L.a1cStatus, CONFIG: L.CONFIG };
