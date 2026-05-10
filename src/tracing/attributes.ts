import type { Span } from "@opentelemetry/api";
import { IntersectOptions } from "typebox";

/**
 * GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semantic-conventions/gen-ai/
 *
 * These attribute names are the OTel standard. Tools like Langfuse, Honeycomb,
 * and Datadog look for them specifically and produce nicer dashboards.
 */
export const GenAi = {
    setRequestAttributes(
        span: Span,
        info: { provider: string; model: string; operation: string },
    ): void {
        span.setAttributes({
            "gen_ai.system": info.provider,
            "gen_ai.request.model": info.model,
            "gen_ai.operation.name": info.operation,
        });
    },

    setUsageAttributes(
        span: Span,
        usage: {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
        },
    ): void {
        if (usage.inputTokens !== undefined) {
            span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
        }

        if (usage.outputTokens !== undefined) {
            span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
        }

        if (usage.cacheReadTokens !== undefined) {
            span.setAttribute("gen_ai.usage.cache_read_tokens", usage.cacheReadTokens);
        }

        if (usage.cacheWriteTokens !== undefined) {
            span.setAttribute("gen_ai.usage.cache_write_tokens", usage.cacheWriteTokens);
        }
    },

    setResponseAttributes(
        span: Span,
        info: { finishReason?: string; responseId?: string },
    ): void {
        if (info.finishReason) {
            span.setAttribute("gen_ai.response.finish_reason", [info.finishReason]);
        }

        if (info.responseId) {
            span.setAttribute("gen_ai.response.id", info.responseId);
        }
    },
};

export const App = {
    setUserContext(span: Span, info: { userId: string; frontend: string }): void {
        span.setAttributes({
            "app.user.id": info.userId,
            "app.frontend": info.frontend,
        });
    },

    // A non-obvious but important habit baked into this: don't put raw user input or tool args directly in span attributes. Instead
    // log the size and hash leaving the actual input in the jsonl log.
    setToolAttributes(
        span: Span,
        info: { toolName: string; argsSize?: number; argsHash?: string },
    ): void {
        span.setAttribute("app.tool.name", info.toolName);

        if (info.argsSize !== undefined) {
            span.setAttribute("app.tool.args_size", info.argsSize);
        }

        if (info.argsHash) {
            span.setAttribute("app.tool.args_hash", info.argsHash);
        }
    },
};
