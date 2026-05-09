import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export class ConversationStore {
    constructor(private rootDir: string) {}

    async init(): Promise<void> {
        await Bun.$`mkdir -p ${this.rootDir}`.quiet();
    }

    private pathFor(userId: string): string {
        const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");

        return join(this.rootDir, `${safe}.json`);
    }

    async load(userId: string): Promise<AgentMessage[]> {
        const path = this.pathFor(userId);
        const file = Bun.file(path);

        if (!(await file.exists())) {
            return [];
        }

        try {
            const parsed = await file.json();

            if (!Array.isArray(parsed)) {
                console.warn(`[persistence] ${path} is not an array, ignoring`);

                return [];
            }

            return parsed as AgentMessage[];
        } catch (error: any) {
            console.warn(`[persistence] failed to load ${path}: ${error.message}`);

            return [];
        }
    }

    async save(userId: string, messages: AgentMessage[]): Promise<void> {
        const path = this.pathFor(userId);
        const tmpPath = `${path}.tmp`;

        await Bun.write(tmpPath, JSON.stringify(messages, null, 2));
        await Bun.$`mv ${tmpPath} ${path}`.quiet();
    }

    async clear(userId: string): Promise<void> {
        const path = this.pathFor(userId);

        if (await Bun.file(path).exists()) {
            await Bun.$`rm ${path}`.quiet();
        }
    }
}
