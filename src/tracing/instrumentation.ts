import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { StreamFn } from "@earendil-works/pi-agent-core";

import { getTracer } from "./init";
import { App, GenAi } from "./attributes";

/**
 * Wrap an AgentTool's execute function with a span. The span captures:
 * - tool name (so you can filter by tool in Jaeger)
 * - args size (small attribute, doesn't blow up cardinality)
 * - result size
 * - success/failure
 * - duration (automatic via span lifecycle)
 */
export function instrumentTool(tool: AgentTool): AgentTool {
    const tracer = getTracer();

    return {
        ...tool,
        execute: async (...args: any[]) => {
            return tracer.startActiveSpan(`tool.${tool.name}`, async (span: Span) => {
                const toolArgs = args[0];
                const argsJson = JSON.stringify(toolArgs ?? {});

                App.setToolAttributes(span, {
                    toolName: tool.name,
                    argsSize: argsJson.length
                });

                try {
                    // @ts-expect-error — execute signature varies; we forward the args as-is
                    const result = await tool.execute(...args);
                    const resultJson = JSON.stringify(result ?? {});

                    span.setAttribute("app.tool.result_size", resultJson.length);
                    span.setStatus({ code: SpanStatusCode.OK });

                    return result;
                } catch (error: any) {
                    span.recordException(error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error.message
                    });

                    throw error;
                } finally {
                    span.end();
                }
            });
        },
    };
}

/**
 * Wrap a streamFn with a span around each LLM call. Captures:
 * - model name and provider (gen_ai.* attributes)
 * - input/output tokens after the call completes
 * - finish reason
 *
 * This is the LLM-call equivalent of instrumentTool. It must wrap the
 * streamFn AFTER any other wrappers (e.g., withRetry from stage 6) — or
 * spans will see retries as one big span. If you want each retry as its
 * own span, swap the order.
 */
export function instrumentStreamFn(streamFn: StreamFn): StreamFn {
    const tracer = getTracer();

    return async (model, context, options) => {
        return tracer.startActiveSpan("llm.completion", async (span: Span) => {
            GenAi.setRequestAttributes(span, {
                provider: model.provider,
                model: model.id,
                operation: "chat",
            });

            span.setAttribute(
                "gen_ai.request.message_count",
                Array.isArray(context?.messages) ? context.messages.length : 0,
            );

            try {
                const result = await streamFn(model, context, options);

                // The streamFn returns a StreamResult that includes the final
                // message with usage. The exact shape depends on pi-ai version —
                // adjust the field paths based on what you see at runtime.
                const usage = (result as any)?.message?.usage;

                if (usage) {
                    GenAi.setUsageAttributes(span, {
                        inputTokens: usage.input,
                        outputTokens: usage.output,
                        cacheReadTokens: usage.cacheRead,
                        cacheWriteTokens: usage.cacheWrite,
                    });
                }

                const stopReason = (result as any)?.message?.stopReason;

                if (stopReason) {
                    GenAi.setResponseAttributes(span, { finishReason: stopReason });
                }

                span.setStatus({ code: SpanStatusCode.OK });

                return result;
            } catch (err: any) {
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });

                throw err;
            } finally {
                span.end();
            }
        });
    };
}

/**
 * Wrap a function that handles one user message with a root span.
 * This is the top-level span that all agent activity for one message
 * descends from. Use it in your frontends.
 */
export async function withMessageSpan<T>(
    info: { userId: string; frontend: string; messagePreviewSize: number },
    fn: (span: Span) => Promise<T>,
): Promise<T> {
    const tracer = getTracer();

    return tracer.startActiveSpan("agent.handle_message", async (span: Span) => {
        App.setUserContext(span, info);

        span.setAttribute("app.message.size", info.messagePreviewSize);

        try {
            const result = await fn(span);

            span.setStatus({ code: SpanStatusCode.OK });

            return result;
        } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });

            throw err;
        } finally {
            span.end();
        }
    });
}

/**
 * Get the current trace ID from the active span, if any. Used to correlate
 * with our JSONL logs.
 */
export function getCurrentTraceId(): string | undefined {
    const { trace, context } = require("@opentelemetry/api");
    const span = trace.getSpan(context.active());

    if (!span) {
        return undefined;
    }

    return span.spanContext().traceId;
}
