import { randomUUIDv7 } from "bun";

import type { AgentEvent } from "./types";

export class AgentLogger {
    private writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private path: string) { }

    async init(): Promise<void> {
        // Ensure parent directory exists. Bun.file().writer() won't create dirs.
        const dir = this.path.substring(0, this.path.lastIndexOf("/"));

        if (dir) {
            await Bun.$`mkdir -p ${dir}`.quiet();
        }

        this.writer = Bun.file(this.path).writer();
    }

    newTraceId(): string {
        // UUIDv7 is time-sortable — handy when you grep logs and want events
        // in chronological order without parsing timestamps.
        return randomUUIDv7();
    }

    log(event: AgentEvent): void {
        if (!this.writer) {
            throw new Error("AgentLogger.init() must be called before log()");
        }

        const line = JSON.stringify(event) + "\n";
        // Sequential writes via promise chain to avoid interleaving.
        this.writeQueue = this.writeQueue.then(async () => {
            this.writer!.write(line);
            await this.writer!.flush();
        });
    }

    async flush(): Promise<void> {
        await this.writeQueue;
    }

    async close(): Promise<void> {
        await this.flush();
        await this.writer?.end();
    }
}
