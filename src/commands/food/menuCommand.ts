import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ComponentType,
    ButtonInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { fetchMenu, organizeMenuByStation, getStationNames } from '../../utils/api';
import { DINING_HALLS, MENU_CONFIG } from '../../utils/config';
import { MenuResponse, MenuItem } from '../type/menu';
import {
    Period,
    parsePeriods,
    createPeriodButtons,
    createStationButtons,
    getDiningHallDisplayName,
    formatDateForDisplay,
    formatDateForAPI,
    formatMessage,
    createMainEmbed,
    createStationSelectionEmbed,
    createStationMenuEmbed
} from '../../utils/menuHelpers';

export const data = new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Get the dining hall menu')
    .addStringOption(option =>
        option.setName('dining_hall')
            .setDescription('The dining hall to get the menu for')
            .setRequired(true)
            .addChoices(...MENU_CONFIG.DINING_HALL_CHOICES)
    )
    .addStringOption(option =>
        option.setName('date')
            .setDescription('Date in MM/DD/YYYY format (default: today)')
            .setRequired(false)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        await interaction.deferReply();

        const diningHallOption = interaction.options.get('dining_hall')?.value as string;
        const diningHall = DINING_HALLS[diningHallOption as keyof typeof DINING_HALLS];
        const dateOption = interaction.options.get('date')?.value as string;

        // Format dates and dining hall display name
        const { formattedDate, displayDate } = formatDateForAPI(dateOption);
        const displayName = getDiningHallDisplayName(diningHallOption, diningHall.name);
        const formattedDisplayDate = formatDateForDisplay(displayDate);

        // Fetch initial menu data to get available periods
        const menuData = await fetchMenu({
            mode: 'Daily',
            locationId: diningHall.id,
            date: formattedDate,
            periodId: ""
        });

        if (!menuData.Menu?.MenuPeriods?.length) {
            const errorMsg = formatMessage(MENU_CONFIG.MESSAGES.NO_MENU_AVAILABLE, {
                diningHall: displayName,
                date: formattedDate
            });
            await interaction.editReply(errorMsg);
            return;
        }

        // Parse periods and create UI (no refresh button initially)
        const availablePeriods = parsePeriods(menuData.Menu.MenuPeriods);
        const mainEmbed = createMainEmbed(displayName, formattedDisplayDate);
        const periodButtons = createPeriodButtons(availablePeriods);

        await interaction.editReply({
            embeds: [mainEmbed],
            components: periodButtons
        });

        // Context is now embedded in the refresh button custom ID

        // Set up interaction handling for temporary buttons (period/station selection)
        await setupInteractionHandlers(
            interaction,
            diningHall,
            diningHallOption,
            formattedDate,
            displayName,
            formattedDisplayDate,
            availablePeriods,
            mainEmbed,
            periodButtons
        );

    } catch (error) {
        await handleError(interaction, error);
    }
}

// Set up interaction handlers for the menu command
export async function setupInteractionHandlers(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    diningHall: any,
    diningHallOption: string,
    formattedDate: string,
    displayName: string,
    formattedDisplayDate: string,
    availablePeriods: Period[],
    mainEmbed: any,
    periodButtons: any[]
) {
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
        time: MENU_CONFIG.INTERACTION_TIMEOUT
    });

    let currentPeriodId: string | null = null;
    let currentPeriodMenuData: MenuResponse | null = null;

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error: any) {
            // Handle expired interaction token (15 minute limit)
            if (error.code === 10062) {
                console.log('[MenuCommand] Interaction token expired, handling gracefully');
                // For expired tokens, we can't defer, but we can still process the interaction
                // The handler functions will need to use followUp or reply instead of editReply
            } else {
                console.error('[MenuCommand] Error deferring interaction:', error);
                return;
            }
        }

        // Handle button interactions
        if (componentInteraction.isButton()) {
            const buttonInteraction = componentInteraction;

            if (buttonInteraction.customId.startsWith('period_')) {
                await handlePeriodSelection(
                    buttonInteraction,
                    diningHall,
                    formattedDate,
                    displayName,
                    formattedDisplayDate,
                    availablePeriods,
                    currentPeriodId,
                    currentPeriodMenuData
                );
            } else if (buttonInteraction.customId.startsWith('station_')) {
                await handleStationButtonSelection(
                    buttonInteraction,
                    diningHall,
                    formattedDate,
                    displayName,
                    formattedDisplayDate,
                    availablePeriods,
                    currentPeriodId,
                    currentPeriodMenuData
                );
            } else if (buttonInteraction.customId === 'back_to_periods') {
                await buttonInteraction.editReply({
                    embeds: [mainEmbed],
                    components: periodButtons
                });
            }
        }

    });

    collector.on('end', () => {
        handleCollectorEnd(interaction);
    });
}

