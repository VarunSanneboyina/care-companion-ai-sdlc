'use strict';
// Thin wrapper around the Anthropic Messages API. No SDK, no dependencies.
// The model is used for language. Code (not this file) decides permissions, numbers and routing.

const model = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const live = () => !!process.env.ANTHROPIC_API_KEY;

async function ask({ system, messages, maxTokens = 1000 }) {
  const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const r = await fetch(base + '/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: model(), max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) throw new Error('Model API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Model reply had no JSON');
  return JSON.parse(m[0]);
}

// Asks for JSON; retries once if the reply cannot be parsed.
async function askJson(opts) {
  let last;
  for (let i = 0; i < 2; i++) {
    try { return parseJson(await ask(opts)); } catch (e) { last = e; }
  }
  throw last;
}

module.exports = { ask, askJson, live, model, parseJson };
