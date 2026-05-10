import { initTracing } from "../src/tracing/init.js";
initTracing();

import { parse as parseYaml } from "yaml";
import { runSuite } from "../src/evals/runner.js";
import { makeJudge } from "../src/evals/judge.js";
import {
    summarize,
    compareReports,
    printReport,
    saveReport,
    loadPreviousReport,
} from "../src/evals/report.js";
import type { EvalCase, EvalReport } from "../src/evals/types.js";

async function loadCases(path: string): Promise<EvalCase[]> {
    const file = Bun.file(path);
    const text = await file.text();
    const parsed = parseYaml(text);
    if (!Array.isArray(parsed)) {
        throw new Error(`expected array of cases in ${path}, got ${typeof parsed}`);
    }
    return parsed as EvalCase[];
}

async function main() {
    const casesPath = Bun.env.EVAL_CASES ?? "./src/evals/cases/basic.yaml";
    const reportPath = Bun.env.EVAL_REPORT ?? "./data/evals/latest.json";
    const previousPath = Bun.env.EVAL_PREVIOUS ?? "./data/evals/previous.json";

    console.log(`Loading cases from ${casesPath}...`);
    const cases = await loadCases(casesPath);
    console.log(`Loaded ${cases.length} cases.`);

    const judge = makeJudge({
        provider: Bun.env.JUDGE_PROVIDER ?? "openrouter",
        model_id: Bun.env.JUDGE_MODEL ?? "anthropic/claude-opus-4.6",
    });

    const previous = await loadPreviousReport(reportPath);

    console.log("Running suite...");
    const startTime = Date.now();
    const results = await runSuite({
        cases,
        judge,
        concurrency: Number(Bun.env.EVAL_CONCURRENCY ?? 3),
        onCaseStart: (id) => process.stdout.write(`  ${id}... `),
        onCaseEnd: (r) => console.log(r.passed ? "PASS" : "FAIL"),
    });
    const duration_ms = Date.now() - startTime;

    const report: EvalReport = {
        timestamp: new Date().toISOString(),
        results,
        summary: summarize(results),
    };

    // Rotate: previous becomes archive; latest becomes previous; current becomes latest
    if (previous) await saveReport(previous, previousPath);
    await saveReport(report, reportPath);

    const comparison = compareReports(report, previous);
    printReport(comparison);

    console.log(`Total run time: ${(duration_ms / 1000).toFixed(1)}s`);

    // Exit non-zero on regressions for CI use
    if (comparison.newly_failing.length > 0) {
        console.error(`Regression: ${comparison.newly_failing.length} cases newly failing`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error("eval run failed:", err);
    process.exit(2);
});
