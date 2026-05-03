import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const diskUsageParams = Type.Object({
    path: Type.Optional(Type.String({ description: "Optional path, defaults to /" }))
});

const diskUsageTool: AgentTool<typeof diskUsageParams> = {
    name: "disk_usage",
    label: "Check disk usage",
    description: "Returns disk usage on the local machine via `df -h`.",
    parameters: diskUsageParams,
    execute: async (_toolCallId, { path }) => {
        const { stdout } = await Bun.$`df -h ${path ?? "/"}`.quiet();
        return { content: [{ type: "text", text: stdout.toString() }], details: { output: stdout.toString() } };
    }
};

const agent = new Agent({
    initialState: {
        systemPrompt: "You are a homelab assistant. Use tools to check the system when asked.",
        model: getModel("openrouter", "google/gemma-4-31b-it:free"),
        tools: [diskUsageTool],
        thinkingLevel: "off",
        messages: []
    },
    streamFn: streamSimple
});

agent.subscribe((event) => {
    //process.stdout.write(JSON.stringify(event));

    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (event.type === "agent_end") process.stdout.write("\n");
});

await agent.prompt("How full is my main drive?");
