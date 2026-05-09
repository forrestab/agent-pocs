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

        const isDm = message.channel.type === ChannelType.DM;
        const isMentioned = message.mentions.has(client.user!);
        if (!isDm && !isMentioned) {
            return;
        }

        if (!allowedUserIds.has(message.author.id)) {
            console.log(`[discord] ignored messages from unauthorized user ${message.author.id}`);
            return;
        }

        const userText = message.content
            .replace(`<@${client.user!.id}>`, "")
            .replace(`<@!${client.user!.id}>`, "")
            .trim();
        if (!userText) {
            return;
        }

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

        const bundle = await getOrCreateAgent(message.author.id);
        const { agent, logger } = bundle;

        const trace_id = bundle.newTraceId();

        bundle.setContext({ trace_id, user_id: message.author.id });
        logger.log({
            timestamp: new Date().toISOString(),
            trace_id,
            user_id: message.author.id,
            event_type: "user_message",
            data: { content: userText, content_length: userText.length }
        });

        let responseBuffer = "";
        const unsubscribe = agent.subscribe((event) => {
            if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
                responseBuffer += event.assistantMessageEvent.delta;
            }
        });

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

        const reply = responseBuffer.trim() || "(no response)";
        await sendChunked(message, reply);
    });

    await client.login(token);
}

async function sendChunked(message: Message, text: string): Promise<void> {
    const MAX = 1900;

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

    const [first, ...rest] = chunks as [string, ...string[]];

    await message.reply(first);

    for (const chunk of rest) {
        if ("send" in message.channel) {
            await message.channel.send(chunk);
        }
    }
}
