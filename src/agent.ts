import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";

import { loadConfig } from "./config";
import { getTools } from "./tools";
import { AgentLogger } from "./observability/logger";
import { attachLogger } from "./observability/agent-subscriber";
import { ConversationStore } from "./persistence/conversation";

export interface AgentBundle {
    agent: Agent;
    logger: AgentLogger;
    store: ConversationStore;
    userId: string;
    setContext: (context: { trace_id: string; user_id: string }) => void;
    newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
    const config = loadConfig();

    // Logger
    const logger = new AgentLogger("./data/events.jsonl");
    await logger.init();

    // Persistence
    const store = new ConversationStore("./data/conversations");
    await store.init();
    const initialMessages = await store.load(userId);

    if (initialMessages.length > 0) {
        console.log(`[persistence] loaded ${initialMessages.length} message for user ${userId}`);
    }

    const agent = new Agent({
        initialState: {
            systemPrompt: config.systemPrompt,
            model: config.model,
            tools: getTools(),
            thinkingLevel: "off",
            messages: initialMessages
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

    agent.subscribe(async (event) => {
        if (event.type === "agent_end") {
            try {
                const snapshot = [...event.messages];
                await store.save(userId, snapshot);
            } catch (error: any) {
                logger.log({
                    timestamp: new Date().toISOString(),
                    trace_id: currentContext.trace_id,
                    user_id: userId,
                    event_type: "error",
                    data: {
                        where: "ConversationStore.save",
                        message: error.message,
                        stack: error.stack
                    }
                })
            }
        }
    });

    return {
        agent,
        logger,
        store,
        userId,
        setContext: (context) => {
            currentContext = context;
        },
        newTraceId: () => logger.newTraceId(),
    };
};
