# BidAIssistPH — Developer Build Pack v3.2

This package is the implementation handoff for **BidAIssistPH**, a closed-corpus, citation-first RAG assistant for Philippine government procurement law.

## Non-negotiable architecture

1. Procurement source documents are downloaded and frozen **before runtime**.
2. The download job creates `corpus/manifest.lock.json` with hashes and local paths.
3. Only locked local artifacts are extracted, chunked and embedded.
4. Chat-time `retrieveEvidence` searches only the indexed BidAIssistPH corpus.
5. Chat-time procurement web search, scraping and remote URL fetching are prohibited.
6. No eligible evidence = abstain.

## Start in this order

```bash
npm install
cp .env.example .env.local
npm run corpus:download                       # archive + manifest.lock.json
npm run corpus:validate                       # dev check (warnings allowed)
# open each PDF, confirm dates/text, then:
npm run corpus:approve -- --by "<reviewer>" GPPB-RES-03-2025 ...
npm run db:migrate
npm run corpus:ingest                         # ingests ONLY approved artifacts of ingest:true documents
npm run corpus:release-check                  # production gate — must pass before deploy
npm run dev
```

See `docs/BidAIssistPH_PDR_Build_Spec_v3.1.md` for the complete product/build specification and `engineering/ENGINEERING_HANDOFF.md` for implementation sequencing.

## Important

The source registry contains several entries explicitly marked unverified/open. The downloader may archive them, but **the ingest/release policy must exclude unresolved sources from production retrieval and evaluation ground truth until verified**.


See `CHANGES_v3.2.md` for what the final review changed.
