import { randomUUIDv7 } from "bun";
import { createWriteStream, type WriteStream } from "node:fs";

import type { AgentEvent } from "./types";

export class AgentLogger {
    private stream: WriteStream | null = null;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private path: string) { }

    async init(): Promise<void> {
        // Ensure parent directory exists. createWriteStream won't create dirs.
        const dir = this.path.substring(0, this.path.lastIndexOf("/"));
        if (dir) {
            await Bun.$`mkdir -p ${dir}`.quiet();
        }
        // flags:"a" ensures we always append — Bun.file().writer() opens at
        // position 0 with no truncation, so every restart overwrites the start
        // of the file and corrupts whatever was already there.
        this.stream = createWriteStream(this.path, { flags: "a", encoding: "utf8" });
    }

    newTraceId(): string {
        // UUIDv7 is time-sortable — handy when you grep logs and want events
        // in chronological order without parsing timestamps.
        return randomUUIDv7();
    }

    log(event: AgentEvent): void {
        if (!this.stream) {
            throw new Error("AgentLogger.init() must be called before log()");
        }

        const line = JSON.stringify(event) + "\n";
        // Sequential writes via promise chain to avoid interleaving.
        this.writeQueue = this.writeQueue.then(
            () => new Promise<void>((resolve, reject) => {
                this.stream!.write(line, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            })
        );
    }

    async flush(): Promise<void> {
        await this.writeQueue;
    }

    async close(): Promise<void> {
        await this.flush();
        await new Promise<void>((resolve, reject) => {
            if (!this.stream) { resolve(); return; }
            this.stream.end((err: Error | null | undefined) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}
