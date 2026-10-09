import { Workspace } from '@/components/workspace';
import { CORPUS_DATE, SHORT_DISCLAIMER } from '@/lib/copy';
import { isDemoMode } from '@/lib/env';
import { CORPUS_VERSION, indexedDocs } from '@/lib/manifest';
import { scopeCounts } from '@/lib/scope-counts';

// Rendered per request so the demo-mode notice always reflects the running configuration.
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Workspace
      counts={scopeCounts}
      corpusVersion={CORPUS_VERSION}
      corpusDate={CORPUS_DATE}
      indexedDocuments={indexedDocs.length}
      disclaimer={SHORT_DISCLAIMER}
      demoMode={isDemoMode}
    />
  );
}
