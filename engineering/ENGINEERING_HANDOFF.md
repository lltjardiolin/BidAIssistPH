# Engineering Handoff — BidAIssistPH v3.2

## Build order

### Gate 0 — Corpus integrity
- Review `corpus/manifest.json` open items.
- Run downloader.
- Confirm MIME/content and generate `manifest.lock.json`.
- Manually resolve sources marked unverified before release.
- Approve each checked document with `npm run corpus:approve -- --by "<name>" <ids>`; approvals reset automatically if the file bytes change.
- Only `ingest:true` documents with approved artifacts are ingested. `ingest:false` entries carry an `ingest_blocker`.

### Gate 1 — Database
Pin `EMBEDDING_PROVIDER / EMBEDDING_MODEL / EMBEDDING_DIMENSIONS` first. Run `db/001_schema.sql` with the real dimension, load documents in one transaction (self-references are deferred), record the release in `corpus_releases`, then create the HNSW index.

### Gate 2 — Ingestion
Pipeline: archive → extract → normalize → sectionize → chunk → reference tokens → embeddings → DB upsert.

### Gate 3 — Retrieval
Implement exact identifier matching + lexical + vector search → RRF → deterministic rerank → companion expansion → `applyEvidencePolicy` (lib/evidence-policy.ts). If it returns `abstain`, the tool output carries `{ abstain: true }` and the UI renders the fixed abstention card regardless of model text.

### Gate 4 — Chat
The LLM receives evidence blocks only after `retrieveEvidence`. Never expose a web-search tool. Never retry an empty retrieval against the internet.

### Gate 5 — UI
Implement submission routes only. Keep Phase 2 routes stubbed or absent.

### Gate 6 — Evaluation
Only rows with `ground_truth_status=VERIFIED` are scored.

### Gate 7 — Deploy
Vercel production, server-only secrets, rate limit, incognito acceptance test.

## Release blockers
- missing archive hash for an indexed document
- unresolved blank source URL for a production-indexed document
- withdrawn document in default retrieval pool
- evaluation row scored while ground truth is pending
- any chat-time source fetch from the open web
- `npm run corpus:release-check` failing
- a `release_note` still present on an ingestible document
