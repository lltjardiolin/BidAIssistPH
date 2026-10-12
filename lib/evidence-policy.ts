// Deterministic evidence gate (PDR B5.5). Runs after rerank + companion expansion,
// before evidence reaches the model. Pure function: easy to unit-test.

export type Status = 'CURRENT' | 'HISTORICAL' | 'REFERENCE' | 'PROPOSED' | 'WITHDRAWN' | 'SUPERSEDED';

export type Evidence = {
  id: string;
  documentId: string;
  status: Status;
  framework: 'RA9184' | 'RA12009' | 'BOTH';
  authorityLevel: number;
  text: string;
  withdrawnBy?: string | null;    // documents.withdrawn_by
  supersededBy?: string | null;   // documents.superseded_by
};

export type Label = 'CURRENT_RULE' | 'HISTORICAL_ONLY' | 'VERSION_ONLY' | 'PROPOSAL_ONLY' | 'INTERPRETIVE_ONLY' | 'HISTORICAL_OPINION';

export type PolicyResult =
  | { abstain: true; reason: 'no-eligible-evidence' | 'only-version-evidence'; eligible: []; labels: {}; flags: {} }
  | { abstain: false; reason: null; eligible: Evidence[]; labels: Record<string, Label>;
      flags: { mixedFrameworks: boolean; hasProposal: boolean; hasOpinion: boolean; hasHistoricalOpinion: boolean; hasVersionEvidence: boolean } };

export const ABSTAIN_MESSAGE = "I couldn't verify that from the available procurement documents.";

export function applyEvidencePolicy(evidence: Evidence[], opts: { compare?: boolean } = {}): PolicyResult {
  const present = new Set(evidence.map(e => e.documentId));

  // 1. WITHDRAWN/SUPERSEDED only survive when their replacement is actually in the evidence set.
  const eligible = evidence.filter(e => {
    if (e.status === 'WITHDRAWN') return !!e.withdrawnBy && present.has(e.withdrawnBy);
    if (e.status === 'SUPERSEDED') return !e.supersededBy || present.has(e.supersededBy);
    return true;
  });

  if (eligible.length === 0) return { abstain: true, reason: 'no-eligible-evidence', eligible: [], labels: {}, flags: {} };

  // 2. Label every block so the prompt and UI phrase it correctly.
  const labels: Record<string, Label> = {};
  for (const e of eligible) {
    labels[e.id] =
      e.status === 'WITHDRAWN' || e.status === 'SUPERSEDED' ? 'VERSION_ONLY'
      : e.status === 'PROPOSED' ? 'PROPOSAL_ONLY'
      // An RA 9184-era GPPB-TSO opinion is both: interpretive, and about the earlier framework.
      : e.authorityLevel >= 4 && e.status === 'HISTORICAL' ? 'HISTORICAL_OPINION'
      : e.authorityLevel >= 4 ? 'INTERPRETIVE_ONLY'
      : e.status === 'HISTORICAL' ? 'HISTORICAL_ONLY'
      : 'CURRENT_RULE';
  }

  // 3. Version evidence alone cannot answer anything except "is X still valid?" — the replacement must be present (ensured above).
  if (eligible.every(e => labels[e.id] === 'VERSION_ONLY'))
    return { abstain: true, reason: 'only-version-evidence', eligible: [], labels: {}, flags: {} };

  // 4. Mixed frameworks are allowed but flagged: the prompt keeps them separate, the UI shows a framework banner.
  //    (Abstaining here would break legitimate questions such as "What governed procurement before RA 12009?")
  const frameworks = new Set(eligible.filter(e => e.framework !== 'BOTH').map(e => e.framework));

  return {
    abstain: false, reason: null, eligible, labels,
    flags: {
      mixedFrameworks: frameworks.size > 1 && !opts.compare,
      hasProposal: eligible.some(e => e.status === 'PROPOSED'),
      hasOpinion: eligible.some(e => e.authorityLevel >= 4),
      hasHistoricalOpinion: eligible.some(e => labels[e.id] === 'HISTORICAL_OPINION'),
      hasVersionEvidence: eligible.some(e => labels[e.id] === 'VERSION_ONLY'),
    },
  };
}
