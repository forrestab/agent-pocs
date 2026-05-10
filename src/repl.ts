import * as readline from "node:readline/promises";

import { createAgent } from "./agent";
import { initTracing } from "./tracing/init";
import { withMessageSpan } from "./tracing/instrumentation";

initTracing();

async function main() {
    const bundle = await createAgent("local");
    const { agent, logger, store, userId } = bundle;
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
    console.log(`Conversation stored at ./data/conversations/${userId}.json`);
    console.log(`Loaded ${agent.state.messages.length} prior messages.`);
    console.log("\nCommands: /clear (wipe conversation), /info (stats)\n");

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

        // slash commands
        if (input === "/clear") {
            await store.clear(userId);
            agent.state.messages = [];
            console.log("[conversation cleared");
            continue;
        }

        if (input === "/info") {
            console.log(`messages: ${agent.state.messages.length}`);
            console.log(`model: ${agent.state.model.id}`);
            continue;
        }

        if (input === "/messages") {
            const counts = agent.state.messages.reduce(
                (acc, message) => {
                    acc[message.role] = (acc[message.role] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>,
            );
            console.log("Message counts: ", counts);
            console.log(`Total messages: ${agent.state.messages.length}`);
            // Estimate tokens: rough rule of thumb is 4 chars = 1 token
            // `JSON.stringify` also adds characters, but this is a rough estimate
            const totalChars = JSON.stringify(agent.state.messages).length;
            console.log(`Approx tokens: ${Math.round(totalChars / 4)}`);
            continue;
        }

        const trace_id = bundle.newTraceId();

        await withMessageSpan(
            {
                userId,
                frontend: "repl",
                messagePreviewSize: input.length,
            },
            async () => {
                // We don't need to call newTraceId() anymore — OTel provides one.
                // But setContext is still used by the logger subscriber. Pass a
                // placeholder; the real trace ID comes from the active span.
                bundle.setContext({ trace_id: "otel-managed", user_id: userId });

                logger.log({
                    timestamp: new Date().toISOString(),
                    trace_id: "otel-managed", // logger overrides this with the real OTel trace ID
                    user_id: userId,
                    event_type: "user_message",
                    data: { content: input, content_length: input.length },
                });

                process.stdout.write("\nagent> ");

                try {
                    await agent.prompt(input);
                } catch (error: any) {
                    logger.log({
                        timestamp: new Date().toISOString(),
                        trace_id: "otel-managed",
                        user_id: userId,
                        event_type: "error",
                        data: { where: "agent.prompt", message: error.message, stack: error.stack },
                    });
                    console.error(`\n[error] ${error.message}`);
                }
                process.stdout.write("\n");
            },
        );
    }
}

main();
