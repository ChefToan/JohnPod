import { Client, TextChannel } from 'discord.js';
import { env } from '../utils/env';

export class WeeklyReportScheduler {
    private client: Client;
    private schedulerInterval?: NodeJS.Timeout;
    private checkInterval = 60 * 1000; // Check every minute

    constructor(client: Client) {
        this.client = client;
    }

    /**
     * Start the weekly report scheduler
     */
    start(): void {
        console.log('Weekly report scheduler started - will send messages on Sundays at 12pm and 9pm Arizona time');

        // Check immediately and then every minute
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
     * Check if it's time to send reports and send them
     */
    private async checkAndSendReports(): Promise<void> {
        try {
            if (this.shouldSendReport()) {
                console.log('[WeeklyReportScheduler] Sending weekly reports...');
                await this.sendWeeklyReports();
            }
        } catch (error) {
            console.error('[WeeklyReportScheduler] Error checking/sending reports:', error);
        }
    }

    /**
     * Check if we should send the weekly report right now
     * Returns true if it's Sunday at 12:00 PM or 9:00 PM Arizona time
     */
    private shouldSendReport(): boolean {
        const now = new Date();

        // Get current Arizona date/time
        const arizonaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Phoenix"}));
        const day = arizonaTime.getDay(); // 0 = Sunday
        const hour = arizonaTime.getHours();
        const minute = arizonaTime.getMinutes();


        // Only on Sundays
        if (day !== 0) return false;

        // Check if it's 12:00 PM (noon) or 9:00 PM
        const isNoon = hour === 12 && minute === 0;
        const isEvening = hour === 21 && minute === 0;

        return isNoon || isEvening;
    }

    /**
     * Send weekly reports to the configured channels
     */
    private async sendWeeklyReports(): Promise<void> {

        const now = new Date();
        const arizonaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Phoenix"}));
        const hour = arizonaTime.getHours();

        // Determine if this is the first (12 PM) or second (9 PM) message
        const messageNumber = hour === 12 ? '1/2' : '2/2';

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
            console.log(`Weekly report (${messageNumber}) sent to production server`);
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
