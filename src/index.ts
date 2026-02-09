import { Client, Events, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { env } from './utils/env';
import { errorHandler } from './utils/errorHandler';
import * as menuCommand from './commands/food/menuCommand';
import * as susCommand from './commands/susCommand';
import { menuScheduler } from './services/menuScheduler';
import { WeeklyReportScheduler } from './services/WeeklyReportMessage';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

let weeklyReportScheduler: WeeklyReportScheduler;

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

client.commands = new Collection();
client.commands.set(menuCommand.data.name, menuCommand);
client.commands.set(susCommand.data.name, susCommand);

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    console.log('Starting menu scheduler...');
    await menuScheduler.start();
    console.log('Menu scheduler started');

    const enableWeeklyReports = env.getOptional('ENABLE_WEEKLY_REPORTS');
    if (enableWeeklyReports === 'true') {
        console.log('Starting weekly report scheduler...');
        weeklyReportScheduler = new WeeklyReportScheduler(client);
        weeklyReportScheduler.start();
        console.log('Weekly report scheduler started');
    } else {
        console.log('Weekly report scheduler is disabled (ENABLE_WEEKLY_REPORTS not set to "true")');
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
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
    }
});

const registerCommands = async () => {
    const commands = [
        menuCommand.data.toJSON(),
        susCommand.data.toJSON(),
    ];
    const rest = new REST({ version: '10' }).setToken(env.get('DISCORD_TOKEN'));

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(env.get('APPLICATION_ID')),
            { body: commands }
        );
        console.log('Successfully registered global commands.');
    } catch (error) {
        console.error('Error during command registration:', error);
    }
};

const startBot = async () => {
    try {
        await registerCommands().catch(error => {
            console.error('Command registration failed, but continuing:', error);
        });

        return client.login(env.get('DISCORD_TOKEN')).catch(error => {
            console.error('Failed to login:', error);
            throw error;
        });
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
};

startBot();

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`${signal} received. Bot is shutting down...`);

    try {
        menuScheduler.stop();

        if (weeklyReportScheduler) {
            weeklyReportScheduler.stop();
        }

        const forceExitTimeout = setTimeout(() => {
            console.log('Forcing exit after timeout...');
            process.exit(0);
        }, 3000);
        forceExitTimeout.unref();

        await client.destroy();
        process.kill(process.pid, 'SIGINT');
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    console.log('Bot will attempt to continue running...');
});