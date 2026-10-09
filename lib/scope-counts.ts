// Documents per scope tab, computed from the manifest with the same rules as the SQL filter in scopes.ts.
import { indexedDocs } from './manifest';
import { SCOPES, SCOPE_KEYS, type ScopeDef, type ScopeKey } from './scopes';
import type { ManifestDoc } from './types';

export function inScope(d: ManifestDoc, scope: ScopeKey): boolean {
  const s: ScopeDef = SCOPES[scope];
  if (!s.includeNonDefault && d.index_default === false) return false;
  if (s.statuses && !s.statuses.includes(d.status)) return false;
  if (s.ids && !s.ids.includes(d.id)) return false;
  if (s.types && !s.types.includes(d.type)) return false;
  if (s.framework && d.framework !== s.framework) return false;
  return true;
}

export const scopeCounts = Object.fromEntries(
  SCOPE_KEYS.map(k => [k, indexedDocs.filter(d => inScope(d, k)).length]),
) as Record<ScopeKey, number>;