// Handle period selection
async function handlePeriodSelection(
    buttonInteraction: ButtonInteraction,
    diningHall: any,
    formattedDate: string,
    displayName: string,
    formattedDisplayDate: string,
    availablePeriods: Period[],
    currentPeriodId: string | null,
    currentPeriodMenuData: MenuResponse | null
) {
    const selectedPeriodId = buttonInteraction.customId.replace('period_', '');
    const selectedPeriod = availablePeriods.find(p => p.id === selectedPeriodId);

    if (!selectedPeriod) {
        await buttonInteraction.followUp({
            content: MENU_CONFIG.MESSAGES.PERIOD_UNAVAILABLE,
            ephemeral: true
        });
        return;
    }

    const periodMenuData = await fetchMenu({
        mode: 'Daily',
        locationId: diningHall.id,
        date: formattedDate,
        periodId: selectedPeriodId
    });

    if (!periodMenuData.Menu?.MenuStations || !periodMenuData.Menu?.MenuProducts) {
        const errorMsg = formatMessage(MENU_CONFIG.MESSAGES.NO_MENU_AVAILABLE, {
            diningHall: displayName,
            date: formattedDisplayDate
        });
        await buttonInteraction.followUp({
            content: errorMsg,
            ephemeral: true
        });
        return;
    }

    const stationMap = organizeMenuByStation(periodMenuData);
    const stationNames = getStationNames(periodMenuData);
    const nonEmptyStations = Array.from(stationNames.entries())
        .filter(([stationId]) => (stationMap.get(stationId) || []).length > 0);

    if (nonEmptyStations.length === 0) {
        const errorMsg = formatMessage(MENU_CONFIG.MESSAGES.NO_STATION_ITEMS, {
            diningHall: displayName,
            period: selectedPeriod.name,
            date: formattedDisplayDate
        });
        await buttonInteraction.followUp({
            content: errorMsg,
            ephemeral: true
        });
        return;
    }

    // Parse the date for time validation
    const [month, day, year] = formattedDate.split('/').map(num => parseInt(num, 10));
    const dateObj = new Date(year, month - 1, day);

    const stationSelectionEmbed = createStationSelectionEmbed(displayName, formattedDisplayDate, selectedPeriod, dateObj);

    // Create station buttons
    const stationButtons = createStationButtons(nonEmptyStations, selectedPeriodId);

    // Create back button only (no refresh during station selection)
    const navigationButtons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('back_to_periods')
                .setLabel('Back to Periods')
                .setStyle(ButtonStyle.Danger)
        );

    const allComponents = [...stationButtons, navigationButtons];

    await buttonInteraction.editReply({
        embeds: [stationSelectionEmbed],
        components: allComponents
    });
}

