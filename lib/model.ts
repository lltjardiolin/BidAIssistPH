// Chat model switch (PDR B5.1). OpenAI through its chat-completions endpoint (the hosted deployment);
// MiniMax via its AI SDK provider (Anthropic-compatible protocol, no inline <think> text); "mock" is an
// offline extractive stand-in for development and CI.
import { createMiniMax } from '@ai-sdk/minimax';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { SharedV4ProviderOptions } from '@ai-sdk/provider';
import { isProduction } from './env';
import { createMockModel } from './mock-model';

export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? 'minimax';
export const MODEL_ID =
  LLM_PROVIDER === 'openai' ? process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    : LLM_PROVIDER === 'mock' ? 'mock-extractive'
    : process.env.MINIMAX_MODEL || 'minimax-m3';

/** OpenAI reasoning models (gpt-5 family, o-series) accept reasoning_effort and reject a custom temperature. */
export const isOpenAIReasoningModel = LLM_PROVIDER === 'openai' && /^(gpt-5|o\d)/i.test(MODEL_ID);

let model: LanguageModel | undefined;
export function getChatModel(): LanguageModel {
  if (model) return model;
  const production = isProduction;
  if (LLM_PROVIDER === 'mock') {
    if (production) throw new Error('LLM_PROVIDER=mock is not allowed in production.');
    model = createMockModel();
  } else if (LLM_PROVIDER === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    model = createOpenAICompatible({
      name: 'openai', baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY, includeUsage: true,
    })(MODEL_ID);
  } else if (LLM_PROVIDER === 'minimax') {
    if (!process.env.MINIMAX_API_KEY) throw new Error('MINIMAX_API_KEY is not set.');
    model = createMiniMax({ apiKey: process.env.MINIMAX_API_KEY })(MODEL_ID);
  } else {
    throw new Error(`Unknown LLM_PROVIDER "${LLM_PROVIDER}" (expected openai, minimax or mock).`);
  }
  return model;
}

/** Visible-answer budget. OpenAI reasoning models reject `max_tokens` (which the chat-completions provider
 * always sends for maxOutputTokens), so for them the limit goes through providerOptions as
 * `max_completion_tokens`, which also has to cover the reasoning tokens. */
const ANSWER_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 700);
export const maxOutputTokens: number | undefined = isOpenAIReasoningModel ? undefined : ANSWER_TOKENS;

export const providerOptions: SharedV4ProviderOptions | undefined =
  LLM_PROVIDER === 'minimax' ? { minimax: { thinking: { type: 'disabled' as const } } }
    // Cited extractive answers do not need deep reasoning; keep the budget low so answers start quickly.
    : isOpenAIReasoningModel ? { openai: {
        reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'low',
        max_completion_tokens: Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || ANSWER_TOKENS + 3000),
      } }
    : undefined;
