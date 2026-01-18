import { Client, Events, GatewayIntentBits, Collection } from 'discord.js';
import { env } from './utils/env';
import { errorHandler } from './utils/errorHandler';
import * as podrunCommand from './commands/food/podrunCommand';
import * as workCommand from './commands/roulette/workCommand';
import * as rouletteCommand from './commands/roulette/rouletteCommand';
import * as rouletteOddsCommand from './commands/roulette/rouletteOddsCommand';
import * as balanceCommand from './commands/roulette/balanceCommand';
import * as leaderboardCommand from './commands/roulette/leaderboardCommand';
import * as payCommand from './commands/roulette/payCommand';
import * as menuCommand from './commands/food/menuCommand';
import * as breakfastCommand from './commands/food/breakfastCommand';
import * as brunchCommand from './commands/food/brunchCommand';
import * as lunchCommand from './commands/food/lunchCommand';
import * as lightLunchCommand from './commands/food/lightLunchCommand';
import * as dinnerCommand from './commands/food/dinnerCommand';
import * as susCommand from './commands/susCommand';
import { REST, Routes } from 'discord.js';
import { db } from './services/database';
import { podrunService } from './services/podrunService';
import { diningEventService } from './services/diningEventService';
import { menuScheduler } from './services/menuScheduler';
import { WeeklyReportScheduler } from './services/WeeklyReportMessage';

// Environment variables are loaded and validated by env.ts

// Create a new client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Create weekly report scheduler
let weeklyReportScheduler: WeeklyReportScheduler;

// Global reference for testing (can be removed later)
declare global {
    var testScheduler: WeeklyReportScheduler | undefined;
}

// Extend the Client interface to include commands
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

// Create a collection for commands
client.commands = new Collection();

// Add commands to the collection
client.commands.set(podrunCommand.data.name, podrunCommand);
client.commands.set(workCommand.data.name, workCommand);
client.commands.set(rouletteCommand.data.name, rouletteCommand);
client.commands.set(rouletteOddsCommand.data.name, rouletteOddsCommand);
client.commands.set(balanceCommand.data.name, balanceCommand);
client.commands.set(leaderboardCommand.data.name, leaderboardCommand);
client.commands.set(payCommand.data.name, payCommand);
client.commands.set(menuCommand.data.name, menuCommand);
client.commands.set(breakfastCommand.data.name, breakfastCommand);
client.commands.set(brunchCommand.data.name, brunchCommand);
client.commands.set(lunchCommand.data.name, lunchCommand);
client.commands.set(lightLunchCommand.data.name, lightLunchCommand);
client.commands.set(dinnerCommand.data.name, dinnerCommand);
client.commands.set(susCommand.data.name, susCommand);


// When the client is ready, run this code
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Test database connection
    console.log('Testing database connection...');
    const isConnected = await db.testConnection();
    if (isConnected) {
        console.log('✅ Database connection successful');
    } else {
        console.warn('⚠️ Database connection failed - some features may not work');
    }

    // Clean up any old podruns on startup
    console.log('Cleaning up old podruns...');
    await podrunService.cleanupOldPodruns();
    console.log('✅ Old podruns cleaned up');

    // Clean up any expired dining events on startup
    console.log('Cleaning up expired dining events...');
    await diningEventService.cleanupExpiredEvents();
    console.log('✅ Expired dining events cleaned up');

    // Clean up expired cache entries on startup
    console.log('Cleaning up expired cache entries...');
    await db.cleanExpiredCache();
    console.log('✅ Expired cache entries cleaned up');

    // Start menu refresh scheduler
    console.log('Starting menu cache scheduler...');
    await menuScheduler.start();
    console.log('✅ Menu scheduler started and initial preload completed');

    // Initialize and start weekly report scheduler (if enabled)
    const enableWeeklyReports = env.getOptional('ENABLE_WEEKLY_REPORTS');
    if (enableWeeklyReports === 'true') {
        console.log('Starting weekly report scheduler...');
        weeklyReportScheduler = new WeeklyReportScheduler(client);
        weeklyReportScheduler.start();
        global.testScheduler = weeklyReportScheduler; // For manual testing
        console.log('✅ Weekly report scheduler started - will send messages on Sundays at 12pm and 9pm Arizona time');
    } else {
        console.log('⏸️ Weekly report scheduler is disabled (ENABLE_WEEKLY_REPORTS not set to "true")');
    }

});

