import { menuService } from './menuService';

export class MenuScheduler {
    private refreshInterval?: NodeJS.Timeout;
    private static readonly REFRESH_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

    /**
     * Start the scheduler. Preloads menus immediately on startup,
     * then refreshes at noon and midnight Arizona time.
     */
    async start(): Promise<void> {
        console.log('[MenuScheduler] Starting...');

        // Preload on startup
        try {
            await menuService.preloadMenus();
            console.log('[MenuScheduler] Initial preload completed');
        } catch (error) {
            console.error('[MenuScheduler] Initial preload failed:', error);
        }

        // Schedule next aligned refresh (noon or midnight Arizona time)
        const timeUntilNext = this.msUntilNextRefresh();
        console.log(`[MenuScheduler] Next refresh in ${Math.round(timeUntilNext / 1000 / 60)} minutes`);

        setTimeout(() => {
            menuService.preloadMenus();

            // Then repeat every 12 hours
            this.refreshInterval = setInterval(() => {
                menuService.preloadMenus();
            }, MenuScheduler.REFRESH_INTERVAL);
        }, timeUntilNext);
    }

    stop(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
        console.log('[MenuScheduler] Stopped');
    }

    /**
     * Milliseconds until the next noon or midnight in Arizona (UTC-7, no DST).
     */
    private msUntilNextRefresh(): number {
        const now = new Date();
        const arizonaDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
        const arizonaTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'America/Phoenix', hour12: false });

        const [year, month, day] = arizonaDateStr.split('-').map(Number);
        const [hour] = arizonaTimeStr.split(':').map(Number);

        let nextHour: number;
        let nextDay = day;
        let nextMonth = month;
        let nextYear = year;

        if (hour < 12) {
            nextHour = 12;
        } else {
            nextHour = 0;
            const tomorrow = new Date(year, month - 1, day + 1);
            nextYear = tomorrow.getFullYear();
            nextMonth = tomorrow.getMonth() + 1;
            nextDay = tomorrow.getDate();
        }

        // Arizona is always UTC-7
        const iso = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}T${String(nextHour).padStart(2, '0')}:00:00.000-07:00`;
        const ms = new Date(iso).getTime() - now.getTime();
        return Math.max(ms, 60000);
    }
}

export const menuScheduler = new MenuScheduler();
