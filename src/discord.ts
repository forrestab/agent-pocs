import { startDiscordBot } from "./frontends/discord-bot"

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

await startDiscordBot({ token, ownerId, allowedUserIds });
