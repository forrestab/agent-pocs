import { getModel, completeSimple, type KnownProvider } from "@earendil-works/pi-ai";

import type { CheckContext } from "./checks.js";

export interface JudgeOptions {
    provider?: string;
    model_id?: string;
}

// Always reason before scoring. "Reasoning then score" produces calibrated, considered scores. 
// "Score then reasoning" produces post-hoc rationalization.

// Small integer scale, not continuous. 1-5 is what models do well. 0-100 sounds more precise 
// but produces noisy garbage — models can't actually distinguish 73 from 76.
const SYSTEM_PROMPT = `You are evaluating an AI agent's response to a user question.

Given:
- The user's question
- The agent's response
- The list of tools the agent called and their results

Apply the rubric below and rate the response on a 1-5 scale where:
1 = clearly wrong or unhelpful
2 = significant problems
3 = acceptable but flawed
4 = good response with minor issues
5 = excellent

You MUST output a JSON object with exactly two keys:
{"reasoning": "your brief reasoning, 1-3 sentences", "score": <integer 1-5>}

Reason first, score second. Do not output anything else.`;

export function makeJudge(options: JudgeOptions = {}) {
    // Use a stronger model than the one being evaluated. Same-model evaluation has known biases, models tend to 
    // prefer their own outputs. Cross-tier evaluation removes that bias.
    const provider: KnownProvider = (options.provider ?? "openrouter") as KnownProvider;
    const modelId: never = (options.model_id ?? "anthropic/claude-opus-4.6") as never;
    const model = getModel(provider, modelId);

    return async (
        rubric: string,
        ctx: CheckContext & { input?: string },
    ): Promise<{ score: number; reasoning: string }> => {
        const prompt = [
            `User question: ${ctx.input ?? "(not provided)"}`,
            "",
            `Agent response: ${ctx.response_text}`,
            "",
            `Tool calls made: ${JSON.stringify(ctx.tool_calls, null, 2)}`,
            "",
            `Rubric: ${rubric}`,
        ].join("\n");

        const response = await completeSimple(model, {
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        });

        // Extract text and parse JSON
        const textBlock = response.content.find((b) => b.type === "text");
        const text = (textBlock as any)?.text ?? "";

        // Be liberal about JSON extraction — judges sometimes preface or wrap.
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            return { score: 0, reasoning: `judge produced no JSON: ${text.slice(0, 200)}` };
        }

        try {
            const parsed = JSON.parse(match[0]);
            const score = typeof parsed.score === "number" ? parsed.score : 0;
            const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
            return { score, reasoning };
        } catch (err: any) {
            return { score: 0, reasoning: `failed to parse judge JSON: ${err.message}` };
        }
    };
}
