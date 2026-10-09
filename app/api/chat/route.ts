import { convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, type UIMessage } from 'ai';
import { buildTools, streamAnswer, type GuardReport } from '@/lib/chat';
import { checkCitations } from '@/lib/citations';
import { CORPUS_VERSION } from '@/lib/manifest';
import { rateLimit } from '@/lib/rate-limit';
import { isScopeKey } from '@/lib/scopes';
import type { ChatMessage, RetrievalResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_INPUT_CHARS = 2000;
const MAX_HISTORY = 8;

// A local model answers one question at a time. Beyond this many questions in progress, new ones are turned
// away at once instead of queueing for minutes and slowing the whole machine. 0 = no limit (hosted models).
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_CHATS || 0);
const gate = globalThis as unknown as { __bidInFlight?: number };


const bad = (message: string, status = 400) => Response.json({ error: 'bad_request', message }, { status });

export async function POST(req: Request) {
  let body: { messages?: unknown; scope?: unknown };
  try { body = await req.json(); } catch { return bad('Invalid JSON body.'); }

  const scope = body.scope ?? 'all';
  if (!isScopeKey(scope)) return bad('Invalid scope.');
  if (!Array.isArray(body.messages) || body.messages.length === 0) return bad('messages must be a non-empty array.');

  // Earlier turns are kept as text, so a follow-up question is understood in context. Every question retrieves
  // again, so old evidence is not re-sent; old citation markers are removed because [E1] now means a new source.
  const history = (body.messages as UIMessage[]).slice(-MAX_HISTORY).map(m => ({
    role: m.role,
    parts: (m.parts ?? []).filter((p): p is Extract<UIMessage['parts'][number], { type: 'text' }> => p?.type === 'text')
      .map(p => (m.role === 'assistant' ? { ...p, text: p.text.replace(/\s*\[E\d{1,2}\]/g, '').slice(0, 1500) } : p)),
  })).filter(m => (m.role === 'user' || m.role === 'assistant') && m.parts.length > 0);

  const last = history.at(-1);
  if (!last || last.role !== 'user') return bad('The last message must be from the user.');
  const question = last.parts.map(p => p.text).join(' ').trim();
  if (!question) return bad('Empty question.');
  if (question.length > MAX_INPUT_CHARS) return bad(`Question is too long (max ${MAX_INPUT_CHARS} characters).`, 413);

  const limited = await rateLimit(req);
  if (limited) return limited;

  if (MAX_CONCURRENT && (gate.__bidInFlight ?? 0) >= MAX_CONCURRENT)
    return Response.json(
      { error: 'busy', message: 'Other questions are being answered right now. Please try again in about a minute.' },
      { status: 503, headers: { 'retry-after': '45' } });
  gate.__bidInFlight = (gate.__bidInFlight ?? 0) + 1;
  let released = false;
  const release = () => { if (!released) { released = true; gate.__bidInFlight = Math.max(0, (gate.__bidInFlight ?? 1) - 1); } };
  req.signal.addEventListener('abort', release);

  const report: GuardReport = { stats: null };
  const result = streamAnswer({
    messages: await convertToModelMessages(history, { tools: buildTools(scope) }),
    scope,
    abortSignal: req.signal,
    report,
  });

  // Collected while streaming so the citation check can run the moment the answer completes.
  let text = '';
  let toolCalled = false;
  let evidenceCount = 0;

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ReturnType<typeof buildTools>, ChatMessage>({
      stream: result.stream,
      sendReasoning: false,
      messageMetadata: ({ part }) => {
        if (part.type === 'text-delta') text += part.text;
        if (part.type === 'tool-result' && part.toolName === 'retrieveEvidence') {
          toolCalled = true;
          const out = part.output as RetrievalResult;
          if (!out.abstain) evidenceCount = out.evidence.length;
        }
        if (part.type === 'start') return { scope, corpusVersion: CORPUS_VERSION };
        if (part.type === 'finish' || part.type === 'error' || part.type === 'abort') release();
        if (part.type === 'finish' && report.stats?.removed)
          console.warn('[guard] removed', report.stats.removed, 'of', report.stats.checked, JSON.stringify(report.stats.reasons));
        if (part.type === 'finish')
          return {
            scope, corpusVersion: CORPUS_VERSION, toolCalled, evidenceCount, citations: checkCitations(text, evidenceCount),
            guard: report.stats
              ? { checked: report.stats.checked, shown: report.stats.shown, removed: report.stats.removed, recited: report.stats.recited }
              : undefined,
          };
        return undefined;
      },
      // Never leak provider or database error details to the browser.
      onError: error => {
        release();
        console.error('[chat]', error instanceof Error ? error.message : error);
        return "I couldn't retrieve the relevant procurement documents right now.";
      },
    }),
  });
}
