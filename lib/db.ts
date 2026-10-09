import pg from 'pg';

// One pool per server instance (reused across hot reloads in dev).
const g = globalThis as unknown as { __bidPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (!g.__bidPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__bidPool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      ssl: /sslmode=require|supabase|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    // Scope filters are applied after the HNSW scan; iterative scans (pgvector ≥ 0.8) keep narrow tabs from
    // returning too few neighbours. Older pgvector ignores the failure and falls back to the default scan.
    g.__bidPool.on('connect', c => { c.query('set hnsw.iterative_scan = relaxed_order').catch(() => {}); });
  }
  return g.__bidPool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return getPool().query<T>(text, params);
}

/** pgvector literal: '[0.1,0.2,…]'. Passed as text and cast with ::vector. */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
