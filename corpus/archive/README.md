# Corpus Archive

This folder is populated by `npm run corpus:download`.

Expected layout:

```
archive/<document-id>/<artifact-file>
```

Do not allow `/api/chat` to download or refresh these files. Corpus refresh is an explicit maintainer action followed by validation and re-ingestion.

This build pack could not prefetch the public GPPB files from the current artifact environment, so raw source bytes are intentionally not fabricated. The included downloader will fetch approved URLs and record SHA-256 hashes in `manifest.lock.json` in the developer/build environment.
