/**
 * Token bucket rate limiter for outgoing ASU API requests.
 * Prevents hammering the CampusDish API and getting blocked.
 *
 * Default: 10 requests per 10 seconds, refills at 1/second.
 */
class ApiRateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly maxTokens: number;
    private readonly refillRatePerMs: number;
    private waitQueue: Array<() => void> = [];

    constructor(maxTokens = 10, refillPerSecond = 1) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.lastRefill = Date.now();
        this.refillRatePerMs = refillPerSecond / 1000;
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const newTokens = elapsed * this.refillRatePerMs;
        this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
        this.lastRefill = now;
    }

    /**
     * Wait until a token is available, then consume it.
     * This ensures API calls are naturally throttled.
     */
    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Calculate wait time until 1 token is available
        const deficit = 1 - this.tokens;
        const waitMs = Math.ceil(deficit / this.refillRatePerMs);

        return new Promise<void>((resolve) => {
            setTimeout(() => {
                this.refill();
                this.tokens = Math.max(0, this.tokens - 1);
                resolve();
            }, waitMs);
        });
    }

    /**
     * Check if a request can be made immediately (non-blocking).
     */
    canAcquire(): boolean {
        this.refill();
        return this.tokens >= 1;
    }

    getStats(): { tokens: number; maxTokens: number; queueLength: number } {
        this.refill();
        return {
            tokens: Math.round(this.tokens * 100) / 100,
            maxTokens: this.maxTokens,
            queueLength: this.waitQueue.length
        };
    }
}

/**
 * Per-user command cooldown tracker.
 * Prevents individual users from spamming commands.
 *
 * Default: 5 second cooldown per user per command.
 */
class CommandCooldown {
    private cooldowns = new Map<string, number>();
    private readonly defaultCooldownMs: number;

    constructor(defaultCooldownMs = 5000) {
        this.defaultCooldownMs = defaultCooldownMs;
    }

    /**
     * Check if a user is on cooldown for a command.
     * Returns remaining cooldown in seconds, or 0 if ready.
     */
    check(userId: string, commandName: string): number {
        const key = `${userId}:${commandName}`;
        const expiresAt = this.cooldowns.get(key);

        if (!expiresAt) return 0;

        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            this.cooldowns.delete(key);
            return 0;
        }

        return Math.ceil(remaining / 1000);
    }

    /**
     * Set cooldown for a user+command. Call this after a command executes.
     */
    set(userId: string, commandName: string, cooldownMs?: number): void {
        const key = `${userId}:${commandName}`;
        this.cooldowns.set(key, Date.now() + (cooldownMs ?? this.defaultCooldownMs));
    }

    /**
     * Clean up expired entries to prevent memory growth.
     */
    cleanup(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, expiresAt] of this.cooldowns) {
            if (expiresAt <= now) {
                this.cooldowns.delete(key);
                cleaned++;
            }
        }

        return cleaned;
    }

    get size(): number {
        return this.cooldowns.size;
    }
}

// Export singleton instances
export const apiRateLimiter = new ApiRateLimiter(10, 1); // 10 burst, 1/sec refill
export const commandCooldown = new CommandCooldown(3000); // 3 second user cooldown
