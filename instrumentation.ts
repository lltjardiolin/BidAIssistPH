// Runs once when the Next.js server starts. Sends traces to Logfire over OpenTelemetry when
// OTEL_EXPORTER_OTLP_ENDPOINT is set; without it, nothing is registered and nothing is sent.
import { OpenTelemetry } from '@ai-sdk/otel';
import { registerOTel } from '@vercel/otel';
import { registerTelemetry } from 'ai';

export function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({ serviceName: process.env.LOGFIRE_SERVICE_NAME ?? 'bidaissistph' });
  // AI SDK 7: model calls, tool calls and agent runs become spans. What each call records is set where
  // the call is made (lib/telemetry.ts).
  registerTelemetry(new OpenTelemetry());
}
