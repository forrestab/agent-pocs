import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";

import { loadConfig } from "../config.js";
import { getTools } from "../tools.js";
import { makeContextTransform } from "../context/transform.js";
import { runCheck, type CheckContext } from "./checks.js";
import type { EvalCase, EvalResult, CheckResult } from "./types.js";

export async function runOne(
    evalCase: EvalCase,
    judge: (rubric: string, ctx: CheckContext & { input: string }) => Promise<{ score: number; reasoning: string }>,
): Promise<EvalResult> {
    const config = loadConfig();

    // Convert prior_messages to AgentMessage format if any
    const initialMessages: AgentMessage[] = (evalCase.prior_messages ?? []).map((m) => ({
        role: m.role,
        content: [{ type: "text", text: m.content }],
    } as any));

    const agent = new Agent({
        initialState: {
            systemPrompt: config.systemPrompt,
            model: config.model,
            tools: getTools(),
            thinkingLevel: "off",
            messages: initialMessages,
        },
        streamFn: streamSimple,
        transformContext: makeContextTransform({}),
    });

    const tool_calls: { name: string; args: unknown; is_error: boolean }[] = [];
    let response_text = "";

    // Track tool calls and the final response. Same pattern as the bot's
    // per-message subscription, scoped to this single eval run.
    const pendingTools = new Map<string, unknown>(); // toolCallId -> args
    const unsubscribe = agent.subscribe((event) => {
        if (event.type === "tool_execution_start") {
            pendingTools.set(event.toolCallId, event.args);
        }
        if (event.type === "tool_execution_end") {
            const args = pendingTools.get(event.toolCallId) ?? {};
            pendingTools.delete(event.toolCallId);
            tool_calls.push({
                name: event.toolName,
                args,
                is_error: event.isError,
            });
        }
        if (
            event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta" &&
            typeof event.assistantMessageEvent.delta === "string"
        ) {
            response_text += event.assistantMessageEvent.delta;
        }
    });

    const startTime = Date.now();
    let error: string | undefined;
    try {
        await agent.prompt(evalCase.input);
    } catch (err: any) {
        error = err.message;
    } finally {
        unsubscribe();
    }
    const duration_ms = Date.now() - startTime;

    const ctx: CheckContext = { response_text, tool_calls };
    const judgeWithInput = (rubric: string, c: CheckContext) =>
        judge(rubric, { ...c, input: evalCase.input });

    // Run all checks, collecting results
    const checkResults: CheckResult[] = [];
    for (const check of evalCase.expected_behavior) {
        if (error && check.type !== "judge") {
            // Skip non-judge checks if the agent errored — they'll all fail meaningfully
            checkResults.push({
                check,
                passed: false,
                detail: `agent errored before checks: ${error}`,
            });
            continue;
        }
        try {
            const result = await runCheck(check, ctx, judgeWithInput);
            checkResults.push(result);
        } catch (err: any) {
            checkResults.push({
                check,
                passed: false,
                detail: `check threw: ${err.message}`,
            });
        }
    }

    return {
        case_id: evalCase.id,
        passed: checkResults.every((r) => r.passed),
        checks: checkResults,
        response_text,
        tool_calls,
        duration_ms,
        error,
    };
}

export interface RunSuiteOptions {
    cases: EvalCase[];
    judge: (rubric: string, ctx: CheckContext & { input: string }) => Promise<{ score: number; reasoning: string }>;
    concurrency?: number;
    onCaseStart?: (caseId: string) => void;
    onCaseEnd?: (result: EvalResult) => void;
}

export async function runSuite(options: RunSuiteOptions): Promise<EvalResult[]> {
    const concurrency = options.concurrency ?? 3;
    const queue = [...options.cases];
    const results: EvalResult[] = [];

    // Simple worker-pool concurrency. Each worker pulls a case until queue empty.
    const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
            const evalCase = queue.shift();
            if (!evalCase) return;
            options.onCaseStart?.(evalCase.id);
            const result = await runOne(evalCase, options.judge);
            results.push(result);
            options.onCaseEnd?.(result);
        }
    });

    await Promise.all(workers);

    // Restore deterministic ordering by case ID
    results.sort((a, b) => {
        const aIdx = options.cases.findIndex((c) => c.id === a.case_id);
        const bIdx = options.cases.findIndex((c) => c.id === b.case_id);
        return aIdx - bIdx;
    });
    return results;
}
