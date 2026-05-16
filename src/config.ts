import { getModel, type KnownProvider } from "@earendil-works/pi-ai";

export interface AppConfig {
    model: ReturnType<typeof getModel>;
    systemPrompt: string;
};

export function loadConfig(): AppConfig {
    const provider: KnownProvider = (process.env.MODEL_PROVIDER ?? "openrouter") as KnownProvider;
    // Seems I need to cast to `never` because of `process.env` being either `string | unknown`. Zod seems to be the
    // recommended approach.
    const modelId: never = (process.env.MODEL_ID ?? "google/gemma-4-31b-it:free") as never;

    if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY not set");
    }

    return {
        model: getModel(provider, modelId),
        systemPrompt: [
            "You are a homelab assistant with read-only access to the local system.",
            "",
            "You have specific tools for common diagnostics:",
            "- disk_usage: check disk space",
            "- memory_info: check RAM and swap",
            "- system_uptime: check uptime and load",
            "- service_status: check a systemd service",
            "- podman_ps: List running Podman containers",
            "- read_log: read a service log",
            "",
            "Prefer the narrow tools over generic shell commands. If no tool fits, " +
            "say so rather than guessing. Always include the actual tool output (logs, stats, etc.) " +
            "in your response — don't just say you read it. Keep surrounding commentary concise.",
            "Always provide detailed explanations of your reasoning.",
        ].join("\n"),
    };
};