// Handle station button selection
async function handleStationButtonSelection(
    buttonInteraction: ButtonInteraction,
    diningHall: any,
    formattedDate: string,
    displayName: string,
    formattedDisplayDate: string,
    availablePeriods: Period[],
    currentPeriodId: string | null,
    currentPeriodMenuData: MenuResponse | null
) {
    // Parse station button custom ID: station_{periodId}_{stationId}
    const customIdParts = buttonInteraction.customId.split('_');
    if (customIdParts.length < 3) {
        await buttonInteraction.followUp({
            content: MENU_CONFIG.MESSAGES.INVALID_STATION_FORMAT,
            ephemeral: true
        });
        return;
    }

    const periodId = customIdParts[1];
    const stationId = customIdParts[2];

    const selectedPeriod = availablePeriods.find(p => p.id === periodId);
    if (!selectedPeriod) {
        await buttonInteraction.followUp({
            content: MENU_CONFIG.MESSAGES.PERIOD_UNAVAILABLE,
            ephemeral: true
        });
        return;
    }

    // Use cached data if we already have it for this period
    let menuData = currentPeriodMenuData;
    if (!menuData || currentPeriodId !== periodId) {
        menuData = await fetchMenu({
            mode: 'Daily',
            locationId: diningHall.id,
            date: formattedDate,
            periodId: periodId
        });
    }

    if (!menuData?.Menu?.MenuStations || !menuData?.Menu?.MenuProducts) {
        await buttonInteraction.followUp({
            content: MENU_CONFIG.MESSAGES.NO_STATION_ITEMS,
            ephemeral: true
        });
        return;
    }

    const stationMap = organizeMenuByStation(menuData);
    const stationNames = getStationNames(menuData);
    const stationName = stationNames.get(stationId) || 'Unknown Station';
    const stationItems = stationMap.get(stationId) || [];

    if (stationItems.length === 0) {
        await buttonInteraction.followUp({
            content: MENU_CONFIG.MESSAGES.STATION_UNAVAILABLE,
            ephemeral: true
        });
        return;
    }

    // Create station content string
    const stationContent = stationItems.map(item => `- ${item.MarketingName}`).join('\n');

    // Parse the date for time validation
    const [month, day, year] = formattedDate.split('/').map(num => parseInt(num, 10));
    const dateObj = new Date(year, month - 1, day);

    const stationMenuEmbed = createStationMenuEmbed(
        displayName,
        formattedDisplayDate,
        selectedPeriod,
        stationName,
        stationContent,
        dateObj
    );

    // Create station buttons with current station selected
    const nonEmptyStations = Array.from(stationNames.entries())
        .filter(([sId]) => (stationMap.get(sId) || []).length > 0);
    const stationButtons = createStationButtons(nonEmptyStations, periodId);

    // Create back button only (no refresh during station selection)
    const navigationButtons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('back_to_periods')
                .setLabel('Back to Periods')
                .setStyle(ButtonStyle.Danger)
        );

    const allComponents = [...stationButtons, navigationButtons];

    await buttonInteraction.editReply({
        embeds: [stationMenuEmbed],
        components: allComponents
    });
}

// Handle collector end
async function handleCollectorEnd(
    interaction: ChatInputCommandInteraction | ButtonInteraction
) {
    try {
        if (interaction.replied || interaction.deferred) {
            // Remove buttons when collector expires instead of deleting the message
            const message = await interaction.fetchReply();
            await message.edit({ components: [] }).catch(error => console.error('Error removing buttons:', error));
        }
    } catch (error) {
        console.error('Error in collector end handler:', error);
    }
}

// Error handling
async function handleError(interaction: ChatInputCommandInteraction, error: any) {
    console.error('Error in menu command:', error);

    const errorMessage = error.message === MENU_CONFIG.MESSAGES.INVALID_DATE_FORMAT 
        ? error.message 
        : MENU_CONFIG.MESSAGES.UNEXPECTED_ERROR;

    try {
        if (interaction.deferred) {
            await interaction.editReply(errorMessage);
        } else {
            await interaction.reply({
                content: errorMessage,
                ephemeral: true
            });
        }
    } catch (replyError) {
        console.error('Error sending error response:', replyError);
        try {
            await interaction.followUp({
                content: MENU_CONFIG.MESSAGES.PROCESSING_ERROR,
                ephemeral: true
            });
        } catch {
            console.error(MENU_CONFIG.MESSAGES.COMMUNICATION_ERROR);
        }
    }
}
