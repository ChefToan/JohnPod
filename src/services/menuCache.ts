import { MenuResponse } from '../commands/type/menu';

interface CacheEntry {
    data: MenuResponse;
    createdAt: number;
    lastAccessedAt: number;
    size: number;
}

/**
 * LRU cache with TTL and max entry limit.
 * - Entries expire after `ttlMs` (default 12 hours)
 * - Evicts least-recently-used entries when `maxEntries` is reached
 * - Tracks approximate memory usage for monitoring
 */
class MenuCacheStore {
    private cache = new Map<string, CacheEntry>();
    private readonly maxEntries: number;
    private readonly ttlMs: number;

    constructor(maxEntries = 200, ttlMs = 12 * 60 * 60 * 1000) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }

    get(key: string): MenuResponse | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        // Check TTL expiry
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }

        // Move to end (most recently used) by re-inserting
        this.cache.delete(key);
        entry.lastAccessedAt = Date.now();
        this.cache.set(key, entry);

        return entry.data;
    }

    set(key: string, data: MenuResponse): void {
        // Delete existing entry first (to reset position in Map order)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Evict LRU entries if at capacity
        while (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        const size = this.estimateSize(data);
        this.cache.set(key, {
            data,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            size
        });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Remove all expired entries. Called periodically.
     */
    evictExpired(): number {
        const now = Date.now();
        let evicted = 0;

        for (const [key, entry] of this.cache) {
            if (now - entry.createdAt > this.ttlMs) {
                this.cache.delete(key);
                evicted++;
            }
        }

        return evicted;
    }

    /**
     * Get cache statistics for health monitoring.
     */
    getStats(): { entries: number; maxEntries: number; approxMemoryMB: number; oldestAgeMins: number } {
        let totalSize = 0;
        let oldestCreatedAt = Date.now();

        for (const entry of this.cache.values()) {
            totalSize += entry.size;
            if (entry.createdAt < oldestCreatedAt) {
                oldestCreatedAt = entry.createdAt;
            }
        }

        return {
            entries: this.cache.size,
            maxEntries: this.maxEntries,
            approxMemoryMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
            oldestAgeMins: this.cache.size > 0
                ? Math.round((Date.now() - oldestCreatedAt) / 60000)
                : 0
        };
    }

    /**
     * Rough estimate of JSON data size in bytes.
     */
    private estimateSize(data: MenuResponse): number {
        try {
            return JSON.stringify(data).length * 2; // ~2 bytes per char in V8
        } catch {
            return 50000; // Fallback ~50KB
        }
    }
}

export const menuCache = new MenuCacheStore();
