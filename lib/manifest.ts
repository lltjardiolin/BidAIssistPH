import raw from '../corpus/manifest.json';
import type { Manifest, ManifestDoc } from './types';

// The manifest ships with the app: it is local provenance metadata, never fetched at runtime.
export const manifest = raw as unknown as Manifest;
export const CORPUS_VERSION = manifest.corpus_version;
export const docsById = new Map<string, ManifestDoc>(manifest.documents.map(d => [d.id, d]));

/** Documents that can reach the retrieval index (ingest:true). */
export const indexedDocs = manifest.documents.filter(d => d.ingest !== false);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-02-25" → "25 Feb 2025" (PDR C7). Leaves free-text values such as "2025-11-21 (posted)" readable. */
export function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!m) return value;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}${m[4]}`;
}

export function dateLabel(d: ManifestDoc): string | null {
  const parts: string[] = [];
  if (d.date_filed) parts.push(`filed ${formatDate(d.date_filed)}`);
  if (d.date_approved) parts.push(`approved ${formatDate(d.date_approved)}`);
  if (d.date_published) parts.push(`published ${formatDate(d.date_published)}`);
  if (d.date_issued) parts.push(`issued ${formatDate(d.date_issued)}`);
  if (d.effective_date) parts.push(`effective ${formatDate(d.effective_date)}`);
  if (d.withdrawn_date) parts.push(`withdrawn ${formatDate(d.withdrawn_date)}`);
  return parts.length ? parts.join(', ') : null;
}

export function shortRef(d: ManifestDoc): string {
  return d.reference.split(' — ')[0];
}

/** "Withdrawn by … Use instead …" notes for source cards (FR-05). */
export function versionNote(d: ManifestDoc): string | null {
  if (d.status === 'WITHDRAWN' && d.withdrawn_by) {
    const by = docsById.get(d.withdrawn_by);
    const current = docsById.get('RA12009-IRR-2025');
    return `Withdrawn by ${by ? shortRef(by) : d.withdrawn_by}${d.withdrawn_date ? ` on ${formatDate(d.withdrawn_date)}` : ''}.` +
      (d.type === 'irr' && current ? ` Use instead: ${shortRef(current)}.` : '');
  }
  if (d.status === 'SUPERSEDED' && d.superseded_by) {
    const by = docsById.get(d.superseded_by);
    return `Superseded by ${by ? shortRef(by) : d.superseded_by}.`;
  }
  if (d.status === 'HISTORICAL' && d.counterpart) {
    const cp = docsById.get(d.counterpart);
    return `RA 9184-era document. Current counterpart: ${cp ? shortRef(cp) : d.counterpart}.`;
  }
  if (d.status === 'PROPOSED') return `Proposed bill — not law.${d.date_filed ? ` Filed ${formatDate(d.date_filed)}.` : ''}`;
  if (d.expires_at) return `Time-bound: applies ${d.applies_from ? `from ${formatDate(d.applies_from)} ` : ''}until ${formatDate(d.expires_at)}.`;
  return null;
}
