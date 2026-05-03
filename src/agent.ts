import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

import { loadConfig } from "./config";
import { allTools } from "./tools";

export function createAgent(): Agent {
    const config = loadConfig();

    return new Agent({
        initialState: {
            systemPrompt: config.systemPrompt,
            model: config.model,
            tools: allTools,
            thinkingLevel: "off",
            messages: []
        },
        streamFn: streamSimple
    });
};
