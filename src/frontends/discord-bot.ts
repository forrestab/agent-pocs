import { Client, GatewayIntentBits, Events, type Message, ChannelType } from "discord.js";

import { createAgent, type AgentBundle } from "../agent";
import { AgentLogger } from "../observability/logger";

interface BotOptions {
    token: string;
    ownerId: string;
    allowedUserIds: Set<string>;
}

export async function startDiscordBot(options: BotOptions): Promise<void> {
    const { token, allowedUserIds } = options;

    // one agent bundle per discord user. created lazily on first message.
    const agents = new Map<string, AgentBundle>();

    const logger = new AgentLogger("./data/events.jsonl");
    await logger.init();

    async function getOrCreateAgent(userId: string): Promise<AgentBundle> {
        let bundle = agents.get(userId);
        if (bundle) {
            return bundle;
        }

        bundle = await createAgent(userId, logger);

        // Add a per-user subscriber for buffering text deltas. We need this
        // separate from the logger because Discord doesn't stream — it sends
        // complete messages — so we accumulate and send at the end.
        agents.set(userId, bundle);

        return bundle;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
    });

    client.once(Events.ClientReady, (c) => {
        console.log(`[discord] logged in as ${c.user.tag}`);
        console.log(`[discord] allowed users: ${[...allowedUserIds].join(", ")}`);
    });

    client.on(Events.MessageCreate, async (message: Message) => {
        if (message.author.bot) {
            return;
        }

        // Only respond to mentions in guild channels, but to all DMs.
        const isDm = message.channel.type === ChannelType.DM;
        const isMentioned = message.mentions.has(client.user!);
        if (!isDm && !isMentioned) {
            return;
        }

        // Allowlist check — silently ignore anyone not approved.
        if (!allowedUserIds.has(message.author.id)) {
            console.log(`[discord] ignored messages from unauthorized user ${message.author.id}`);
            return;
        }

        // Strip the @mention from the message text
        const userText = message.content
            .replace(`<@${client.user!.id}>`, "")
            .replace(`<@!${client.user!.id}>`, "")
            .trim();
        if (!userText) {
            return;
        }

        // Slash-style commands handled before reaching the agent
        if (userText === "/clear") {
            const bundle = agents.get(message.author.id);
            if (bundle) {
                await bundle.store.clear(message.author.id);
                bundle.agent.state.messages = [];
            }

            await message.reply("conversation cleared");
            return;
        }

        if (userText === "/info") {
            const bundle = agents.get(message.author.id);
            const count = bundle?.agent.state.messages.length ?? 0;
            const model = bundle?.agent.state.model.id;

            await message.reply(`messages: ${count}\nmodel: ${model}`);
            return;
        }

        // Get the user's agent and prepare to handle this message.
        const bundle = await getOrCreateAgent(message.author.id);
        const { agent, logger } = bundle;

        // Start a fresh trace for this user message.
        const trace_id = bundle.newTraceId();

        bundle.setContext({ trace_id, user_id: message.author.id });
        logger.log({
            timestamp: new Date().toISOString(),
            trace_id,
            user_id: message.author.id,
            event_type: "user_message",
            data: { content: userText, content_length: userText.length }
        });

        // Buffer the agent's response. Subscribe just for this turn, unsubscribe
        // when done — otherwise subscribers from previous turns would still fire.
        let responseBuffer = "";
        const unsubscribe = agent.subscribe((event) => {
            if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
                responseBuffer += event.assistantMessageEvent.delta;
            }
        });

        // Show typing indicator while the agent thinks. Discord's sendTyping
        // lasts ~10 seconds, so we re-fire every 8s.
        const typingInterval = setInterval(() => {
            if ("sendTyping" in message.channel) {
                message.channel.sendTyping().catch(() => { });
            }
        }, 8_000);

        if ("sendTyping" in message.channel) {
            message.channel.sendTyping().catch(() => { });
        }

        try {
            await agent.prompt(userText);
        } catch (error: any) {
            logger.log({
                timestamp: new Date().toISOString(),
                trace_id,
                user_id: message.author.id,
                event_type: "error",
                data: { where: "agent.prompt", message: error.message, stack: error.stack }
            });
            responseBuffer = `error ${error.message}`;
        } finally {
            unsubscribe();
            clearInterval(typingInterval);
        }

        // Send the response, splitting at Discord's 2000-char limit.
        const reply = responseBuffer.trim() || "(no response)";
        await sendChunked(message, reply);
    });

    await client.login(token);
}

// Discord caps individual messages at 2000 characters. We chunk on word
// boundaries when possible to avoid breaking words awkwardly mid-flight.
async function sendChunked(message: Message, text: string): Promise<void> {
    const MAX = 1900; // a little under 2000 for safety margin

    if (text.length <= MAX) {
        await message.reply(text);
        return;
    }

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX) {
            chunks.push(remaining);
            break;
        }

        // Look for the last newline in the first MAX chars; fall back to
        // last space; fall back to hard cut.
        let cutAt = remaining.lastIndexOf("\n", MAX);
        if (cutAt < MAX / 2) {
            cutAt = remaining.lastIndexOf(" ", MAX);
        }

        if (cutAt < MAX / 2) {
            cutAt = MAX;
        }

        chunks.push(remaining.slice(0, cutAt));
        remaining = remaining.slice(cutAt).trimStart();
    }

    // Reply once, then send subsequent chunks as follow-ups in the same channel.
    const [first, ...rest] = chunks as [string, ...string[]];

    await message.reply(first);

    for (const chunk of rest) {
        if ("send" in message.channel) {
            await message.channel.send(chunk);
        }
    }
}
