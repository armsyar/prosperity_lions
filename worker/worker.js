/**
 * Prosperity Lions chat proxy (Cloudflare Worker)
 *
 * Sits between the GitHub Pages site and the Claude API so the API key
 * never reaches the browser.
 *
 * Settings (Cloudflare dashboard → your Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  (Secret, required)  your key from console.anthropic.com
 *   ALLOWED_ORIGIN     (Text, required)    e.g. https://yourname.github.io
 *                                          (several allowed: separate with commas)
 *   MODEL              (Text, optional)    defaults to claude-haiku-4-5-20251001
 *   MAX_PER_HOUR       (Text, optional)    messages per visitor per hour, default 30
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;          // length cap on each lion reply
const MAX_SYSTEM_CHARS = 12000;  // the lion's character brief
const MAX_MESSAGES = 20;         // conversation turns kept
const MAX_MESSAGE_CHARS = 2000;  // per turn

// Best-effort per-visitor limit. It lives in each Worker instance's memory,
// so it is a speed bump, not a guarantee. The Console spending limit is the real cap.
const hits = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, error) =>
      new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (request.method !== 'POST') return reply(405, 'method_not_allowed');
    if (!okOrigin) return reply(403, 'origin_not_allowed');
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
      const status = upstream.status === 429 || upstream.status === 529 ? 429 : 502;
      console.log('Claude API error', upstream.status, await upstream.text());
      return reply(status, status === 429 ? 'rate_limited' : 'upstream_error');
    }

    // stream Claude's reply straight through to the page
    return new Response(upstream.body, {
      headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  },
};
