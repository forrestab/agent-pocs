import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

import { loadConfig } from "./config";
import { getTools } from "./tools";
import { AgentLogger } from "./observability/logger";
import { attachLogger } from "./observability/agent-subscriber";

export interface AgentBundle {
    agent: Agent;
    logger: AgentLogger;
    setContext: (context: { trace_id: string; user_id: string }) => void;
    newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
    const config = loadConfig();
    const logger = new AgentLogger("./data/events.jsonl");
    
    await logger.init();

    const agent = new Agent({
        initialState: {
            systemPrompt: config.systemPrompt,
            model: config.model,
            tools: getTools(),
            thinkingLevel: "off",
            messages: []
        },
        streamFn: streamSimple
    });

    let currentContext = {
        trace_id: logger.newTraceId(),
        user_id: userId,
    };

    attachLogger(agent, logger, () => ({
        ...currentContext,
        model: `${config.model.provider}/${config.model.id}`,
    }));

    return {
        agent,
        logger,
        setContext: (context) => {
            currentContext = context;
        },
        newTraceId: () => logger.newTraceId(),
    };
};
