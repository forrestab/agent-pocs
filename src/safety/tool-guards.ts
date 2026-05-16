import type { Agent } from "@earendil-works/pi-agent-core";

export interface ToolGuardOptions {
    /** Max times any single tool can be called within one user message. */
    maxCallsPerTool?: number;
    /** Max total tool calls within one user message. */
    maxTotalCalls?: number;
    /** Optional callback fired when a guard blocks a tool call. */
    onBlocked?: (info: { tool: string; reason: string }) => void;
}

interface CallStats {
    perTool: Map<string, number>;
    total: number;
}

export function attachToolGuards(agent: Agent, options: ToolGuardOptions = {}): () => void {
    const maxCallsPerTool = options.maxCallsPerTool ?? 5;
    const maxTotalCalls = options.maxTotalCalls ?? 20;

    let stats: CallStats = { perTool: new Map(), total: 0 };

    // Reset counters at the start of each agent run (one user message).
    const unsubscribe = agent.subscribe((event) => {
        if (event.type === "agent_start") {
            stats = { perTool: new Map(), total: 0 };
        }
    });

    const previousBefore = (agent as any).beforeToolCall;

    (agent as any).beforeToolCall = async (ctx: { toolCall: { name: string }; args: any }) => {
            // Run any prior beforeToolCall first
            if (previousBefore) {
                const result = await previousBefore(ctx);
                if (result?.block) {
                    return result;
                }
            }

            const tool = ctx.toolCall.name;
            const perToolCount = stats.perTool.get(tool) ?? 0;

            if (stats.total >= maxTotalCalls) {
                const reason = `Too many tool calls in this turn (${stats.total}/${maxTotalCalls}). Stopping.`;
                options.onBlocked?.({ tool, reason });
                return { block: true, reason };
            }

            if (perToolCount >= maxCallsPerTool) {
                const reason = `Tool ${tool} called too many times (${perToolCount}/${maxCallsPerTool}). Try a different approach.`;
                options.onBlocked?.({ tool, reason });
                return { block: true, reason };
            }

            // Allow — increment counters
            stats.perTool.set(tool, perToolCount + 1);
            stats.total++;

            return undefined;
    };

    return unsubscribe;
}
