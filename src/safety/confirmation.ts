import { randomUUIDv7 } from "bun";

export interface PendingConfirmation {
    id: string;
    userId: string;
    toolName: string;
    args: unknown;
    proposedAt: number;
    expiresAt: number;
}

export class ConfirmationQueue {
    private pending = new Map<string, PendingConfirmation>();
    // Map from userId to the most recent pending confirmation ID
    private latestByUser = new Map<string, string>();

    /** Create a new pending confirmation. Returns the confirmation ID. */
    propose(
        userId: string,
        toolName: string,
        args: unknown,
        timeoutMs: number = 5 * 60 * 1000, // 5 min default
    ): string {
        const id = randomUUIDv7();
        const now = Date.now();
        this.pending.set(id, {
            id,
            userId,
            toolName,
            args,
            proposedAt: now,
            expiresAt: now + timeoutMs
        });
        this.latestByUser.set(userId, id);
        return id;
    }

    /**
     * Look up the most recent pending confirmation for a user.
     * Returns undefined if none, or if expired.
     */
    latest(userId: string): PendingConfirmation | undefined {
        const id = this.latestByUser.get(userId);
        if (!id) {
            return undefined;
        }

        const pending = this.pending.get(id);
        if (!pending) {
            this.latestByUser.delete(userId);
            return undefined;
        }

        return pending;
    }

    /** Approve and remove. Returns the action details. */
    approve(userId: string): PendingConfirmation | undefined {
        const pending = this.latest(userId);
        if (!pending) {
            return undefined;
        }

        this.pending.delete(pending.id);
        this.latestByUser.delete(userId);
        return pending;
    }

    /** Reject and remove. */
    reject(userId: string): boolean {
        const pending = this.latest(userId);
        if (!pending) {
            return false;
        }

        this.pending.delete(pending.id);
        this.latestByUser.delete(userId);
        return true;
    }
}
