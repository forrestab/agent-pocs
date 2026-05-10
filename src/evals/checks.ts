import type { Check, CheckResult } from "./types";

export interface CheckContext {
    response_text: string;
    tool_calls: { name: string; args: unknown; is_error: boolean }[];
}

const APOLOGY_PATTERNS = [
    /\bi[' ]?m sorry\b/i,
    /\bunfortunately\b/i,
    /\bi apologize\b/i,
    /\bi cannot\b/i,
];

export async function runCheck(
    check: Check,
    context: CheckContext,
    judge: (rubric: string, context: CheckContext) => Promise<{ score: number; reasoning: string }>,
): Promise<CheckResult> {
    switch (check.type) {
        case "tool_called": {
            const found = context.tool_calls.some((c) => c.name === check.tool);

            return {
                check,
                passed: found,
                detail: found ? undefined : `expected tool '${check.tool}' to be called`,
            };
        }

        case "tool_not_called": {
            const found = context.tool_calls.some((c) => c.name === check.tool);
            return {
                check,
                passed: !found,
                detail: found ? `tool '${check.tool}' was called but should not have been` : undefined,
            };
        }

        case "tool_called_with": {
            const matches = context.tool_calls.find(
                (c) => c.name === check.tool && argsMatch(c.args, check.args_match),
            );
            return {
                check,
                passed: !!matches,
                detail: matches ? undefined : `tool '${check.tool}' was not called with matching args`,
            };
        }

        case "max_tool_calls": {
            const count = context.tool_calls.length;
            return {
                check,
                passed: count <= check.max,
                detail: count > check.max ? `made ${count} tool calls (max ${check.max})` : undefined,
            };
        }

        case "response_contains": {
            const haystack = check.case_sensitive
                ? context.response_text
                : context.response_text.toLowerCase();
            const needle = check.case_sensitive ? check.text : check.text.toLowerCase();
            const found = haystack.includes(needle);
            return {
                check,
                passed: found,
                detail: found ? undefined : `response did not contain '${check.text}'`,
            };
        }

        case "response_does_not_contain": {
            const found = context.response_text.toLowerCase().includes(check.text.toLowerCase());
            return {
                check,
                passed: !found,
                detail: found ? `response contained '${check.text}'` : undefined,
            };
        }

        case "response_max_chars": {
            const len = context.response_text.length;
            return {
                check,
                passed: len <= check.max,
                detail: len > check.max ? `response was ${len} chars (max ${check.max})` : undefined,
            };
        }

        case "response_min_chars": {
            const len = context.response_text.length;
            return {
                check,
                passed: len >= check.min,
                detail: len < check.min ? `response was ${len} chars (min ${check.min})` : undefined,
            };
        }

        case "no_apology": {
            const offending = APOLOGY_PATTERNS.find((re) => re.test(context.response_text));
            return {
                check,
                passed: !offending,
                detail: offending ? `response matched apology pattern: ${offending}` : undefined,
            };
        }

        case "judge": {
            const result = await judge(check.rubric, context);
            const threshold = check.threshold ?? 4;
            return {
                check,
                passed: result.score >= threshold,
                detail: `judge score ${result.score}/5 (threshold ${threshold}): ${result.reasoning}`,
            };
        }
    }
}

function argsMatch(actual: unknown, expected: Record<string, unknown>): boolean {
    if (typeof actual !== "object" || actual === null) {
        return false;
    }

    const a = actual as Record<string, unknown>;

    return Object.entries(expected).every(([k, v]) => {
        if (typeof v === "string" && v.startsWith("/") && v.endsWith("/")) {
            const re = new RegExp(v.slice(1, -1));
            return typeof a[k] === "string" && re.test(a[k] as string);
        }
        
        return a[k] === v;
    });
}
