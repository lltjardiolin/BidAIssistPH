#!/usr/bin/env bash
# Dumps the index (documents, chunks with embeddings, releases) so it can be restored without re-embedding.
# Usage: npm run db:backup
# Restore: gunzip -c <file> | docker exec -i bidaissist-pg psql -U postgres bidaissist
set -euo pipefail
cd "$(dirname "$0")/.."
CONTAINER="${PG_CONTAINER:-bidaissist-pg}"
DB="${PG_DATABASE:-bidaissist}"
mkdir -p storage/backups
out="storage/backups/bidaissist-$(date +%Y%m%d-%H%M%S).sql.gz"
# pg_dump runs inside the container so its version always matches the server.
docker exec "$CONTAINER" pg_dump -U postgres --no-owner --no-privileges "$DB" | gzip > "$out"
gunzip -t "$out"
echo "Wrote $out ($(du -h "$out" | cut -f1))"
# Keep the five most recent backups.
ls -1t storage/backups/bidaissist-*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm --
