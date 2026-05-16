import { startDiscordBot } from "./frontends/discord-bot";
import { initTracing } from "./tracing/init";

initTracing();

const token = Bun.env.DISCORD_TOKEN;
const ownerId = Bun.env.DISCORD_OWNER_ID;

if (!token) {
    console.error("DISCORD_TOKEN is not set");
    process.exit(1);
}

if (!ownerId) {
    console.error("DISCORD_OWNER_ID is not set");
    process.exit(1);
}

const allowedUserIds = new Set([
    ownerId,
    ...(Bun.env.DISCORD_ALLOWED_USERS?.split(",").map((s) => s.trim()) ?? []),
]);

const client = await startDiscordBot({ token, ownerId, allowedUserIds });

const shutdown = () => {
    client.destroy();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
