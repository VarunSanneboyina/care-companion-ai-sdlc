'use strict';
// Tiny JSON-file store. Good enough for a demo. On Render's free plan the disk is wiped on redeploy/restart;
// attach a Render disk and set DATA_DIR to keep data.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'state.json');

function seed() {
  const r = (a1c, date) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), a1c, date, source: 'seed' });
  return {
    seq: 0,
    flags: { bp: false },
    requests: [],
    audit: [],
    patients: [
      { id: 'p1', name: 'Asha Verma', readings: [r(8.4, '2026-05-02'), r(7.8, '2026-08-02')] },
      { id: 'p2', name: 'Ravi Menon', readings: [r(6.9, '2026-05-11'), r(6.4, '2026-08-11')] },
      { id: 'p3', name: 'Meera Iyer', readings: [r(9.6, '2026-04-28'), r(9.1, '2026-07-28')] },
      { id: 'p4', name: 'Karan Shah', readings: [r(7.2, '2026-06-01'), r(6.9, '2026-09-01')] },
      { id: 'p5', name: 'Latha Nair', readings: [r(8.8, '2026-06-10'), r(8.2, '2026-09-10')] },
    ],
  };
}

let state;
function load() {
  try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = seed(); save(); }
  return state;
}
function save() {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { console.error('save failed', e.message); }
}
const get = () => state || load();

function audit(reqId, actor, event, detail) {
  const s = get();
  const entry = { ts: new Date().toISOString(), reqId: reqId || null, actor, event, detail: detail || '' };
  s.audit.push(entry);
  if (s.audit.length > 500) s.audit.shift();
  return entry;
}

function reset() { state = seed(); save(); return state; }

module.exports = { get, save, audit, reset, load };
