import type { UIMessage } from 'ai';
import type { CitationCheck } from './citations';
import type { Label, Status } from './evidence-policy';

export type { Label, Status };
export type Framework = 'RA9184' | 'RA12009' | 'BOTH';

/** One manifest entry (corpus/manifest.json). Only the fields the app reads are typed. */
export type ManifestDoc = {
  id: string;
  reference: string;
  aliases: string[];
  type: string;
  framework: Framework;
  status: Status;
  authority_level: number;
  issuing_body: string;
  date_approved?: string | null;
  date_published?: string | null;
  date_filed?: string | null;
  date_issued?: string | null;
  effective_date?: string | null;
  withdrawn_date?: string | null;
  applies_from?: string | null;
  expires_at?: string | null;
  withdrawn_by?: string | null;
  superseded_by?: string | null;
  counterpart?: string | null;
  parent_id?: string | null;
  index_default?: boolean;
  source_url?: string | null;
  verification?: string;
  notes?: string;
  ingest?: boolean;
  ingest_blocker?: string;
  release_note?: string;
};

export type Manifest = {
  corpus_version: string;
  documents: ManifestDoc[];
  open_items: string[];
};

/** A chunk row as returned by the hybrid query (DB → retrieval). */
export type ChunkRow = {
  id: string;
  document_id: string;
  context_header: string;
  text: string;
  page: number | null;
  section: string | null;
  heading: string | null;
  framework: Framework;
  status: Status;
  authority_level: number;
  doc_type: string;
  reference_tokens: string[];
  score: number;
  vec_rank: number | null;
  lex_rank: number | null;
};

/** Evidence sent to the UI (structured) and, formatted, to the model. */
export type Evidence = {
  n: number;                // 1-based marker: [E1]
  id: string;               // chunk id
  documentId: string;
  reference: string;
  status: Status;
  framework: Framework;
  authority: number;
  kind: string;             // doc_type
  label: Label;
  section: string | null;
  page: number | null;
  issuingBody: string;
  dateLabel: string | null;
  note: string | null;      // "Withdrawn by … Use instead …"
  sourceUrl: string | null;
  companion: boolean;       // added by companion expansion, not by ranking
  text: string;
};

export type RetrievalResult = {
  abstain: boolean;
  reason: string | null;
  scope: string;
  corpusVersion: string;
  flags: { mixedFrameworks: boolean; hasProposal: boolean; hasOpinion: boolean; hasHistoricalOpinion: boolean; hasVersionEvidence: boolean } | null;
  evidence: Evidence[];
};

/** Message metadata streamed by /api/chat on start and finish. */
export type ChatMetadata = {
  scope: string;
  corpusVersion: string;
  toolCalled?: boolean;
  evidenceCount?: number;
  citations?: CitationCheck;
  /** Grounding guard: statements checked, shown, removed, and citations it corrected. */
  guard?: { checked: number; shown: number; removed: number; recited: number };
};
export type ChatMessage = UIMessage<ChatMetadata>;
