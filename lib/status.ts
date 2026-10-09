// Status presentation shared by badges, callouts and the About page. Status is always text + colour (C3).
import type { Status } from './evidence-policy';

export const STATUS_STYLE: Record<Status, { badge: string; label: string; meaning: string }> = {
  CURRENT: { badge: 'bg-status-current-bg text-status-current-fg', label: 'CURRENT', meaning: 'In force under RA 12009.' },
  HISTORICAL: { badge: 'bg-status-historical-bg text-status-historical-fg', label: 'HISTORICAL', meaning: 'RA 9184-era; may apply to transitional procurement.' },
  REFERENCE: { badge: 'bg-status-reference-bg text-status-reference-fg', label: 'REFERENCE', meaning: 'FAQ or GPPB-TSO opinion; interpretive, not Board policy.' },
  PROPOSED: { badge: 'bg-status-proposed-bg text-status-proposed-fg', label: 'PROPOSED', meaning: 'A bill. Not law.' },
  WITHDRAWN: { badge: 'bg-status-withdrawn-bg text-status-withdrawn-fg', label: 'WITHDRAWN', meaning: 'Must not be cited as current.' },
  SUPERSEDED: { badge: 'bg-status-superseded-bg text-status-superseded-fg', label: 'SUPERSEDED', meaning: 'Replaced by a later issuance.' },
};

export const FRAMEWORK_LABEL: Record<string, string> = { RA12009: 'RA 12009', RA9184: 'RA 9184', BOTH: 'RA 9184 + RA 12009' };

export const KIND_LABEL: Record<string, string> = {
  law: 'Statute', bill: 'Bill', irr: 'IRR', resolution: 'Resolution', circular: 'Circular', advisory: 'Advisory',
  opinion: 'TSO opinion', manual: 'Manual', faq: 'FAQ', comparison: 'Comparison', opinion_collection: 'Opinions',
};
