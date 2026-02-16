import { Client, TextChannel } from 'discord.js';
import { env } from '../utils/env';

export class WeeklyReportScheduler {
    private client: Client;
    private schedulerInterval?: NodeJS.Timeout;
    private checkInterval = 30 * 1000; // Check every 30 seconds for reliability
    private lastSentKey: string | null = null; // Tracks last sent window to prevent duplicates

    constructor(client: Client) {
        this.client = client;
    }

    /**
     * Start the weekly report scheduler
     */
    start(): void {
        // Validate required env vars on startup so failures are visible immediately
        const productionRoleId = env.getOptional('PRODUCTION_CA_ROLE_ID');
        const productionServerId = env.getOptional('PRODUCTION_SERVER_ID');
        const productionChannelId = env.getOptional('PRODUCTION_CHANNEL_ID');
        const weeklyReportUrl = env.getOptional('WEEKLY_REPORT_SURVEY_URL');

        const missing: string[] = [];
        if (!productionRoleId) missing.push('PRODUCTION_CA_ROLE_ID');
        if (!productionServerId) missing.push('PRODUCTION_SERVER_ID');
        if (!productionChannelId) missing.push('PRODUCTION_CHANNEL_ID');
        if (!weeklyReportUrl) missing.push('WEEKLY_REPORT_SURVEY_URL');

        if (missing.length > 0) {
            console.warn(`[WeeklyReportScheduler] WARNING: Missing env vars required for weekly reports: ${missing.join(', ')}`);
            console.warn('[WeeklyReportScheduler] Weekly reports will NOT be sent until these are set in .env');
        }

        console.log('[WeeklyReportScheduler] Started - will send messages on Sundays at 6pm and 9pm Arizona time');

        // Check every 30 seconds for reliability
        this.checkAndSendReports();
        this.schedulerInterval = setInterval(() => {
            this.checkAndSendReports();
        }, this.checkInterval);
    }

