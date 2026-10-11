// Deployment environment. APP_ENV is set explicitly on a self-hosted server; VERCEL_ENV is set by Vercel.
// `next start` always runs with NODE_ENV=production, so NODE_ENV cannot tell staging from a public launch.
export const APP_ENV = process.env.APP_ENV ?? process.env.VERCEL_ENV ?? 'development';
export const isProduction = APP_ENV === 'production';

/** True when answers are quoted extracts rather than model output. Shown to every visitor. */
export const isDemoMode = (process.env.LLM_PROVIDER ?? 'openai') === 'mock';

