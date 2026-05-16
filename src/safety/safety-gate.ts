import type { Agent } from "@earendil-works/pi-agent-core";
import { trace } from "@opentelemetry/api";

import type { UnlockManager } from "./unlock";
import type { ConfirmationQueue } from "./confirmation";
import { getToolMetadata } from "../tools";

export interface SafetyGateOptions {
    userId: string;
    unlockManager: UnlockManager;
    confirmationQueue: ConfirmationQueue;
    /** Optional callback for observability when a gate fires. */
    onBlocked?: (info: {
        tool: string;
        reason: "needs_unlock" | "needs_confirmation",
        args: unknown;
    }) => void;
}

/**
 * Attach a beforeToolCall handler that enforces sensitivity gating and
 * confirmation flow for destructive tools.
 *
 * Chains with any existing beforeToolCall — first blocker wins.
 */
export function attachSafetyGate(agent: Agent, options: SafetyGateOptions): void {
    const { userId, unlockManager, confirmationQueue, onBlocked } = options;
    const previousBefore = (agent as any).beforeToolCall;

    (agent as any).beforeToolCall = async (ctx: { toolCall: { name: string }; args: any }) => {
            // Honor any earlier hook first (e.g., loop detection from tool-guards).
            if (previousBefore) {
                const earlier = await previousBefore(ctx);
                if (earlier?.block) {
                    return earlier;
                }
            }

            const tool = ctx.toolCall.name;
            const metadata = getToolMetadata(tool);

            // Safe tools pass through unconditionally.
            if (metadata.sensitivity !== "destructive") {
                return undefined;
            }

            // -- Sensitivity gate: is unlock active for this user? --
            if (!unlockManager.isUnlocked(userId)) {
                const reason =
                    `Tool '${tool}' is destructive and requires unlock. ` +
                    `Tell the user to send '!unlock <minutes>' (e.g., '!unlock 5') ` +
                    `before retrying.`;
                onBlocked?.({ tool, reason: "needs_unlock", args: ctx.args });
                recordSpanEvent("safety_gate.blocked", {
                    "safety.tool": tool,
                    "safety.reason": "needs_unlock",
                });
                return { block: true, reason };
            }

            // -- Confirmation gate: does this specific tool require per-call approval? --
            if (metadata.requiresConfirmation) {
                confirmationQueue.propose(userId, tool, ctx.args);
                const reason =
                    `Tool '${tool}' requires explicit confirmation. ` +
                    `Proposed: ${tool}(${JSON.stringify(ctx.args)}). ` +
                    `Tell the user exactly what will happen and ask them to reply ` +
                    `'!confirm' to proceed or '!cancel' to abort. ` +
                    `Do NOT attempt to call this tool again in this turn — wait for ` +
                    `the user.`;
                onBlocked?.({ tool, reason: "needs_confirmation", args: ctx.args });
                recordSpanEvent("safety_gate.blocked", {
                    "safety.tool": tool,
                    "safety.reason": "needs_confirmation",
                });
                return { block: true, reason };
            }

            // Destructive, unlocked, no per-call confirmation required → allow.
            return undefined;
    };
}

function recordSpanEvent(name: string, attrs: Record<string, string>): void {
    trace.getActiveSpan()?.addEvent(name, attrs);
}
