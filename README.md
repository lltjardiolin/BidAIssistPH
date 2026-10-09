# BidAIssistPH

A closed-corpus, citation-first RAG assistant for Philippine government procurement law.

> *Which document says that, which version applies, and where exactly does it say it?*

Built for Week 14 — *Ship Your Own RAG* (Graded Mini Project 14.3). The full specification is
`docs/BidAIssistPH_PDR_Build_Spec_v3.1.md`; `CHANGES_v3.2.md` takes precedence where they differ.

## What it does

- Answers only from documents that were downloaded, hashed and indexed **before** the question was asked.
  There is no web search, no scraping and no fallback to model knowledge at chat time.
- Retrieval is a tool call (`retrieveEvidence`), forced on the first step of every turn.
- Every source carries a status (CURRENT, HISTORICAL, REFERENCE, PROPOSED, WITHDRAWN, SUPERSEDED), a
  framework (RA 9184 / RA 12009) and an authority level. Withdrawn editions never enter the default pool.
- If no eligible document supports an answer, the app says
  *"I couldn't verify that from the available procurement documents."* That decision is made in code,
  not by the model.

## Architecture

```text
Browser (useChat · scope tabs · source cards)
   │  POST /api/chat { messages, scope }
   ▼
app/api/chat/route.ts ── validation · rate limit · UI message stream
   │
lib/chat.ts ── streamText(model = OpenAI | MiniMax)
   │     step 1: toolChoice = retrieveEvidence (forced)      step 2: toolChoice = none (must answer)
   ▼
lib/retrieval.ts
   alias normalization ─ lib/aliases.ts     "HB 7917" = "HB 07917" = "House Bill No. 7917"
   hybrid query        ─ vector (pgvector) + lexical (tsvector) + exact identifiers → RRF
   deterministic rerank─ exact id · section · status fit · authority · title overlap
   companion expansion ─ lib/companions.ts  withdrawn_by / superseded_by / counterpart
   evidence policy gate─ lib/evidence-policy.ts   labels each block or abstains
   ▼
Postgres + pgvector (documents · chunks · document_versions · corpus_releases)
```

### Grounding guard

`lib/guard.ts` sits between the model and the reader. The model's text is held back line by line and each
statement is checked, in code, against the source it cites:

| Check | Example of what it removes |
|---|---|
| Numbers, identifiers and section numbers are in the cited source | "Executive Order No. 138", "Sec. 99" |
| Dates match a date in the source as a whole | "25 March 2025" when the source says 25 February 2025 |
| Named laws, orders, bodies and acronyms are in the source | "Government Procurement Modernization Act" |
| At least 60% of the statement's wording is in the source | statements from the model's general knowledge |
| A withdrawn, historical or proposed source is not stated as the current rule or as law | "the March 2026 IRR is the current rule" |
| Statements that lean on a removed statement go with it | "These frameworks are currently in effect" |

A statement with a missing or wrong citation is kept only if one retrieved source supports it, and then
carries that source's marker.

Answers still stream. A statement is released as soon as the next one has begun, provided its outcome cannot
depend on text that has not arrived: it carries its own citation, or one source clearly supports it. A
statement that relies on a citation later in its line waits for the end of that line, and holds back what
follows it so the order never changes. Tests check that the text shown is identical whether the answer
arrives whole or one character at a time. If nothing survives, the reader gets the fixed abstention sentence and the
list of sources. The guard is not a model and takes no instructions from the text it checks.

Its limit: it verifies that the facts in a statement are in the cited source, not that the model combined
them correctly. Two true facts from one passage can still be joined wrongly.

### Follow-up questions