// Handle interaction create events with comprehensive error handling
client.on(Events.InteractionCreate, async (interaction) => {
    // Handle slash commands
    if (interaction.isCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            await errorHandler.handleCommandError(interaction, error, {
                commandName: interaction.commandName
            });
        }
        return;
    }

    // Handle dropdown interactions for station selection
    if (interaction.isStringSelectMenu()) {
        try {
            // Station selection dropdowns are handled by the menu command collector
            // No global handling needed here
        } catch (error) {
            console.error('Error handling dropdown interaction:', error);
            await interaction.reply({ content: 'An error occurred processing this selection.', ephemeral: true });
        }
        return;
    }
});

// Function to register slash commands with better error handling
const registerCommands = async () => {
    const commands = [
        podrunCommand.data.toJSON(),
        workCommand.data.toJSON(),
        rouletteCommand.data.toJSON(),
        rouletteOddsCommand.data.toJSON(),
        balanceCommand.data.toJSON(),
        leaderboardCommand.data.toJSON(),
        payCommand.data.toJSON(),
        menuCommand.data.toJSON(),
        breakfastCommand.data.toJSON(),
        brunchCommand.data.toJSON(),
        lunchCommand.data.toJSON(),
        lightLunchCommand.data.toJSON(),
        dinnerCommand.data.toJSON(),
        susCommand.data.toJSON(),
    ];
    const rest = new REST({ version: '10' }).setToken(env.get('DISCORD_TOKEN'));

    try {
        console.log('Started refreshing application (/) commands.');

        try {
            await rest.put(
                Routes.applicationCommands(env.get('APPLICATION_ID')),
                { body: commands }
            );
            console.log('Successfully registered global commands.');
        } catch (globalError) {
            console.warn('Could not register global commands:', globalError);
            console.log('Will continue without command registration. Commands may need to be registered manually.');
        }
    } catch (error) {
        console.error('Error during command registration:', error);
        console.log('Continuing with bot startup despite registration issues...');
    }
};

// Start the bot with maximum error handling
const startBot = async () => {
    try {

        // Try to register commands but continue even if it fails
        await registerCommands().catch(error => {
            console.error('Command registration failed, but continuing:', error);
        });

        // Login to Discord
        return client.login(env.get('DISCORD_TOKEN')).catch(error => {
            console.error('Failed to login:', error);
            throw error;
        });
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
};

// Start the bot
startBot();

// Fix for graceful shutdown
let isShuttingDown = false;

// Improved shutdown function with timeout
async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return; // Prevent multiple shutdown attempts
    isShuttingDown = true;

    console.log(`${signal} received. Bot is shutting down...`);

    try {

        // Clean up any active podruns
        if (podrunCommand.cleanup) {
            podrunCommand.cleanup();
        }

        // Stop menu scheduler
        menuScheduler.stop();

        // Stop weekly report scheduler
        if (weeklyReportScheduler) {
            weeklyReportScheduler.stop();
        }

        // Set a timeout to force exit after 3 seconds
        const forceExitTimeout = setTimeout(() => {
            console.log('Forcing exit after timeout...');
            process.exit(0);
        }, 3000);

        // Make sure the timeout is unref'd so it doesn't keep the process alive
        forceExitTimeout.unref();

        // Clean up Discord client
        await client.destroy();
        // console.log('Discord client destroyed successfully.');

        // Exit normally
        process.kill(process.pid, 'SIGINT');
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
}

// Handle process signals properly
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle unhandled rejections and exceptions to prevent crashes
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    console.log('Bot will attempt to continue running...');
});