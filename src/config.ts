import { getModel, type KnownProvider } from "@mariozechner/pi-ai";

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
        systemPrompt:
            "You are a homelab assistant. Use the available tools to answer " +
            "questions about the system. Use run_shell only for read-only " +
            "diagnostics (df, free, uptime, docker ps, systemctl status, journalctl). " +
            "Never run anything that modifies state without confirming with the user first. " +
            "Keep responses concise.",
    };
};
