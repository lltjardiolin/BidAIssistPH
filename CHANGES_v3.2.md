# BidAIssistPH Build Pack — v3.2 review changes

Your v3.1 edits (closed-corpus rule, lockfile, evidence gate, ground-truth gate, scope freeze, release blockers) are kept as written. v3.2 fixes the gaps found in review.

## Release blockers fixed

| # | Problem in v3.1 | Fix in v3.2 |
|---|---|---|
| 1 | `validate-corpus` always failed: the comparison matrix has no URL | Manifest entries now carry `ingest: true/false` + `ingest_blocker`; excluded entries don't need a URL |
| 2 | Five sources were HTML index pages or news (RA 9184, 2016 IRR, NPM collection, GPM index page, HB 07917 news article); ingest would have chunked navigation menus or journalism as law | Marked `ingest:false` with the reason; GPM ingests only its volume PDFs (`ingest_fields`). **The TSO opinions tab stays empty until the 30 NPM PDF URLs are added.** |
| 3 | No way to mark an artifact as human-verified; `verified_for_ingest` was always false | New `npm run corpus:approve -- --by "<name>" <ids>`; approvals survive re-download only if the bytes are unchanged |
| 4 | Loading `documents` in manifest order violates the self-reference FK (withdrawn IRR → Adv. 09-2026 appears later) | FKs are `deferrable initially deferred`; load in one transaction |
| 5 | `applyEvidencePolicy` accepted a WITHDRAWN block when a replacement *id* existed even if the replacement wasn't retrieved; its mixed-framework rule only looked at CURRENT evidence (so it never fired) and, had it fired, would abstain on legitimate questions like "What governed procurement before RA 12009?" | Rewritten: withdrawn/superseded blocks survive only if the replacement is in the evidence set; each block is labelled (CURRENT_RULE, HISTORICAL_ONLY, VERSION_ONLY, PROPOSAL_ONLY, INTERPRETIVE_ONLY); mixed frameworks are flagged, not abstained; version-only evidence abstains. Type-checked and unit-tested. |
| 6 | Downloader had no timeout/retry; a blocked page or soft 404 served with HTTP 200 was archived as the "PDF" | 60 s timeout, 3 retries with backoff, polite delay, `%PDF-` magic-byte check, change detection vs the previous lock |
| 7 | Validator ignored download failures, documents with zero artifacts, and HTML stored where a PDF was expected | All three checked; `--release` mode also requires approvals and fails on any `release_note` |
| 8 | Embedding model/dimension never pinned (MiniMax has no embedding model) | `EMBEDDING_PROVIDER / MODEL / DIMENSIONS` in `.env.example`; `corpus_releases` table records them per corpus version |
| 9 | `package.json` used `"latest"` everywhere (AI SDK majors change APIs) | Exact versions pinned (checked on npm, 28 Sep 2026); `pgvector`, `tsx`, `@types/pg` added |

## Still open (need a human, not code)

1. **30 NPM opinion PDF URLs** → add child entries (`GPPB-NPM-001-2026` …).
2. **RA 9184 statute PDF and 2016 IRR PDF URLs.**
3. **HB 07917 official House record** (bill text + status snapshot).
4. **RA 12009 official copy** — resolved 2026-10-08: GPPB-hosted certified PDF archived and indexed.
5. **Res. 08-2026 annexes** for Circulars 04-2026 and 05-2026 have "prefinal" in the file name — confirm they are final.
6. **Pick the embedding model.**
7. **HTML extraction path** for Adv. 09-2026 and the NGPA FAQ (HTML pages, ingest:true).
8. Match the `ai` major version to the course starter if it pins an older one; provider packages must share the same `@ai-sdk/provider` major.
