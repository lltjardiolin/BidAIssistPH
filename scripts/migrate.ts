// Applies db/*.sql in order, with the pinned embedding dimension (ENGINEERING_HANDOFF Gate 1).
// Usage: npm run db:migrate            (idempotent)
//        npm run db:migrate -- --reset (drops all tables first — required when the embedding dimension changes)
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool } from '../lib/db';
import { EMBEDDING_DIMENSIONS } from '../lib/embeddings';

const ROOT = path.resolve(import.meta.dirname, '..');
const pool = getPool();
try {
  if (process.argv.includes('--reset')) {
    await pool.query('drop table if exists chunks, document_versions, document_aliases, corpus_releases, rate_limits, documents cascade');
    console.log('Dropped existing tables.');
  }
  const files = (await fs.readdir(path.join(ROOT, 'db'))).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = (await fs.readFile(path.join(ROOT, 'db', f), 'utf8'))
      .replace(/vector\(1536\)/g, `vector(${EMBEDDING_DIMENSIONS})`);
    await pool.query(sql);
    console.log(`Applied ${f}`);
  }
  const { rows } = await pool.query(
    `select format_type(atttypid, atttypmod) t from pg_attribute where attrelid = 'chunks'::regclass and attname = 'embedding'`);
  if (rows[0]?.t !== `vector(${EMBEDDING_DIMENSIONS})`)
    throw new Error(`chunks.embedding is ${rows[0]?.t}, expected vector(${EMBEDDING_DIMENSIONS}). Re-run with --reset.`);
  console.log(`Schema applied (embedding ${rows[0].t}).`);
} finally {
  await pool.end();
}