    /**
     * Stop the scheduler
     */
    stop(): void {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = undefined;
        }
    }

    /**
     * Get current Arizona time components
     */
    private getArizonaTime(): { day: number; hour: number; minute: number; dateStr: string } {
        const now = new Date();
        // Use Intl to reliably extract Arizona time components
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Phoenix',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const parts = formatter.formatToParts(now);
        const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';

        const weekdayStr = get('weekday');
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const day = dayMap[weekdayStr] ?? -1;
        const hour = parseInt(get('hour'), 10);
        const minute = parseInt(get('minute'), 10);
        const dateStr = `${get('year')}-${get('month')}-${get('day')}`;

        return { day, hour, minute, dateStr };
    }

    /**
     * Check if it's time to send reports and send them
     */
    private async checkAndSendReports(): Promise<void> {
        try {
            const sendKey = this.shouldSendReport();
            if (sendKey) {
                console.log(`[WeeklyReportScheduler] Time matched! Sending weekly reports (key: ${sendKey})...`);
                await this.sendWeeklyReports();
                // Mark as sent AFTER successful send
                this.lastSentKey = sendKey;
                console.log(`[WeeklyReportScheduler] Weekly reports sent successfully.`);
            }
        } catch (error) {
            console.error('[WeeklyReportScheduler] Error checking/sending reports:', error);
        }
    }

    /**
     * Check if we should send the weekly report right now.
     * Returns a unique key string if it's time to send, or null otherwise.
     * Uses a 5-minute window to avoid missing the target due to timer drift,
     * and deduplicates using lastSentKey.
     */
    private shouldSendReport(): string | null {
        const { day, hour, minute, dateStr } = this.getArizonaTime();

        // Only on Sundays
        if (day !== 0) return null;

        // Check if we're within the first 5 minutes of 6 PM or 9 PM
        const isEvening1 = hour === 18 && minute < 5;
        const isEvening2 = hour === 21 && minute < 5;

        if (!isEvening1 && !isEvening2) return null;

        // Build a unique key for this send window (e.g., "2026-02-15-12")
        const sendKey = `${dateStr}-${hour}`;

        // Skip if we already sent for this window
        if (this.lastSentKey === sendKey) return null;

        return sendKey;
    }

    /**
     * Send weekly reports to the configured channels
     */
    private async sendWeeklyReports(): Promise<void> {
        const { hour } = this.getArizonaTime();

        // Determine if this is the first (6 PM) or second (9 PM) message
        const messageNumber = hour === 18 ? '1/2' : '2/2';

        // Get environment variables
        const productionRoleId = env.getOptional('PRODUCTION_CA_ROLE_ID');
        const productionServerId = env.getOptional('PRODUCTION_SERVER_ID');
        const productionChannelId = env.getOptional('PRODUCTION_CHANNEL_ID');
        const testRoleId = env.getOptional('TEST_CA_ROLE_ID');
        const testServerId = env.getOptional('TEST_SERVER_ID');
        const testChannelId = env.getOptional('TEST_CHANNEL_ID');
        const weeklyReportUrl = env.getOptional('WEEKLY_REPORT_SURVEY_URL');

        // Send to production server
        if (productionRoleId && productionServerId && productionChannelId && weeklyReportUrl) {
            const productionMessage = `<@&${productionRoleId}> Weekly Report Reminder! (${messageNumber})
Weekly Report Link: ${weeklyReportUrl}`;
            await this.sendToChannel(productionChannelId, productionServerId, productionMessage);
            console.log(`[WeeklyReportScheduler] Weekly report (${messageNumber}) sent to production server`);
        } else {
            console.warn('[WeeklyReportScheduler] Skipping production send - missing env vars (PRODUCTION_CA_ROLE_ID, PRODUCTION_SERVER_ID, PRODUCTION_CHANNEL_ID, or WEEKLY_REPORT_SURVEY_URL)');
        }

        // Also send to test server
        // COMMENTED OUT - Only send to production server
        /*
        if (!testRoleId || !testServerId || !testChannelId || !weeklyReportUrl) {
            return;
        }

        const testMessage = `<@&${testRoleId}> Weekly Report Reminder! (${messageNumber}) [TEST SERVER]
Weekly Report Link: ${weeklyReportUrl}`;

        await this.sendToChannel(testChannelId, testServerId, testMessage);
        */

    }


    /**
     * Send message to a specific channel
     */
    private async sendToChannel(channelId: string, guildId: string, message: string): Promise<void> {
        try {
            const guild = await this.client.guilds.fetch(guildId);
            if (!guild) {
                return;
            }

            const channel = await guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) {
                return;
            }

            await (channel as TextChannel).send(message);
        } catch (error) {
            console.error(`[WeeklyReportScheduler] Error sending message to channel ${channelId}:`, error);
        }
    }

    /**
     * Manually trigger a test message (sends to test server)
     */
    async sendTestMessage(): Promise<void> {

        // Get test server environment variables
        const testRoleId = env.getOptional('TEST_CA_ROLE_ID');
        const testServerId = env.getOptional('TEST_SERVER_ID');
        const testChannelId = env.getOptional('TEST_CHANNEL_ID');
        const weeklyReportUrl = env.getOptional('WEEKLY_REPORT_SURVEY_URL');

        // Send to test server only
        if (testRoleId && testServerId && testChannelId && weeklyReportUrl) {
            const testMessage = `<@&${testRoleId}> Weekly Report Reminder! (MANUAL TEST) [TEST SERVER]
Weekly Report Link: ${weeklyReportUrl}`;
            await this.sendToChannel(testChannelId, testServerId, testMessage);
        } else {
        }
    }

    /**
     * Force send a test message right now (for debugging)
     */
    async forceTestMessage(): Promise<void> {
        await this.sendWeeklyReports();
    }

    /**
     * Get next scheduled report time
     */
    getNextReportTimes(): { noon: Date, evening: Date } {
        const now = new Date();
        const nextSunday = new Date(now);

        // Find next Sunday
        const daysUntilSunday = (7 - now.getDay()) % 7;
        if (daysUntilSunday === 0) {
            // It's Sunday - check if we've passed both times
            const arizonaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Phoenix"}));
            const hour = arizonaTime.getHours();
            const minute = arizonaTime.getMinutes();

            if (hour > 21 || (hour === 21 && minute >= 0)) {
                // Past 9:00 PM, move to next Sunday
                nextSunday.setDate(now.getDate() + 7);
            }
        } else {
            nextSunday.setDate(now.getDate() + daysUntilSunday);
        }

        // Create times in Arizona timezone
        const arizonaDateStr = nextSunday.toLocaleDateString("en-CA", {timeZone: "America/Phoenix"});
        const [year, month, day] = arizonaDateStr.split('-').map(num => parseInt(num, 10));

        const noonTime = new Date(`${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T12:00:00.000-07:00`);
        const eveningTime = new Date(`${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T21:00:00.000-07:00`);

        return {
            noon: noonTime,
            evening: eveningTime
        };
    }

    /**
     * Check if scheduler is running
     */
    isRunning(): boolean {
        return this.schedulerInterval !== undefined;
    }
}
