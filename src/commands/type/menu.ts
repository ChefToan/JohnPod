export interface MenuApiParams {
    mode: string;
    locationId: string;
    date: string;
    periodId: string;
}

export interface MenuItem {
    ProductId: string;
    MarketingName: string;
    ShortDescription?: string;
}

export interface MenuStation {
    StationId: string;
    Name: string;
}

export interface MenuPeriod {
    PeriodId: string;
    Name: string;
    IsActive: boolean;
    UtcMealPeriodStartTime?: string; // Made optional with ?
    UtcMealPeriodEndTime?: string;   // Made optional with ?
}

export interface MenuResponse {
    Menu?: {
        MenuStations?: MenuStation[];
        MenuProducts?: Array<{
            StationId: string;
            Product: MenuItem;
        }>;
        MenuPeriods?: MenuPeriod[];
    };
    Location?: {
        Name: string;
    };
    SelectedPeriodName?: string;
}

// Mapping of dining hall names to their IDs
export enum DiningHallId {
    Barrett = "4295",
    Manzy = "4294",
    Hassay = "3360",
    Tooker = "10585",
    MU = "4293",
    HIDA = "88279"
}