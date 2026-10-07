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
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) { const e = new Error('Model reply had no JSON'); e.raw = String(text || '').trim(); throw e; }
  return JSON.parse(m[0]);
}

// Asks for JSON. If the model answers in prose, tell it so and ask once more.
// A failure carries the model's own words in error.raw so callers can still use them.
async function askJson(opts) {
  const first = await ask(opts);
  try { return parseJson(first); } catch (e1) {
    console.error('model reply was not JSON (first 200 chars):', String(first).slice(0, 200));
    const retry = Object.assign({}, opts, { messages: opts.messages.concat([
      { role: 'assistant', content: String(first || '').trim() || '(no reply)' },
      { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the single JSON object described in your instructions. No explanation, no code fences, nothing before or after it.' },
    ]) });
    const second = await ask(retry);
    try { return parseJson(second); } catch (e2) {
      console.error('retry was not JSON either (first 200 chars):', String(second).slice(0, 200));
      e2.raw = String(first || '').trim() || String(second || '').trim();
      throw e2;
    }
  }
}

module.exports = { ask, askJson, live, model, parseJson };
