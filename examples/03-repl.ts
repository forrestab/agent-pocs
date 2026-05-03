import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import * as readline from "node:readline/promises";

const runShellParams = Type.Object({
    command: Type.String({ description: "Command to run" })
});

const runShellTool: AgentTool<typeof runShellParams> = {
    name: "run_shell",
    label: "Run shell command",
    description: "Runs a read-only shell command. Refuse anything destructive.",
    parameters: runShellParams,
    execute: async (_toolCallId, { command }) => {
        const proc = Bun.spawn(["sh", "-c", command], {
            stdout: "pipe",
            stderr: "pipe"
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const text = [stdout, stderr].filter(Boolean).join("\n");
        return { content: [{ type: "text", text }], details: { stdout, stderr } };
    }
};

const agent = new Agent({
    initialState: {
        systemPrompt: 
            "You are a homelab assistant. Use run_shell for read-only diagnostics " +
            "(df, free, uptime, docker ps, systemctl status, journalctl, etc). " +
            "Never run anything that modifies state without confirming with the user first.",
        model: getModel("openrouter", "google/gemma-4-31b-it:free"),
        tools: [runShellTool],
        thinkingLevel: "off",
        messages: []
    },
    streamFn: streamSimple
});

agent.subscribe((event) => {
    process.stderr.write(JSON.stringify(event));

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (event.type === "message_update" && event.assistantMessageEvent.type === "error") {
        process.stderr.write(`\nerror: ${event.assistantMessageEvent.error.errorMessage ?? event.assistantMessageEvent.reason}`);
    }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("homelab-agent ready. Ctrl-C to quit.\n");

while(true) {
    const input = await rl.question("\nyou> ");
    if (!input.trim()) continue;
    process.stdout.write("agent> ");
    try {
        await agent.prompt(input);
    } catch (e) {
        process.stderr.write(`\nerror: ${e instanceof Error ? e.message : String(e)}`);
    }
}
