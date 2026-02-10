import { menuCache } from '../services/menuCache';
import { apiRateLimiter, commandCooldown } from './rateLimiter';

/**
 * Periodic health/resource monitor for the bot.
 * Logs memory usage, cache stats, and rate limiter state.
 * Useful for monitoring on OCI or any VM without external APM.
 */
class HealthMonitor {
    private interval?: NodeJS.Timeout;
    private readonly intervalMs: number;
    private startTime = Date.now();

    constructor(intervalMs = 30 * 60 * 1000) { // Default: every 30 minutes
        this.intervalMs = intervalMs;
    }

    start(): void {
        this.startTime = Date.now();
        console.log('[HealthMonitor] Started');

        // Log immediately on start
        this.logHealth();

        this.interval = setInterval(() => {
            this.logHealth();
            this.performMaintenance();
        }, this.intervalMs);

        // Don't prevent process exit
        this.interval.unref();
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        console.log('[HealthMonitor] Stopped');
    }

    /**
     * Log a health snapshot to stdout.
     */
    logHealth(): void {
        const mem = process.memoryUsage();
        const cacheStats = menuCache.getStats();
        const rateLimiterStats = apiRateLimiter.getStats();
        const uptimeMin = Math.round((Date.now() - this.startTime) / 60000);

        console.log([
            `[Health] uptime=${uptimeMin}m`,
            `rss=${mb(mem.rss)}MB`,
            `heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB`,
            `cache=${cacheStats.entries}/${cacheStats.maxEntries} (~${cacheStats.approxMemoryMB}MB, oldest=${cacheStats.oldestAgeMins}m)`,
            `rateLimiter=${rateLimiterStats.tokens}/${rateLimiterStats.maxTokens} tokens`,
            `cooldowns=${commandCooldown.size}`
        ].join(' | '));
    }

    /**
     * Run periodic maintenance tasks.
     */
    private performMaintenance(): void {
        // Evict expired cache entries
        const cacheEvicted = menuCache.evictExpired();
        if (cacheEvicted > 0) {
            console.log(`[HealthMonitor] Evicted ${cacheEvicted} expired cache entries`);
        }

        // Clean up expired cooldowns
        const cooldownsCleaned = commandCooldown.cleanup();
        if (cooldownsCleaned > 0) {
            console.log(`[HealthMonitor] Cleaned ${cooldownsCleaned} expired cooldowns`);
        }
    }

    /**
     * Get a snapshot of the current health state (for programmatic use).
     */
    getSnapshot() {
        const mem = process.memoryUsage();
        return {
            uptimeMs: Date.now() - this.startTime,
            memory: {
                rssMB: mb(mem.rss),
                heapUsedMB: mb(mem.heapUsed),
                heapTotalMB: mb(mem.heapTotal),
                externalMB: mb(mem.external)
            },
            cache: menuCache.getStats(),
            rateLimiter: apiRateLimiter.getStats(),
            cooldowns: commandCooldown.size
        };
    }
}

function mb(bytes: number): number {
    return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export const healthMonitor = new HealthMonitor();