`lib/conversation.ts` decides whether a question continues the previous one ("What about for infrastructure
projects?") and, if so, searches it together with the question it follows. A question that names its own
document, or changes topic, is searched alone.

After the stream completes, `lib/citations.ts` checks that every `[E#]` exists and how many claims carry
no citation; the UI shows a "Partially verified" banner when more than 20% do not.

## Stretch goals

1. **Hybrid retrieval** — vector + lexical + exact-identifier search merged with reciprocal rank fusion.
2. **Evaluation harness** — 50 questions, code evaluators plus two LLM judges, results published on the site.

## Setup

Requires Node 20+, Postgres with pgvector, and (for scanned PDFs only) `pdftoppm` from poppler-utils.

```bash
npm install
cp .env.example .env.local          # fill in the values below
npm run corpus:download             # archive + corpus/manifest.lock.json (sha256 per file)
npm run corpus:validate
npm run db:migrate
# open each archived file, confirm dates and text, then:
npm run corpus:approve -- --by "<your name>" <DOCUMENT_ID> ...
npm run corpus:ingest               # approved artifacts only
npm run corpus:release-check        # production gate
npm run smoke                       # retrieval checks, no LLM
npm run dev                         # http://127.0.0.1:3100
```

For development before the documents have been reviewed: `npm run corpus:ingest -- --allow-unapproved`.
That index is marked as a development index in `corpus/INGESTION_NOTES.md` and does not pass
`corpus:release-check`.

### Environment variables

Names only. None may be prefixed `NEXT_PUBLIC_`.

| Name | Purpose |
|---|---|
| `APP_ENV` | `development` · `staging` · `production` |
| `LLM_PROVIDER` | `openai` · `minimax` · `mock` (offline, development/CI only) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | OpenAI chat model (default `gpt-4.1-mini`; effort applies to gpt-5 / o-series only) |
| `MINIMAX_API_KEY`, `MINIMAX_MODEL` | MiniMax chat model (default `minimax-m3`) |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | Embeddings; pinned per corpus release |
| `DATABASE_URL` | Postgres with pgvector |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `LOGFIRE_SERVICE_NAME`, `TRACE_CONTENT` | Tracing to Pydantic Logfire |
| `JUDGE_BASE_URL`, `JUDGE_MODEL`, `JUDGE_API_KEY` | LLM judge; must differ from the model under test |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_SALT`, `RATE_LIMIT_PROXY_HOPS` | Per-IP limit on `/api/chat` |
| `RETRIEVAL_TIMEOUT_MS` | Default 4000 |

Changing the embedding model or dimension requires `npm run db:migrate -- --reset` and a full re-ingest.

## Corpus

`corpus/manifest.json` is the registry; `corpus/INGESTION_NOTES.md` records pages, OCR pages and chunk
counts per document. The `/about` page lists every indexed document with its status and source link.

| Scope tab | Documents |
|---|---|
| RA 12009 + IRR | RA 12009; NGPA IRR (Res. 02-2025) |
| GPPB issuances | Resolutions and circulars 2025–2026; Public Advisory 09-2026 |
| TSO opinions | GPPB-TSO NPM 2026 series, 30 opinions (028 and 030 are not posted) |
| RA 9184 (historical) | 2016 Revised IRR; Res. 27-2019; Res. 06-2024; Generic Procurement Manuals |
| Withdrawn & superseded | IRR 1st Edition as of 31 March 2026 |
| Bills | HB 07917 — An Act Amending RA 12009 (official House bill text, filed 23 Feb 2026) |

### Open items that need a person

| Item | Effect until resolved |
|---|---|
| Every archived file must be reviewed and approved (`corpus:approve`) | `corpus:release-check` fails |
| HB 07917: official House bill text archived 2026-10-08 | Resolved; post-filing status still unverified |
| RA 9184 statute PDF | Only the 2016 IRR represents the old framework |
| RA 12009: GPPB certified copy archived 2026-10-08 | Resolved |
| Circulars 04-2026 and 05-2026: file names say "prefinal" | Release blocker (`release_note`) |
| RA 9184 vs RA 12009 comparative matrix | Not indexed |
| Ground truth for the evaluation set | No row is scored until a person verifies it |

## Evaluation

Results are written to `evaluation/results/*.json` and shown on the `/evaluation` page. Every model and judge
call is traced in Pydantic Logfire when tracing is configured.

```bash
npm run eval                            # scored experiment (VERIFIED rows only)
EXP=C npm run eval                      # experiments A–D (A and B also need a fixed-chunk re-ingest)
EVAL_SCOPE=all npm run eval             # force one scope instead of each question's own tab
npm run eval -- --local                 # do not upload, even if a key is set
npm run eval -- --retrieval-only        # no LLM
npm run eval -- --include-pending       # development only; results are marked UNVERIFIED
```

`evaluation/evaluation.csv` holds the 50 questions. Ground truth is written and checked by a person
against the archived PDFs, never by the model under test. A row is scored only when
`ground_truth_status=VERIFIED`, which requires `verified_by`, `verified_at` and `expected_answer`.

| Experiment | Chunking | Retrieval | Rerank |
|---|---|---|---|
| A | fixed 600 / 100 | vector, top 5 | off |
| B | fixed 900 / 150 | vector, top 5 | off |
| C | section-aware | hybrid, top 8 | off |
| D (production) | section-aware | hybrid, 20 current + 8 historical → 6 | on + companions |

The evidence policy gate runs in every experiment.

## Design

The interface is set as an annotated law book. An answer is a page of text; each source is a note in the
margin beside the passage that first cites it, and its status is a rubber stamp. Tokens are in
`styles/tokens.css`.

| Element | Choice |
|---|---|
| Page | One white sheet on a grey-violet desk |
| Accent | Stamp-pad violet, `#5B2A86` |
| Status | Ink stamps: the word is always written, colour only repeats it |
| Type | Literata for answers and headings, Hanken Grotesk for notes and controls |
| Layout | Text column of at most 68 characters, with a 300 px margin for sources; one column on phones |

This replaces the colours, typefaces and three-column layout in Part C of the specification. Every text
pair is at least 4.5:1, focus is visible, and motion is limited to the stamp appearing (off when reduced
motion is requested).

## Tracing (Logfire)

`instrumentation.ts` registers OpenTelemetry at server start and sends traces to Logfire when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. Each question is one trace: the request, the agent run
(`bidaissist-research-assistant`), the `retrieveEvidence` tool call, the query embedding and the model call,
with timings and token counts.

By default traces hold no question, passage or answer text and no visitor address. Set `TRACE_CONTENT=true`
to record questions, passages and answers; tell visitors if you do. The write token is send-only and lives
in `.env.local` and `.logfire/`, both ignored by git.

## Tests

```bash
npm test             # unit tests: evidence policy, aliases, ingestion, citations, scopes
npm run typecheck
npm run smoke        # retrieval against the real index
```

## Opportunities (Phase 2 preview)

`/opportunities` lists procurement notices and, for each one, the corpus documents that govern its mode
(the Rule Lens). The lens is a fixed mapping in `lib/opportunities.ts`, checked by tests; no language model
is involved. Notices are never embedded or retrieved by chat.

Notices are read once a day from the public PhilGEPS "Open Opportunities" listing by
`scripts/sync-philgeps.ts` (`npm run notices:sync`): only notices published in the last 7 days, newest
first, at most 300, one request every 1.5 seconds. Values are read from labelled fields on the page by a
parser (`lib/philgeps.ts`), not by a language model. The contact person and creator shown on a notice are
not stored. Every notice links to its original posting. Until the first sync has run, labelled sample
notices are shown instead.

This page is outside the graded scope and is not one of the two stretch goals.

## Deploy (Vercel)

The hosted stack is OpenAI for chat and embeddings plus a managed Postgres with pgvector (Supabase; Neon or
similar also works).

1. Create the database. From a machine that holds the archived corpus, run against it:

   ```bash
   DATABASE_URL=<hosted url> EMBEDDING_PROVIDER=openai EMBEDDING_MODEL=text-embedding-3-small \
   EMBEDDING_DIMENSIONS=1536 EMBEDDING_API_KEY=<openai key> \
   npm run db:migrate && npm run corpus:ingest && npm run corpus:release-check
   ```

2. Import the repository into Vercel and add these variables to **Production** and **Preview**:

   | Name | Value |
   |---|---|
   | `APP_ENV` | `production` |
   | `LLM_PROVIDER` | `openai` |
   | `OPENAI_API_KEY`, `OPENAI_MODEL` | your key; `gpt-4.1-mini` or another chat model |
   | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY` | `openai`, `text-embedding-3-small`, `1536`, your key — identical to step 1 |
   | `DATABASE_URL` | the hosted Postgres URL |
   | `RATE_LIMIT_SALT` | any long random string |
   | `RATE_LIMIT_PROXY_HOPS` | `1` |

3. `vercel.json` pins the function region to `sin1` (Singapore); move it next to the database if needed.
4. Open the production URL in an incognito window and run the checks in PDR F1.

Production refuses `LLM_PROVIDER=mock`. The embedding model and dimension must match the ones the corpus
was ingested with (recorded in the `corpus_releases` table). Changing environment variables in Vercel needs
a redeploy.

## Disclaimer

BidAIssistPH provides document-grounded information from its indexed Philippine procurement sources. It is
not legal advice or official procurement guidance. Rules and issuances change; verify important decisions
against the latest official source.
