import * as readline from "node:readline/promises";

import { createAgent } from "./agent";

async function main() {
    const agent = createAgent();

    agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            process.stdout.write(event.assistantMessageEvent.delta);
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

    console.log("homelab-agent REPL. Ctrl-C to quit.\n");

    while (true) {
        const input = await rl.question("\nyou> ");

        if (!input.trim()) continue;

        process.stdout.write("\nagent> ");

        try {
            await agent.prompt(input);
        } catch (error: any) {
            console.error(`\n[error] ${error.message}`);
        }
        process.stdout.write("\n");
    }
}

main();
