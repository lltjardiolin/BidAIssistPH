// What the traces may contain. By default only timing, model, token counts and tool calls are recorded.
// Visitors' questions, the retrieved passages and the answers are recorded only if TRACE_CONTENT=true.
const CONTENT = process.env.TRACE_CONTENT === 'true';

/** `functionId` is the name the run appears under on the Logfire Agents page. */
export const telemetryFor = (functionId: string) => ({ functionId, recordInputs: CONTENT, recordOutputs: CONTENT });

export const AGENT_NAME = 'bidaissist-research-assistant';
