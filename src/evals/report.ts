import { mkdir } from "node:fs/promises";
import type { EvalResult, EvalReport, RunComparison } from "./types.js";

export function summarize(results: EvalResult[]): EvalReport["summary"] {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const errored = results.filter((r) => r.error).length;
    return {
        total,
        passed,
        failed: total - passed,
        errored,
        pass_rate: total === 0 ? 0 : passed / total,
    };
}

export function compareReports(
    current: EvalReport,
    previous?: EvalReport,
): RunComparison {
    if (!previous) {
        return {
            current,
            previous: undefined,
            newly_passing: [],
            newly_failing: [],
            consistent_pass: current.results.filter((r) => r.passed).map((r) => r.case_id),
            consistent_fail: current.results.filter((r) => !r.passed).map((r) => r.case_id),
        };
    }

    const prevById = new Map(previous.results.map((r) => [r.case_id, r]));
    const newly_passing: string[] = [];
    const newly_failing: string[] = [];
    const consistent_pass: string[] = [];
    const consistent_fail: string[] = [];

    for (const r of current.results) {
        const prev = prevById.get(r.case_id);
        if (!prev) {
            // New case — count as consistent_pass/fail based on current
            if (r.passed) consistent_pass.push(r.case_id);
            else consistent_fail.push(r.case_id);
            continue;
        }
        if (r.passed && !prev.passed) newly_passing.push(r.case_id);
        else if (!r.passed && prev.passed) newly_failing.push(r.case_id);
        else if (r.passed) consistent_pass.push(r.case_id);
        else consistent_fail.push(r.case_id);
    }

    return { current, previous, newly_passing, newly_failing, consistent_pass, consistent_fail };
}

export function printReport(comparison: RunComparison): void {
    const { current, previous, newly_passing, newly_failing } = comparison;
    const s = current.summary;

    console.log("");
    console.log("=".repeat(60));
    console.log(`EVAL RUN: ${current.timestamp}`);
    console.log("=".repeat(60));

    // Per-case detail
    for (const r of current.results) {
        const status = r.passed ? "✓" : "✗";
        console.log(`${status} ${r.case_id}  (${r.duration_ms}ms)`);
        if (!r.passed) {
            for (const c of r.checks) {
                if (!c.passed) console.log(`    └─ FAIL: ${c.detail ?? c.check.type}`);
            }
            if (r.error) console.log(`    └─ ERROR: ${r.error}`);
        }
    }

    console.log("");
    console.log(
        `Summary: ${s.passed}/${s.total} passed (${(s.pass_rate * 100).toFixed(1)}%)`,
    );

    if (previous) {
        const prev_rate = previous.summary.pass_rate;
        const delta = (s.pass_rate - prev_rate) * 100;
        const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
        console.log(
            `Previous: ${previous.summary.passed}/${previous.summary.total} (${(prev_rate * 100).toFixed(1)}%) ${arrow} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`,
        );
        if (newly_passing.length > 0) {
            console.log(`Newly passing: ${newly_passing.join(", ")}`);
        }
        if (newly_failing.length > 0) {
            console.log(`Newly failing: ${newly_failing.join(", ")}`);
        }
    }
    console.log("");
}

export async function saveReport(
    report: EvalReport,
    outputPath: string,
): Promise<void> {
    const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    if (dir) await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.write(outputPath, JSON.stringify(report, null, 2));
}

export async function loadPreviousReport(
    path: string,
): Promise<EvalReport | undefined> {
    const file = Bun.file(path);
    if (!(await file.exists())) return undefined;
    try {
        return (await file.json()) as EvalReport;
    } catch {
        return undefined;
    }
}
