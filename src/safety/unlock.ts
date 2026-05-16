export interface UnlockState {
    /** When the unlock expires. If undefined or past, unlock is inactive. */
    expiresAt?: number;
}

export class UnlockManager {
    private states = new Map<string, UnlockState>();

    /**
     * Unlock destructive tools for a user for the given duration (in ms).
     * Returns the expiration timestamp.
     */
    unlock(userId: string, durationMs: number): number {
        const expiresAt = Date.now() + durationMs;
        this.states.set(userId, { expiresAt });
        return expiresAt;
    }

    /** Revoke unlock immediately. */
    lock(userId: string): void {
        this.states.delete(userId);
    }

    /** Is unlock currently active for this user? */
    isUnlocked(userId: string): boolean {
        const state = this.states.get(userId);
        if (!state?.expiresAt) {
            return false;
        }

        if (Date.now() >= state.expiresAt) {
            this.states.delete(userId); // self-cleanup
            return false;
        }

        return true;
    }

    /** How many ms remain on the unlock, or 0 if not unlocked. */
    remainingMs(userId: string): number {
        const state = this.states.get(userId);
        if (!state?.expiresAt) {
            return 0;
        }

        return Math.max(0, state.expiresAt - Date.now());
    }
}
