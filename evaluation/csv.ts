// Minimal RFC 4180 CSV reader/writer for the evaluation set (quoted fields, embedded commas and newlines).
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(f => f !== '')) rows.push(row); }
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export type EvalRow = {
  id: string; question: string; category: string; difficulty: string; scope: string;
  expected_documents: string[]; expected_sections: string[]; expected_status: string;
  should_abstain: boolean; expected_answer: string; verified_by: string; verified_at: string;
  ground_truth_status: 'VERIFIED' | 'PENDING' | 'EXCLUDED'; notes: string;
};

const list = (s: string) => s.split(/[;|]/).map(x => x.trim()).filter(Boolean);

export function toEvalRow(r: Record<string, string>): EvalRow {
  const status = (r.ground_truth_status || 'PENDING').toUpperCase();
  if (!['VERIFIED', 'PENDING', 'EXCLUDED'].includes(status)) throw new Error(`${r.id}: invalid ground_truth_status "${r.ground_truth_status}"`);
  // A row cannot be VERIFIED without a named human reviewer, a date and an expected answer (PDR E1.1).
  if (status === 'VERIFIED' && (!r.verified_by || !r.verified_at || (!r.expected_answer && r.should_abstain !== 'true')))
    throw new Error(`${r.id}: VERIFIED requires verified_by, verified_at and expected_answer`);
  return {
    id: r.id, question: r.question, category: r.category, difficulty: r.difficulty, scope: r.scope || 'all',
    expected_documents: list(r.expected_documents ?? ''), expected_sections: list(r.expected_sections ?? ''),
    expected_status: r.expected_status ?? '', should_abstain: r.should_abstain === 'true',
    expected_answer: r.expected_answer ?? '', verified_by: r.verified_by ?? '', verified_at: r.verified_at ?? '',
    ground_truth_status: status as EvalRow['ground_truth_status'], notes: r.notes ?? '',
  };
}
