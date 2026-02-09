import { DiningHallId } from '../commands/type/menu';

export const DINING_HALLS = {
    barrett: {
        name: "Barrett",
        id: DiningHallId.Barrett
    },
    manzy: {
        name: "Manzy",
        id: DiningHallId.Manzy
    },
    hassy: {
        name: "Hassay",
        id: DiningHallId.Hassay
    },
    tooker: {
        name: "Tooker",
        id: DiningHallId.Tooker
    },
    mu: {
        name: "MU",
        id: DiningHallId.MU
    },
    hida: {
        name: "HIDA",
        id: DiningHallId.HIDA
    }
};

// Menu command configuration
export const MENU_CONFIG = {
    // Dining hall choices for the slash command
    DINING_HALL_CHOICES: [
        { name: 'Barrett', value: 'barrett' },
        { name: 'Manzy', value: 'manzy' },
        { name: 'Hassy', value: 'hassy' },
        { name: 'Tooker', value: 'tooker' },
        { name: 'MU (Pitchforks)', value: 'mu' },
        { name: 'HIDA', value: 'hida' }
    ],

    // Collector timeouts
    INTERACTION_TIMEOUT: 10 * 60 * 1000, // 10 minutes

    // Button limits
    MAX_BUTTONS_PER_ROW: 5,

    // Messages
    MESSAGES: {
        LOADING: 'Refreshing menu...',
        NO_MENU_AVAILABLE: 'No menu available for {diningHall} on {date}.',
        NO_PERIODS_AVAILABLE: 'No meal periods available for {diningHall} on {date}.',
        NO_STATION_ITEMS: 'No menu items available for {diningHall} {period} on {date}.',
        PERIOD_UNAVAILABLE: 'Selected period is no longer available.',
        STATION_UNAVAILABLE: 'No items available at this station.',
        INVALID_DATE_FORMAT: 'Invalid date format. Please use MM/DD/YYYY format.',
        INVALID_STATION_FORMAT: 'Invalid station selection format.',
        API_ERROR: 'Unable to fetch menu data at this time. Please try again later.',
        REFRESH_ERROR: 'An error occurred when refreshing the menu. Please use the /menu command again.',
        UNEXPECTED_ERROR: 'An unexpected error occurred. Please try again later.',
        PROCESSING_ERROR: 'There was an issue processing your request.',
        COMMUNICATION_ERROR: 'All communication attempts failed'
    },

    // Display names mapping
    DISPLAY_NAMES: {
        mu: 'Pitchforks'
    },

    // Date format configuration
    DATE_REGEX: /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/\d{4}$/
};
