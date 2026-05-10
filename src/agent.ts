import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";

import { loadConfig } from "./config";
import { getTools } from "./tools";
import { AgentLogger } from "./observability/logger";
import { attachLogger } from "./observability/agent-subscriber";
import { ConversationStore } from "./persistence/conversation";
import { attachToolGuards } from "./safety/tool-guards";
import { withRetry } from "./safety/retry";
import { makeContextTransform } from "./context/transform";
import { instrumentTool, instrumentStreamFn, getCurrentTraceId } from "./tracing/instrumentation";

export interface AgentBundle {
    agent: Agent;
    logger: AgentLogger;
    store: ConversationStore;
    userId: string;
    setContext: (context: { trace_id: string; user_id: string }) => void;
    newTraceId: () => string;
}

export async function createAgent(userId = "local", customLogger?: AgentLogger): Promise<AgentBundle> {
    const config = loadConfig();

    // Logger
    const logger = customLogger ?? new AgentLogger("./data/events.jsonl");
    if (!customLogger) {
        await logger.init();
    }

    // Persistence
    const store = new ConversationStore("./data/conversations");
    await store.init();
    const initialMessages = await store.load(userId);

    if (initialMessages.length > 0) {
        console.log(`[persistence] loaded ${initialMessages.length} message for user ${userId}`);
    }

    // Wrap streamSimple with retry logic
    let currentContext = {
        trace_id: "",
        user_id: userId,
    };

    const retryingStreamFn = withRetry(streamSimple, {
        maxAttempts: 4,
        onRetry: ({ attempt, maxAttempts, error, delayMs }) => {
            console.warn(`[retry] LLM call attempt ${attempt}/${maxAttempts} failed: ${error.message}. retrying in ${Math.round(delayMs)}ms`);
            logger.log({
                timestamp: new Date().toISOString(),
                trace_id: currentContext.trace_id,
                user_id: userId,
                event_type: "error",
                data: {
                    where: "llm.stream.retry",
                    message: `attempt ${attempt}/${maxAttempts}: ${error.message}`
                }
            });
        }
    });

    const transformContext = makeContextTransform({
        recentTurnsKeptIntact: 3,
        maxTotalTokens: 5000,
        toolResultMaxTokens: 250,
        onTransform: (info) => {
            if (info.toolResultsTrimmed > 0 || info.messagesDropped > 0) {
                console.log(
                    `[context] transform: ${info.inputCount} → ${info.outputCount} ` +
                    `(trimmed ${info.toolResultsTrimmed} tool results, ` +
                    `dropped ${info.messagesDropped} messages)`,
                );
                logger.log({
                    timestamp: new Date().toISOString(),
                    trace_id: currentContext.trace_id,
                    user_id: userId,
                    event_type: "context_transform",
                    data: {
                        ...info
                    },
                });
            }
        }
    });

    // Wrap every tool with span instrumentation
    const instrumentedTools = getTools().map(instrumentTool);

    // Wrap the streamFn AFTER retry — the retry span shows total time including
    // retries, the inner per-attempt LLM time isn't visible. If you want it
    // visible, swap: instrumentStreamFn first, then withRetry.
    const tracedStreamFn = instrumentStreamFn(retryingStreamFn);

    const agent = new Agent({
        initialState: {
            systemPrompt: config.systemPrompt,
            model: config.model,
            tools: instrumentedTools,
            thinkingLevel: "off",
            messages: initialMessages
        },
        streamFn: tracedStreamFn,
        transformContext
    });

    currentContext = {
        trace_id: logger.newTraceId(),
        user_id: userId,
    };

    // Attach guardrails
    attachToolGuards(agent, {
        maxCallsPerTool: 5,
        maxTotalCalls: 20,
        onBlocked: ({ tool, reason }) => {
            console.warn(`[guard] blocked: ${reason}`);
            logger.log({
                timestamp: new Date().toISOString(),
                trace_id: currentContext.trace_id,
                user_id: userId,
                event_type: "error",
                data: {
                    where: "tool_guard",
                    message: reason,
                },
            });
        }
    });

    attachLogger(agent, logger, () => ({
        ...currentContext,
        // Use OTel's trace ID if one is active, else fall back to the random one.
        trace_id: getCurrentTraceId() ?? currentContext.trace_id,
        model: `${config.model.provider}/${config.model.id}`,
    }));

    // Persistence subscription
    agent.subscribe(async (event) => {
        if (event.type === "agent_end") {
            try {
                const snapshot = [...agent.state.messages];
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
