// The answer pipeline (PDR B5 / D5). One definition used by /api/chat and by the evaluation harness,
// so what is graded is exactly what is deployed.
import { isStepCount, streamText, tool, wrapLanguageModel, type LanguageModel, type StreamTextTransform, type ModelMessage, type StopCondition, type ToolSet } from 'ai';
import type { LanguageModelV4, LanguageModelV4Middleware, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { z } from 'zod';
import { contextualQuery } from './conversation';
import { AnswerGuard, type GuardStats } from './guard';
import { getChatModel, isOpenAIReasoningModel, maxOutputTokens, providerOptions } from './model';
import { SYSTEM_PROMPT, TOOL_DESCRIPTION } from './prompts';
import { AGENT_NAME, telemetryFor } from './telemetry';
import { formatEvidenceForModel, retrieveEvidence } from './retrieval';
import type { ScopeKey } from './scopes';
import type { RetrievalResult } from './types';

// One retrieval, then the answer. A single tool call per turn keeps [E#] markers unambiguous.
export const MAX_STEPS = 2;
// 4 s in production (B8). Local CPU-only embedding models need more: set RETRIEVAL_TIMEOUT_MS.
export const RETRIEVAL_TIMEOUT_MS = Number(process.env.RETRIEVAL_TIMEOUT_MS || 4000);

async function withTimeout<T>(run: () => Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`retrieval timed out after ${ms} ms`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Retrieval timeout 4 s + 1 retry (B8). A second failure surfaces as a tool error → UI error state. */
async function retrieveWithRetry(args: { query: string; compare?: boolean; scope: ScopeKey }): Promise<RetrievalResult> {
  try { return await withTimeout(() => retrieveEvidence(args), RETRIEVAL_TIMEOUT_MS); }
  catch { return withTimeout(() => retrieveEvidence(args), RETRIEVAL_TIMEOUT_MS); }
}

/** The only tool the model ever gets. There is deliberately no web-search or fetch tool (B5.6). */
export function buildTools(scope: ScopeKey) {
  return {
    retrieveEvidence: tool({
      description: TOOL_DESCRIPTION,
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe('Search terms in English (the documents are in English), keeping identifiers like "RA 12009", "Sec. 113", "Res. 10-2026" exactly as the user wrote them'),
        compare: z.boolean().optional().describe('True when the user asks to compare frameworks'),
      }),
      // Scope comes from the request, never from the model.
      execute: ({ query, compare }) => retrieveWithRetry({ query, compare, scope }),
      // The UI receives the structured result; the model receives formatted evidence blocks.
      toModelOutput: ({ input, output }) => ({ type: 'text', value: formatEvidenceForModel(output as RetrievalResult, input.query) }),
    }),
  } satisfies ToolSet;
}

export type ChatTools = ReturnType<typeof buildTools>;

/** Deterministic abstention: once retrieval abstains, the model is not asked to write anything. */
const retrievalAbstained: StopCondition<ChatTools> = ({ steps }) =>
  !!steps.at(-1)?.toolResults.some(r => r.toolName === 'retrieveEvidence' && (r.output as RetrievalResult)?.abstain === true);

/**
 * TOOL_CALL_MODE=direct — the server writes the first step's retrieveEvidence call itself, from the user's
 * question, instead of asking the model to write it. Retrieval is still a tool call in the conversation and
 * in the stream; what is saved is one whole model round trip, which on a CPU-only machine is several seconds.
 * Follow-up questions are searched together with the question they follow (lib/conversation.ts).
 */
export const TOOL_CALL_MODE = process.env.TOOL_CALL_MODE === 'direct' ? 'direct' : 'model';

export function searchQueryFrom(prompt: Parameters<LanguageModelV4['doStream']>[0]['prompt']): string {
  return contextualQuery(prompt.filter(m => m.role === 'user')
    .map(m => (m.role === 'user' ? m.content.map(p => (p.type === 'text' ? p.text : '')).join(' ') : '')));
}

const directToolCall: LanguageModelV4Middleware = {
  specificationVersion: 'v4',
  wrapStream: async ({ doStream, params }) => {
    if (params.prompt.some(m => m.role === 'tool')) return doStream();
    const parts: LanguageModelV4StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: `call_${Date.now().toString(36)}`, toolName: 'retrieveEvidence',
        input: JSON.stringify({ query: searchQueryFrom(params.prompt) }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } } },
    ];
    return { stream: new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); } }) };
  },
};

function chatModel(): LanguageModel {
  const model = getChatModel();
  return TOOL_CALL_MODE === 'direct' ? wrapLanguageModel({ model: model as LanguageModelV4, middleware: directToolCall }) : model;
}

/** A failed retrieval ends the turn: the model is never asked to answer without evidence (FR-09). */
const retrievalFailed: StopCondition<ChatTools> = ({ steps }) => !!steps.at(-1)?.content.some(p => p.type === 'tool-error');

/** Filled in while the answer streams; read it after the stream has finished. */
export type GuardReport = { stats: GuardStats | null };

/**
 * Grounding guard as a stream transform (lib/guard.ts). Model text is held back line by line, checked against
 * the evidence the tool returned, and only verified statements are passed on. GUARD=off disables it for
 * experiments; it is on in every deployment.
 */
function guardTransform(report: GuardReport): StreamTextTransform<ChatTools> {
  return () => {
    let guard: AnswerGuard | null = null;
    return new TransformStream({
      transform(part, controller) {
        if (part.type === 'tool-result' && part.toolName === 'retrieveEvidence') {
          const out = part.output as RetrievalResult;
          guard = new AnswerGuard(out.abstain ? [] : out.evidence);
          report.stats = guard.stats;
        }
        if (part.type === 'text-delta') {
          // No evidence yet means the model wrote before retrieving: nothing it says can be verified.
          guard ??= new AnswerGuard([]);
          report.stats = guard.stats;
          const text = guard.push(part.text);
          if (text) controller.enqueue({ ...part, text });
          return;
        }
        if (part.type === 'text-end' && guard) {
          const text = guard.flush();
          if (text) controller.enqueue({ type: 'text-delta', id: part.id, text });
        }
        controller.enqueue(part);
      },
    });
  };
}

export function streamAnswer({ messages, scope, abortSignal, report }: {
  messages: ModelMessage[]; scope: ScopeKey; abortSignal?: AbortSignal; report?: GuardReport;
}) {
  return streamText({
    experimental_transform: process.env.GUARD === 'off' ? undefined : guardTransform(report ?? { stats: null }),
    model: chatModel(),
    telemetry: telemetryFor(AGENT_NAME),
    maxOutputTokens,
    providerOptions,
    instructions: SYSTEM_PROMPT,
    messages,
    tools: buildTools(scope),
    // Step 1 must retrieve; every later step must answer from that evidence.
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: { type: 'tool', toolName: 'retrieveEvidence' } as const } : { toolChoice: 'none' as const },
    stopWhen: [isStepCount(MAX_STEPS), retrievalAbstained, retrievalFailed],
    // OpenAI reasoning models reject any temperature other than their default.
    temperature: isOpenAIReasoningModel ? undefined : 0.1,
    maxRetries: 1,
    abortSignal,
  });
}
