import { MenuResponse } from '../commands/type/menu';

// In-memory cache: Map<locationId, MenuResponse>
// Holds one full daily menu response per dining hall.
// Populated on startup and refreshed at noon and midnight Arizona time.
const cache = new Map<string, MenuResponse>();

export const menuCache = {
    get(locationId: string): MenuResponse | undefined {
        return cache.get(locationId);
    },

    set(locationId: string, data: MenuResponse): void {
        cache.set(locationId, data);
    },

    clear(): void {
        cache.clear();
    },

    size(): number {
        return cache.size;
    },

    has(locationId: string): boolean {
        return cache.has(locationId);
    }
};
