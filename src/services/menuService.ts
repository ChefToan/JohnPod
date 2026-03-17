import axios from 'axios';
import { MenuApiParams, MenuResponse } from '../commands/type/menu';
import { menuCache } from './menuCache';
import { DINING_HALLS } from '../utils/config';
import { apiRateLimiter } from '../utils/rateLimiter';

const GRAPHQL_URL = 'https://api.elevate-dxp.com/api/mesh/c087f756-cc72-4649-a36f-3a41b700c519/graphql';
const API_KEY = 'ElevateAPIProd';

const graphqlHeaders = {
    'X-Api-Key': API_KEY,
    'magento-store-code': 'ch_asu',
    'magento-website-code': 'ch_asu',
    'magento-store-view-code': 'ch_asu_en',
    'Store': 'ch_asu_en',
    'User-Agent': 'JohnPod/2.0',
    'Accept': 'application/json'
};

// Map old locationId to new campus/location URL keys
function getLocationKeys(locationId: string): { campusUrlKey: string; locationUrlKey: string } | null {
    for (const hall of Object.values(DINING_HALLS)) {
        if (hall.id === locationId) {
            return { campusUrlKey: hall.campusUrlKey, locationUrlKey: hall.locationUrlKey };
        }
    }
    return null;
}

// Convert M/D/YYYY to YYYY-MM-DD
function convertDateFormat(dateStr: string): string {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

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
 * Execute a GraphQL GET query against the Elevate DXP API.
 */
async function graphqlQuery(query: string, rateLimit = true): Promise<any> {
    const maxRetries = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (rateLimit) {
                await apiRateLimiter.acquire();
            }

            const start = Date.now();
            const response = await axios.get(GRAPHQL_URL, {
                params: { query },
                headers: graphqlHeaders,
                timeout: 15000
            });

            if (response.data?.errors?.length) {
                const errMsg = response.data.errors.map((e: any) => e.message).join('; ');
                throw new Error(`GraphQL error: ${errMsg}`);
            }

            console.log(`[MenuService] GraphQL query OK (${Date.now() - start}ms, attempt ${attempt + 1})`);
            circuitBreaker.recordSuccess();
            return response.data?.data;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = 1000 * (attempt + 1);
                console.log(`[MenuService] GraphQL query failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    circuitBreaker.recordFailure();
    throw lastError || new Error('All retry attempts failed');
}

/**
 * Fetch location details (stations + meal periods) from the new GraphQL API.
 */
async function fetchLocationDetails(campusUrlKey: string, locationUrlKey: string, rateLimit = true) {
    const query = `{getLocation(campusUrlKey:"${campusUrlKey}" locationUrlKey:"${locationUrlKey}"){commerceAttributes{uid children{id name position}meal_periods{id name position}}aemAttributes{name}}}`;
    const data = await graphqlQuery(query, rateLimit);
    return data?.getLocation;
}

/**
 * Fetch menu items for a specific meal period from the new GraphQL API.
 */
async function fetchMealPeriodRecipes(campusUrlKey: string, locationUrlKey: string, date: string, mealPeriod: string, rateLimit = true) {
    const query = `{getLocationMealPeriodRecipes(campusUrlKey:"${campusUrlKey}" locationUrlKey:"${locationUrlKey}" date:"${date}" mealPeriod:"${mealPeriod}"){locationMealPeriodRecipesData{stationSkuMap{id skus}}products{sku name}}}`;
    const data = await graphqlQuery(query, rateLimit);
    return data?.getLocationMealPeriodRecipes;
}

/**
 * Convert new API location details to the old MenuResponse format (periods only).
 */
function locationToMenuResponse(locationData: any): MenuResponse {
    const mealPeriods = locationData?.commerceAttributes?.meal_periods || [];
    const locationName = locationData?.aemAttributes?.name || 'Unknown';

    return {
        Menu: {
            MenuPeriods: mealPeriods.map((p: any) => ({
                PeriodId: p.name, // Use name as ID since the new API takes period name
                Name: p.name,
                IsActive: true
            })),
            MenuStations: [],
            MenuProducts: []
        },
        Location: {
            Name: locationName
        }
    };
}

/**
 * Convert new API meal period recipes to the old MenuResponse format (stations + products).
 */
function recipesToMenuResponse(recipesData: any, locationData: any, periodName: string): MenuResponse {
    const stationSkuMap = recipesData?.locationMealPeriodRecipesData?.stationSkuMap || [];
    const products = recipesData?.products || [];
    const children = locationData?.commerceAttributes?.children || [];
    const locationName = locationData?.aemAttributes?.name || 'Unknown';

    // Build a SKU→product name lookup
    const skuToProduct = new Map<string, string>();
    for (const product of products) {
        if (product.sku && product.name) {
            skuToProduct.set(product.sku, product.name);
        }
    }

    // Build a station ID→name lookup from location children
    const stationIdToName = new Map<number, string>();
    for (const child of children) {
        stationIdToName.set(child.id, child.name);
    }

    // Build MenuStations and MenuProducts
    const menuStations: any[] = [];
    const menuProducts: any[] = [];

    for (const station of stationSkuMap) {
        const stationId = String(station.id);
        const stationName = stationIdToName.get(station.id) || `Station ${station.id}`;

        menuStations.push({
            StationId: stationId,
            Name: stationName,
            PeriodId: periodName
        });

        // Map SKUs to products, deduplicating by name
        const seenNames = new Set<string>();
        for (const sku of station.skus || []) {
            const productName = skuToProduct.get(sku);
            if (productName && !seenNames.has(productName)) {
                seenNames.add(productName);
                menuProducts.push({
                    StationId: stationId,
                    Product: {
                        ProductId: sku,
                        MarketingName: productName
                    }
                });
            }
        }
    }

    return {
        Menu: {
            MenuPeriods: (locationData?.commerceAttributes?.meal_periods || []).map((p: any) => ({
                PeriodId: p.name,
                Name: p.name,
                IsActive: true
            })),
            MenuStations: menuStations,
            MenuProducts: menuProducts
        },
        Location: {
            Name: locationName
        },
        SelectedPeriodName: periodName
    };
}

// Cache for location details (stations/periods don't change often)
const locationCache = new Map<string, { data: any; timestamp: number }>();
const LOCATION_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function getCachedLocationDetails(campusUrlKey: string, locationUrlKey: string, rateLimit = true) {
    const key = `${campusUrlKey}_${locationUrlKey}`;
    const cached = locationCache.get(key);
    if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_TTL) {
        return cached.data;
    }
    const data = await fetchLocationDetails(campusUrlKey, locationUrlKey, rateLimit);
    if (data) {
        locationCache.set(key, { data, timestamp: Date.now() });
    }
    return data;
}

export class MenuService {
    /**
     * Build a composite cache key from location, date, and period.
     */
    private static getCacheKey(locationId: string, date: string, periodId: string): string {
        return `${locationId}_${date}_${periodId}`;
    }

    /**
     * Get today's date string in Arizona timezone (M/D/YYYY format).
     */
    private static getTodayDateString(): string {
        const arizonaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const [year, month, day] = arizonaDateStr.split('-').map(Number);
        return `${month}/${day}/${year}`;
    }

    /**
     * Get menu for a dining hall using the new Elevate DXP GraphQL API.
     */
    static async fetchMenu(params: MenuApiParams): Promise<MenuResponse> {
        const locationKeys = getLocationKeys(params.locationId);
        if (!locationKeys) {
            throw new Error(`Unknown location ID: ${params.locationId}`);
        }

        const isToday = params.date === this.getTodayDateString();
        const cacheKey = this.getCacheKey(params.locationId, params.date, params.periodId);

        // Check cache for today's date
        if (isToday) {
            const cached = menuCache.get(cacheKey);
            if (cached) {
                console.log(`[MenuService] Cache HIT for ${cacheKey}`);
                return cached;
            }
        }

        console.log(`[MenuService] ${isToday ? 'Cache MISS' : 'Live fetch (non-today)'} for ${cacheKey}`);

        if (!circuitBreaker.canMakeRequest()) {
            throw new Error('Service temporarily unavailable due to repeated failures');
        }

        const { campusUrlKey, locationUrlKey } = locationKeys;
        const apiDate = convertDateFormat(params.date);

        let data: MenuResponse;

        if (!params.periodId) {
            // No period specified - fetch location details for period list
            const locationData = await getCachedLocationDetails(campusUrlKey, locationUrlKey);
            data = locationToMenuResponse(locationData);
        } else {
            // Period specified - fetch menu items for that period
            const [locationData, recipesData] = await Promise.all([
                getCachedLocationDetails(campusUrlKey, locationUrlKey),
                fetchMealPeriodRecipes(campusUrlKey, locationUrlKey, apiDate, params.periodId)
            ]);
            data = recipesToMenuResponse(recipesData, locationData, params.periodId);
        }

        // Cache today's data
        if (isToday) {
            menuCache.set(cacheKey, data);
        }

        return data;
    }

    /**
     * Preload menus for all dining halls.
     */
    static async preloadMenus(): Promise<void> {
        console.log('[MenuService] Starting menu preload...');
        const startTime = Date.now();

        if (!circuitBreaker.canMakeRequest()) {
            console.warn('[MenuService] Circuit breaker is OPEN, preload aborted');
            return;
        }

        const dateString = this.getTodayDateString();
        const apiDate = convertDateFormat(dateString);

        console.log(`[MenuService] Preloading menus for ${dateString}`);
        menuCache.clear();

        let successCount = 0;
        let failureCount = 0;

        for (const [hallKey, hallConfig] of Object.entries(DINING_HALLS)) {
            if (!circuitBreaker.canMakeRequest()) {
                console.warn('[MenuService] Circuit breaker opened during preload, stopping');
                break;
            }

            try {
                // Preload location details
                const locationData = await getCachedLocationDetails(
                    hallConfig.campusUrlKey, hallConfig.locationUrlKey, false
                );

                if (!locationData) {
                    failureCount++;
                    console.error(`[MenuService] Failed to preload ${hallKey}: no location data`);
                    continue;
                }

                // Cache period list
                const periodsResponse = locationToMenuResponse(locationData);
                const periodsCacheKey = this.getCacheKey(hallConfig.id, dateString, '');
                menuCache.set(periodsCacheKey, periodsResponse);
                successCount++;
                console.log(`[MenuService] Preloaded ${hallKey} (periods)`);

                // Preload each meal period
                const mealPeriods = locationData.commerceAttributes?.meal_periods || [];
                const periodResults = await Promise.allSettled(
                    mealPeriods.map((period: any) =>
                        fetchMealPeriodRecipes(
                            hallConfig.campusUrlKey, hallConfig.locationUrlKey,
                            apiDate, period.name, false
                        ).then(recipesData => {
                            const menuResponse = recipesToMenuResponse(recipesData, locationData, period.name);
                            const periodCacheKey = this.getCacheKey(hallConfig.id, dateString, period.name);
                            menuCache.set(periodCacheKey, menuResponse);
                            console.log(`[MenuService] Preloaded ${hallKey} period ${period.name}`);
                            return { success: true };
                        })
                    )
                );

                for (const result of periodResults) {
                    if (result.status === 'fulfilled') {
                        successCount++;
                    } else {
                        failureCount++;
                        console.error(`[MenuService] Failed to preload ${hallKey} period:`, result.reason);
                    }
                }
            } catch (error) {
                failureCount++;
                console.error(`[MenuService] Failed to preload ${hallKey}:`, error);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`[MenuService] Preload completed in ${duration}s - ${successCount} succeeded, ${failureCount} failed, ${menuCache.size()} cached`);
    }
}

export const menuService = MenuService;
