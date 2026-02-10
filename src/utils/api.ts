import { MenuApiParams, MenuResponse, MenuItem } from '../commands/type/menu';
import { menuService } from '../services/menuService';

// Re-export for backward compatibility
export async function fetchMenu(params: MenuApiParams): Promise<MenuResponse> {
    return await menuService.fetchMenu(params);
}

// Organize menu items by station, optionally filtered by period
export function organizeMenuByStation(menuData: MenuResponse, periodId?: string): Map<string, MenuItem[]> {
    const stationMap = new Map<string, MenuItem[]>();

    // If MenuProducts and MenuStations exist
    if (menuData.Menu?.MenuProducts && menuData.Menu.MenuStations) {
        // Filter stations by period if specified, otherwise use all
        const filteredStations = periodId
            ? menuData.Menu.MenuStations.filter(s => s.PeriodId === periodId)
            : menuData.Menu.MenuStations;

        // Build a set of valid station IDs for this period
        const validStationIds = new Set(filteredStations.map(s => s.StationId));

        // Create empty arrays for each unique station
        filteredStations.forEach(station => {
            if (!stationMap.has(station.StationId)) {
                stationMap.set(station.StationId, []);
            }
        });

        // Then assign products to their matching stations
        menuData.Menu.MenuProducts.forEach(productWrapper => {
            const stationId = productWrapper.StationId;
            const product = productWrapper.Product;

            if (validStationIds.has(stationId) && stationMap.has(stationId)) {
                stationMap.get(stationId)!.push(product);
            }
        });
    }

    return stationMap;
}

// Get the names of stations, optionally filtered by period
export function getStationNames(menuData: MenuResponse, periodId?: string): Map<string, string> {
    const stationNames = new Map<string, string>();

    if (menuData.Menu?.MenuStations) {
        const filteredStations = periodId
            ? menuData.Menu.MenuStations.filter(s => s.PeriodId === periodId)
            : menuData.Menu.MenuStations;

        filteredStations.forEach(station => {
            stationNames.set(station.StationId, station.Name);
        });
    }

    return stationNames;
}



