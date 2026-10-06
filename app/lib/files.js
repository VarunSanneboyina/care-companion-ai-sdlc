'use strict';
// Reads the instruction files that live in the repository, so the app shows exactly what the agents are told.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Only these files can be shown in the UI.
function allowed(rel) {
  return /^agents\/[\w-]+\.md$/.test(rel) ||
    /^templates\/[\w-]+\.md$/.test(rel) ||
    ['intent.md', 'CLAUDE.md', '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/change-request.yml',
      'scripts/risk_check.py', 'app/lib/risk.js'].includes(rel);
}

function read(rel) {
  if (!allowed(rel)) throw new Error('File not available');
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listAgents() {
  const dir = path.join(ROOT, 'agents');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const title = (text.match(/^#\s+(.+)$/m) || [, f])[1];
    return { path: 'agents/' + f, title };
  });
}

module.exports = { read, listAgents, allowed, ROOT };
