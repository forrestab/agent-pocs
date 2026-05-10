export interface EvalCase {
    id: string;
    input: string;
    /** Optional prior conversation to set up context. */
    prior_messages?: { role: "user" | "assistant"; content: string }[];
    expected_behavior: Check[];
    metadata?: {
        category?: string;
        difficulty?: "easy" | "medium" | "hard";
        source?: string; // "hand-written" | "from-logs" | etc
        notes?: string;
    };
}

export type Check = 
    | { type: "tool_called"; tool: string }
    | { type: "tool_not_called"; tool: string }
    | { type: "tool_called_with"; tool: string; args_match: Record<string, unknown> }
    | { type: "max_tool_calls"; max: number }
    | { type: "response_contains"; text: string; case_sensitive?: boolean }
    | { type: "response_does_not_contain"; text: string }
    | { type: "response_max_chars"; max: number }
    | { type: "response_min_chars"; min: number }
    | { type: "no_apology"; /* shorthand for not-contains "I'm sorry" etc */ }
    | { type: "judge"; rubric: string; threshold?: number };

export interface CheckResult {
    check: Check;
    passed: boolean;
    detail?: string;
}

export interface EvalResult {
    case_id: string;
    passed: boolean;
    checks: CheckResult[];
    response_text: string;
    tool_calls: { name: string; args: unknown; is_error: boolean }[];
    duration_ms: number;
    error?: string;
}

export interface EvalReport {
    timestamp: string;
    results: EvalResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        errored: number;
        pass_rate: number;
    };
}

export interface RunComparison {
    current: EvalReport;
    previous?: EvalReport;
    newly_passing: string[]; // case IDs that were failing and now pass
    newly_failing: string[]; // case IDs that were passing and now fail
    consistent_pass: string[];
    consistent_fail: string[];
}
