// Embedding provider (PDR D4 / CHANGES #8). MiniMax has no embedding model, so embeddings are configured
// separately and pinned per corpus release (corpus_releases table). Changing model or dimension = full re-embed.
import { embed, embedMany, type EmbeddingModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { telemetryFor } from './telemetry';

const PROVIDER = process.env.EMBEDDING_PROVIDER || 'openai';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);

const BASE_URLS: Record<string, string> = { openai: 'https://api.openai.com/v1' };

let model: EmbeddingModel | undefined;
function getModel(): EmbeddingModel {
  if (!model) {
    const baseURL = process.env.EMBEDDING_BASE_URL || BASE_URLS[PROVIDER];
    if (!baseURL) throw new Error(`EMBEDDING_PROVIDER=${PROVIDER} needs EMBEDDING_BASE_URL`);
    model = createOpenAICompatible({ name: `embeddings-${PROVIDER}`, baseURL, apiKey: process.env.EMBEDDING_API_KEY || undefined })
      .embeddingModel(EMBEDDING_MODEL);
  }
  return model;
}

function check(v: number[]): number[] {
  if (v.length !== EMBEDDING_DIMENSIONS)
    throw new Error(`Embedding has ${v.length} dimensions; EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS}`);
  return v;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: getModel(), value: text, maxRetries: 1, telemetry: telemetryFor('bidaissist-query-embedding') });
  return check(embedding);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: getModel(), values: texts, maxRetries: 3 });
  return embeddings.map(check);
}
