// LLM_PROVIDER=mock — an offline, deterministic stand-in for the chat model. DEVELOPMENT AND CI ONLY.
// It calls retrieveEvidence, then quotes the first sentence of each evidence block with its citation.
// It lets the whole path (tool call → evidence policy → stream → UI states) run without an API key.
// It is NOT a language model: answers are extractive quotes, never reasoning. model.ts refuses it in production.
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { ABSTAIN_MESSAGE } from './evidence-policy';

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function lastUserText(prompt: LanguageModelV4CallOptions['prompt']): string {
  for (const m of [...prompt].reverse())
    if (m.role === 'user') return m.content.map(p => (p.type === 'text' ? p.text : '')).join(' ').trim();
  return '';
}

function lastToolResult(prompt: LanguageModelV4CallOptions['prompt']): string | null {
  const last = prompt.at(-1);
  if (last?.role !== 'tool') return null;
  for (const p of last.content)
    if (p.type === 'tool-result' && p.output.type === 'text') return p.output.value;
  return null;
}

export function composeExtractiveAnswer(evidence: string): string {
  if (evidence.startsWith('NO ELIGIBLE EVIDENCE')) return ABSTAIN_MESSAGE;
  const blocks = [...evidence.matchAll(/\[E(\d+)\] (.+?) · STATUS: (\w+) .*? USE AS: (\w+)\n[^\n]*\n(?:Note: [^\n]*\n)?<evidence>\n([\s\S]*?)\n<\/evidence>/g)];
  if (!blocks.length) return ABSTAIN_MESSAGE;
  const lines = blocks.slice(0, 4).map(([, n, reference, , label, text]) => {
    const name = reference.split(' — ')[0];
    const sentence = text.replace(/\s+/g, ' ').match(/[^.;]{40,260}[.;]/)?.[0]?.trim() ?? text.replace(/\s+/g, ' ').slice(0, 200);
    const lead =
      label === 'VERSION_ONLY' ? `${name} is withdrawn and must not be cited as the current rule` :
      label === 'PROPOSAL_ONLY' ? `${name} proposes, and is not law` :
      label === 'INTERPRETIVE_ONLY' ? `GPPB-TSO has opined in ${name}` :
      label === 'HISTORICAL_ONLY' ? `Historically, under ${name}` : `${name} states`;
    return `- ${lead}: "${sentence}" [E${n}]`;
  });
  return `**Mock model — extractive quotes, not a generated answer.**\n\n${lines.join('\n')}`;
}

export function createMockModel(): LanguageModelV4 {
  const stream = (parts: LanguageModelV4StreamPart[], delayMs: number) => new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      for (const p of parts) {
        if (p.type === 'text-delta') await new Promise(r => setTimeout(r, delayMs));
        controller.enqueue(p);
      }
      controller.close();
    },
  });

  return {
    specificationVersion: 'v4',
    provider: 'mock',
    modelId: 'mock-extractive',
    supportedUrls: {},
    doGenerate: async () => { throw new Error('mock model supports streaming only'); },
    doStream: async options => {
      const evidence = lastToolResult(options.prompt);
      if (evidence === null) {
        const id = `call_${Date.now().toString(36)}`;
        return {
          stream: stream([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: id, toolName: 'retrieveEvidence', input: JSON.stringify({ query: lastUserText(options.prompt).slice(0, 500) }) },
            { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
          ], 0),
        };
      }
      const words = composeExtractiveAnswer(evidence).match(/\S+\s*/g) ?? [];
      return {
        stream: stream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          ...words.map((delta): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 't1', delta })),
          { type: 'text-end', id: 't1' },
          { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } },
        ], 12),
      };
    },
  };
}
