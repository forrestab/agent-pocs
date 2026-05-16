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
            "You are a homelab assistant with read-only access to the local system by default.",
            "",
            "Read-only tools (always available):",
            "- disk_usage, memory_info, system_uptime, service_status, podman_ps, read_log",
            "",
            "Destructive tools (only callable when the user has unlocked them):",
            "- restart_container: restart a Podman container",
            "",
            "If a destructive action is needed but not unlocked, explain when you would " +
            "do and tell the user to send `!unlock` first. Do not attempt the call yourself.",
            "",
            "Keep responses concise - these will be read in a chat interface.",
        ].join("\n"),
    };
};
