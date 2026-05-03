import * as readline from "node:readline/promises";

import { createAgent } from "./agent";

async function main() {
    const bundle = await createAgent("local");
    const { agent, logger } = bundle;
    const DEBUG = process.env.DEBUG === "true";

    agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            process.stdout.write(event.assistantMessageEvent.delta);
        }

        if (DEBUG) {
            if (event.type === "tool_execution_start") {
                process.stdout.write(`\n[${event.toolName}:start] ${JSON.stringify(event.args)}\n`);
            }

            if (event.type === "tool_execution_end" && !event.isError) {
                const resultStr = event.result.content.find((c: any) => c.type === "text")?.text;
                process.stdout.write(`\n[${event.toolName}:end]\n${resultStr}\n`);
            }
        }

        if (event.type === "message_update" && event.assistantMessageEvent.type === "error") {
            process.stderr.write(`\nerror: ${event.assistantMessageEvent.error.errorMessage ?? event.assistantMessageEvent.reason}`);
        }

        if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") {
            process.stderr.write(`\nerror: ${event.message.errorMessage ?? "unknown error"}`);
        }
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log("homelab-agent REPL. Ctrl-C to quit.");
    console.log(`Logging to ./data/events.jsonl${DEBUG ? " (DEBUG mode)" : ""}\n`);

    const shutdown = async () => {
        process.stdout.write("\nshutting down...\n");
        await logger.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    while (true) {
        const input = await rl.question("\nyou> ");

        if (!input.trim()) continue;

        const trace_id = bundle.newTraceId();

        bundle.setContext({ trace_id, user_id: "local" });

        logger.log({
            timestamp: new Date().toISOString(),
            trace_id,
            user_id: "local",
            event_type: "user_message",
            data: { content: input, content_length: input.length },
        });

        process.stdout.write("\nagent> ");

        try {
            await agent.prompt(input);
        } catch (error: any) {
            logger.log({
                timestamp: new Date().toISOString(),
                trace_id,
                user_id: "local",
                event_type: "error",
                data: { where: "agent.prompt", message: error.message, stack: error.stack },
            });
            console.error(`\n[error] ${error.message}`);
        }
        process.stdout.write("\n");
    }
}

main();
