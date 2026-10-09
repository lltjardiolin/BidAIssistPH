// Per-IP fixed-window rate limit for /api/chat (PDR B9). Counted in Postgres so the limit holds across
// serverless instances; falls back to an in-memory counter if the database is unreachable.
import crypto from 'node:crypto';
import { query } from './db';

const MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const WINDOW = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 600);
const memory = new Map<string, { start: number; count: number }>();

// X-Forwarded-For is "client, proxy1, proxy2". Entries to the left of our own proxy are supplied by the caller
// and can be forged, so the address is counted from the right: 1 = one trusted proxy (Caddy/nginx) in front.
const PROXY_HOPS = Math.max(1, Number(process.env.RATE_LIMIT_PROXY_HOPS || 1));

export function clientIp(headers: Headers): string {
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return chain[chain.length - PROXY_HOPS] ?? chain[0] ?? headers.get('x-real-ip') ?? 'unknown';
}

function clientKey(req: Request): string {
  const ip = clientIp(req.headers);
  // Only a salted hash is stored — never the raw address.
  return crypto.createHash('sha256').update(`${process.env.RATE_LIMIT_SALT ?? 'bidaissistph'}:${ip}`).digest('hex').slice(0, 32);
}

async function hit(key: string, windowStart: number): Promise<number> {
  try {
    const { rows } = await query<{ count: number }>(
      `insert into rate_limits (key, window_start, count) values ($1, to_timestamp($2), 1)
       on conflict (key, window_start) do update set count = rate_limits.count + 1
       returning count`,
      [key, windowStart]);
    if (Math.random() < 0.02) query(`delete from rate_limits where window_start < now() - interval '1 day'`).catch(() => {});
    return rows[0].count;
  } catch {
    const m = memory.get(key);
    if (!m || m.start !== windowStart) { memory.set(key, { start: windowStart, count: 1 }); return 1; }
    return ++m.count;
  }
}

/** Returns a 429 Response when the caller is over the limit, otherwise null. */
export async function rateLimit(req: Request): Promise<Response | null> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW);
  const count = await hit(clientKey(req), windowStart);
  if (count <= MAX) return null;
  const retryAfter = windowStart + WINDOW - now;
  return Response.json(
    { error: 'rate_limited', message: `Too many questions. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
    { status: 429, headers: { 'retry-after': String(retryAfter) } });
}
