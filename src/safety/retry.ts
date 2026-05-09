import type { StreamFn } from "@earendil-works/pi-agent-core";
import { modelsAreEqual } from "@earendil-works/pi-ai";

export interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (info: {
        attempt: number;
        maxAttempts: number;
        error: Error;
        delayMs: number;
    }) => void;
}

/**
 * Wrap a streamFn with retry-with-exponential-backoff for transient failures.
 *
 * Retries on: network errors, 429 (rate limit), 5xx, and explicitly
 * "overloaded" responses. Does NOT retry on 4xx auth errors or schema
 * errors — those won't get better by trying again.
 */
export function withRetry(streamFn: StreamFn, options: RetryOptions = {}): StreamFn {
    const maxAttempts = options.maxAttempts ?? 4;
    const initialDelayMs = options.initialDelayMs ?? 1_000;
    const maxDelayMs = options.maxDelayMs ?? 30_000;

    return async (model, context, opts) => {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await streamFn(model, context, opts);
            } catch (error: any) {
                lastError = error;
                if (!isRetryable(error) || attempt === maxAttempts) {
                    throw error;
                }

                const delayMs = Math.min(
                    initialDelayMs * 2 ** (attempt - 1),
                    maxDelayMs
                );

                // Add a little jitter to avoid synchronized retries if multiple
                // agents are hammering the same API at once.
                const jittered = delayMs + Math.random() * (delayMs * 0.25);

                options.onRetry?.({
                    attempt,
                    maxAttempts,
                    error,
                    delayMs: jittered
                });

                await new Promise((r) => setTimeout(r, jittered));
            }
        }

        throw lastError ?? new Error("Retry loop exited unexpectedly");
    };
}

function isRetryable(error: any): boolean {
    // Network-level failures
    const code = error?.code ?? error?.cause?.code;
    if (
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN" ||
        code === "UND_ERR_SOCKET"
    ) {
        return true;
    }

    // HTTP status — try a few different shapes since providers vary
    const status = error?.status ?? error?.response?.status ?? error?.statusCode;
    if (typeof status === "number") {
        if (status === 429) {
            return true;
        }

        if (status >= 500 && status < 600) {
            return true;
        }
    }

    // Anthropic and others sometimes send a structured "overloaded" error
    const message = String(error?.message ?? "").toLowerCase();
    if (message.includes("overloaded") || message.includes("temporarily unavailable")) {
        return true;
    }

    return false;
}
