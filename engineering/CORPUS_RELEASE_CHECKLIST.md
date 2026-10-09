# Corpus Release Checklist

- [ ] Every production-indexed artifact exists under `corpus/archive/`.
- [ ] Every artifact has SHA-256, retrieval timestamp, byte count and content type in `manifest.lock.json`.
- [ ] Every source marked unverified in `manifest.json` has been manually resolved or excluded.
- [ ] Blank/secondary URLs are not used as production ground truth unless approved.
- [ ] Withdrawn/superseded documents are excluded from default retrieval.
- [ ] Replacement/counterpart relationships resolve to valid IDs.
- [ ] Evaluation facts are checked against the exact archived artifact.
- [ ] `corpus_version` updated when released corpus bytes change.
- [ ] Production chat has no web/search/fetch tool for legal data.
- [ ] Every ingested document approved via `corpus:approve` (reviewer + timestamp in lock).
- [ ] Embedding model and dimension recorded in `corpus_releases`.
- [ ] `npm run corpus:release-check` passes.
