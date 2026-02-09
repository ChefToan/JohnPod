import axios from 'axios';
import { MenuApiParams, MenuResponse } from '../commands/type/menu';
import { menuCache } from './menuCache';
import { DINING_HALLS } from '../utils/config';
import { env } from '../utils/env';

const MENU_API_URL = env.getOptional('ASU_MENU_API_URL') || 'https://asu.campusdish.com/api/menu/GetMenus';

const apiClient = axios.create({
    baseURL: MENU_API_URL,
    timeout: 10000,
    headers: {
        'User-Agent': 'JohnPod/1.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
    },
    httpAgent: new (require('http').Agent)({ keepAlive: true, maxSockets: 5 }),
    httpsAgent: new (require('https').Agent)({ keepAlive: true, maxSockets: 5 })
});

class CircuitBreaker {
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly failureThreshold = 5;
    private readonly recoveryTimeoutMs = 300000; // 5 minutes

    canMakeRequest(): boolean {
        if (this.failureCount < this.failureThreshold) return true;
        if (Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs) {
            this.reset();
            return true;
        }
        return false;
    }

    recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();
    }

    recordSuccess(): void {
        this.failureCount = 0;
    }

    reset(): void {
        this.failureCount = 0;
        this.lastFailureTime = 0;
    }

    getState(): { failureCount: number; canMakeRequest: boolean } {
        return { failureCount: this.failureCount, canMakeRequest: this.canMakeRequest() };
    }
}

const circuitBreaker = new CircuitBreaker();

/**
 * Fetch from the ASU API directly (no cache). Used by preload.
 */
async function fetchFromApi(params: MenuApiParams): Promise<MenuResponse> {
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== '') queryParams[key] = value;
    }

    const maxRetries = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const start = Date.now();
            const response = await apiClient.get('', { params: queryParams });
            console.log(`[MenuService] API call OK for ${params.locationId} (${Date.now() - start}ms, attempt ${attempt + 1})`);
            circuitBreaker.recordSuccess();

            if (!response.data) throw new Error('Empty response from ASU API');
            return response.data;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = 1000 * (attempt + 1);
                console.log(`[MenuService] API call failed for ${params.locationId} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    circuitBreaker.recordFailure();
    throw lastError || new Error('All retry attempts failed');
}

export class MenuService {
    /**
     * Get menu for a dining hall. Reads from the in-memory cache first.
     * On a cache miss (shouldn't happen after preload), fetches live and caches.
     */
    static async fetchMenu(params: MenuApiParams): Promise<MenuResponse> {
        // Check in-memory cache by locationId
        const cached = menuCache.get(params.locationId);
        if (cached) {
            console.log(`[MenuService] Cache HIT for ${params.locationId}`);
            return cached;
        }

        // Cache miss - fetch live
        console.log(`[MenuService] Cache MISS for ${params.locationId}, fetching from ASU API...`);

        if (!circuitBreaker.canMakeRequest()) {
            throw new Error('Service temporarily unavailable due to repeated failures');
        }

        const data = await fetchFromApi(params);
        menuCache.set(params.locationId, data);
        return data;
    }

    /**
     * Fetch all dining hall menus from the ASU API and populate the in-memory cache.
     * Called on startup and at noon/midnight Arizona time.
     */
    static async preloadMenus(): Promise<void> {
        console.log('[MenuService] Starting menu preload...');
        const startTime = Date.now();

        if (!circuitBreaker.canMakeRequest()) {
            console.warn('[MenuService] Circuit breaker is OPEN, preload aborted');
            return;
        }

        // Get today's date in Arizona timezone
        const arizonaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const [year, month, day] = arizonaDateStr.split('-').map(Number);
        const dateString = `${month}/${day}/${year}`;

        console.log(`[MenuService] Preloading menus for ${dateString}`);

        // Clear old cache before loading fresh data
        menuCache.clear();

        let successCount = 0;
        let failureCount = 0;

        for (const [hallKey, hallConfig] of Object.entries(DINING_HALLS)) {
            if (!circuitBreaker.canMakeRequest()) {
                console.warn('[MenuService] Circuit breaker opened during preload, stopping');
                break;
            }

            try {
                // Fetch with no periodId - the API returns all periods in one response
                const data = await fetchFromApi({
                    mode: 'Daily',
                    locationId: hallConfig.id,
                    date: dateString,
                    periodId: ''
                });
                menuCache.set(hallConfig.id, data);
                successCount++;
                console.log(`[MenuService] Preloaded ${hallKey}`);
            } catch (error) {
                failureCount++;
                console.error(`[MenuService] Failed to preload ${hallKey}:`, error);
            }

            // Small delay between requests to be polite to the API
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`[MenuService] Preload completed in ${duration}s - ${successCount} succeeded, ${failureCount} failed, ${menuCache.size()} cached`);
    }
}

export const menuService = MenuService;
