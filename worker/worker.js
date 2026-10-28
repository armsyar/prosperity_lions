/**
 * Prosperity Lions chat proxy (Cloudflare Worker)
 *
 * Sits between the GitHub Pages site and the Claude API so the API key
 * never reaches the browser.
 *
 * Deployed by Cloudflare straight from this GitHub repo, using wrangler.jsonc
 * at the repo root. That file sets the Worker's name, the allowed site and
 * pins the Worker to US East, so it never runs in a region Anthropic blocks.
 *
 * The only setting typed into Cloudflare by hand
 * (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (Secret, required)  your key from console.anthropic.com
 *
 * Optional, in wrangler.jsonc "vars":
 *   ALLOWED_ORIGIN  sites allowed to use the chat, comma-separated
 *   MODEL           defaults to claude-haiku-4-5-20251001
 *   MAX_PER_HOUR    messages per visitor per hour, default 30
 *
 * Health check: open the Worker address in a browser.
 * Add ?test=1 to also send Claude a tiny test message.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;          // length cap on each lion reply
const MAX_SYSTEM_CHARS = 12000;  // the lion's character brief
const MAX_MESSAGES = 20;         // conversation turns kept
const MAX_MESSAGE_CHARS = 2000;  // per turn

// Best-effort per-visitor limit. It lives in each Worker instance's memory,
// so it is a speed bump, not a guarantee. The Console spending limit is the real cap.
const hits = new Map();

// Turn "https://Name.github.io/repo/ " (stray spaces, invisible characters,
// capitals or a path) into "https://name.github.io" so small typos can't block the chat.
function normOrigin(s) {
  const clean = String(s || '').replace(/[^\x21-\x7E]/g, '').toLowerCase();
  try { return new URL(clean).origin; } catch { return clean.replace(/\/+$/, ''); }
}
function allowedList(env) {
  return String(env.ALLOWED_ORIGIN || '').split(',').map(normOrigin).filter(Boolean);
}

// Explain Claude API refusals in plain words.
function explain(status, type, message) {
  if (status === 401) return 'The API key is wrong, expired or deleted. Create a new key and update ANTHROPIC_API_KEY.';
  if (status === 403 && /not allowed/i.test(message || '')) return 'Claude refused this location. Check the Worker runs outside Hong Kong (see "runs_in").';
  if (status === 403) return 'The key does not have permission. Check the key and your Console account.';
  if (status === 400 && /credit|billing|balance/i.test(message || '')) return 'Your Anthropic account is out of credit. Add credit in the Console under Billing.';
  if (status === 404) return 'The model name is not available to this key.';
  if (status === 429) return 'Rate or spend limit reached. Wait, or raise limits in the Console.';
  if (status >= 500) return 'Claude is busy or having trouble. Try again shortly.';
  return '';
}

// Which Cloudflare data centre this Worker is running in right now.
async function whereAmI() {
  try {
    const t = await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text();
    const colo = (t.match(/^colo=(.+)$/m) || [])[1] || '?';
    const loc = (t.match(/^loc=(.+)$/m) || [])[1] || '?';
    return `${colo} (${loc})${colo === 'HKG' ? ': Hong Kong, Claude will refuse requests from here' : ''}`;
  } catch { return 'unknown'; }
}

async function health(request, env, allowed, origin, okOrigin) {
  const key = env.ANTHROPIC_API_KEY || '';
  const out = {
    worker: 'Prosperity Lions chat proxy is running',
    runs_in: await whereAmI(),
    api_key_saved: key ? `yes (${key.length} characters, starts ${key.slice(0, 7)}…)` : 'NO: add ANTHROPIC_API_KEY as a Secret in Settings → Variables and Secrets',
    allowed_origin: allowed.length ? allowed : 'NOT SET: add ALLOWED_ORIGIN to wrangler.jsonc',
    model: env.MODEL || DEFAULT_MODEL,
    ...(origin ? { calling_site: origin, calling_site_allowed: okOrigin } : {}),
  };
  if (new URL(request.url).searchParams.get('test') === '1' && key) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const recent = (hits.get(ip) || []).filter(t => Date.now() - t < 3600e3);
    if (recent.length >= 10) out.claude_test = 'skipped: too many tests this hour';
    else {
      recent.push(Date.now()); hits.set(ip, recent);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: out.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }),
      });
      if (r.ok) out.claude_test = 'PASS reply received';
      else {
        let type = '', message = '';
        try { const j = await r.json(); type = j.error && j.error.type || ''; message = j.error && j.error.message || ''; } catch {}
        out.claude_test = `FAIL (HTTP ${r.status}) ${type}: ${message}`;
        const why = explain(r.status, type, message);
        if (why) out.what_to_do = why;
      }
    }
  }
  return JSON.stringify(out, null, 2);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    // Errors are readable by the calling page so it can show what went wrong.
    // This shares no data: a refused site still gets no reply from Claude.
    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, error, extra) =>
      new Response(JSON.stringify({ error, ...(extra || {}) }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    try {
      return await handle(request, env, origin, cors, reply);
    } catch (e) {
      console.log('Worker crashed', (e && e.stack) || e);
      return reply(500, 'worker_crashed', { detail: String((e && e.message) || e) });
    }
  },
};

async function handle(request, env, origin, cors, reply) {
  const allowed = allowedList(env);
  const okOrigin = allowed.includes(normOrigin(origin));

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' || request.method === 'HEAD') {
    const body = await health(request, env, allowed, origin, okOrigin);
    return new Response(request.method === 'HEAD' ? null : body,
      { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return reply(405, 'method_not_allowed');
  if (!okOrigin) return reply(403, 'origin_not_allowed', { your_site: origin, allowed_sites: allowed });
  if (!env.ANTHROPIC_API_KEY) return reply(500, 'missing_api_key');

  // rate limit
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limit = parseInt(env.MAX_PER_HOUR || '30', 10);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (recent.length >= limit) return reply(429, 'rate_limited');
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();

  // validate body
  let body;
  try { body = await request.json(); } catch { return reply(400, 'bad_json'); }
  const system = typeof body.system === 'string' ? body.system.slice(0, MAX_SYSTEM_CHARS) : '';
  if (!Array.isArray(body.messages)) return reply(400, 'bad_messages');

  // tidy the turns: only user/assistant text, merge repeats, start with the guest
  const messages = [];
  for (const m of body.messages.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.slice(0, MAX_MESSAGE_CHARS);
    if (!content.trim()) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + content;
    else messages.push({ role: m.role, content });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return reply(400, 'last_turn_must_be_user');
  if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(The guest opened the chat.)' });

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    console.log('Claude API error', upstream.status, text);
    let type = '', message = '';
    try { const j = JSON.parse(text); type = j.error && j.error.type || ''; message = j.error && j.error.message || ''; } catch {}
    const status = upstream.status === 429 || upstream.status === 529 ? 429 : 502;
    return reply(status, status === 429 ? 'rate_limited' : 'upstream_error',
      { claude_status: upstream.status, detail: `${type}: ${message}`, what_to_do: explain(upstream.status, type, message) });
  }

  // stream Claude's reply straight through to the page
  return new Response(upstream.body, {
    headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
