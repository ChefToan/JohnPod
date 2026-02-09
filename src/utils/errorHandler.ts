import { CommandInteraction, ButtonInteraction, BaseInteraction } from 'discord.js';

export enum ErrorType {
    DATABASE = 'DATABASE',
    API = 'API',
    VALIDATION = 'VALIDATION',
    PERMISSION = 'PERMISSION',
    TIMEOUT = 'TIMEOUT',
    UNKNOWN = 'UNKNOWN'
}

export interface ErrorContext {
    userId?: string;
    guildId?: string;
    channelId?: string;
    commandName?: string;
    action?: string;
    metadata?: Record<string, any>;
}

export class BotError extends Error {
    public readonly type: ErrorType;
    public readonly context: ErrorContext;
    public readonly timestamp: Date;
    public readonly isUserFacing: boolean;

    constructor(
        message: string,
        type: ErrorType = ErrorType.UNKNOWN,
        context: ErrorContext = {},
        isUserFacing = false
    ) {
        super(message);
        this.name = 'BotError';
        this.type = type;
        this.context = context;
        this.timestamp = new Date();
        this.isUserFacing = isUserFacing;
    }
}

export class ErrorHandler {
    private static instance: ErrorHandler;
    private errorCounts = new Map<string, number>();

    public static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    /**
     * Handle errors in command interactions
     */
    async handleCommandError(
        interaction: CommandInteraction | ButtonInteraction,
        error: any,
        context: Partial<ErrorContext> = {}
    ): Promise<void> {
        const enrichedContext: ErrorContext = {
            userId: interaction.user.id,
            guildId: interaction.guildId || undefined,
            channelId: interaction.channelId || undefined,
            commandName: 'commandName' in interaction ? interaction.commandName : 'button_interaction',
            ...context
        };

        const botError = this.transformError(error, enrichedContext);

        // Log the error
        this.logError(botError);

        // Send user-friendly message
        await this.sendUserError(interaction, botError);

        // Track error frequency
        this.trackError(botError);
    }

    /**
     * Handle general service errors
     */
    handleServiceError(
        error: any,
        serviceName: string,
        context: Partial<ErrorContext> = {}
    ): BotError {
        const enrichedContext: ErrorContext = {
            action: serviceName,
            ...context
        };

        const botError = this.transformError(error, enrichedContext);
        this.logError(botError);
        this.trackError(botError);

        return botError;
    }

    /**
     * Transform any error into a BotError
     */
    private transformError(error: any, context: ErrorContext): BotError {
        if (error instanceof BotError) {
            return error;
        }

        let type = ErrorType.UNKNOWN;
        let isUserFacing = false;
        let message = 'An unexpected error occurred';

        if (error.code === '23505') {
            type = ErrorType.DATABASE;
            message = 'A duplicate entry was detected';
            isUserFacing = true;
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            type = ErrorType.API;
            message = 'External service is currently unavailable';
            isUserFacing = true;
        } else if (error.name === 'ValidationError') {
            type = ErrorType.VALIDATION;
            message = error.message;
            isUserFacing = true;
        } else if (error.code === 50013) { // Discord permission error
            type = ErrorType.PERMISSION;
            message = 'Bot lacks necessary permissions';
            isUserFacing = true;
        } else if (error.name === 'TimeoutError') {
            type = ErrorType.TIMEOUT;
            message = 'Operation timed out';
            isUserFacing = true;
        } else if (error.message) {
            message = error.message;
        }

        return new BotError(message, type, context, isUserFacing);
    }

    /**
     * Log error with appropriate level
     */
    private logError(error: BotError): void {
        const logMessage = [
            `[${error.type}] ${error.message}`,
            `Context: ${JSON.stringify(error.context)}`,
            `Timestamp: ${error.timestamp.toISOString()}`
        ].join(' | ');

        switch (error.type) {
            case ErrorType.DATABASE:
            case ErrorType.API:
                console.error(`[ERROR] ${logMessage}`);
                break;
            case ErrorType.VALIDATION:
            case ErrorType.PERMISSION:
                console.warn(`[WARN] ${logMessage}`);
                break;
            case ErrorType.TIMEOUT:
                console.warn(`[TIMEOUT] ${logMessage}`);
                break;
            default:
                console.error(`[UNKNOWN] ${logMessage}`);
        }

        // In production, you might want to send to external logging service
        // this.sendToLoggingService(error);
    }

    /**
     * Send user-friendly error message
     */
    private async sendUserError(
        interaction: CommandInteraction | ButtonInteraction,
        error: BotError
    ): Promise<void> {
        let userMessage = 'There was an error processing your request.';

        if (error.isUserFacing) {
            userMessage = error.message;
        } else {
            switch (error.type) {
                case ErrorType.DATABASE:
                    userMessage = 'Database is temporarily unavailable. Please try again in a moment.';
                    break;
                case ErrorType.API:
                    userMessage = 'External services are currently down. Please try again later.';
                    break;
                case ErrorType.TIMEOUT:
                    userMessage = 'The operation took too long. Please try again.';
                    break;
                case ErrorType.PERMISSION:
                    userMessage = 'I don\'t have the necessary permissions to complete this action.';
                    break;
            }
        }

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: userMessage,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: userMessage,
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('Failed to send error message to user:', replyError);
        }
    }

    /**
     * Track error frequency for monitoring
     */
    private trackError(error: BotError): void {
        const key = `${error.type}:${error.context.commandName || 'unknown'}`;
        const count = this.errorCounts.get(key) || 0;
        this.errorCounts.set(key, count + 1);

        // Alert if error rate is high (simple threshold)
        if (count > 10) {
            console.warn(`High error rate detected for ${key}: ${count} errors`);
        }
    }

    /**
     * Get error statistics
     */
    getErrorStats(): Map<string, number> {
        return new Map(this.errorCounts);
    }

    /**
     * Clear error statistics
     */
    clearErrorStats(): void {
        this.errorCounts.clear();
    }

    /**
     * Create a validation error
     */
    static validation(message: string, context: ErrorContext = {}): BotError {
        return new BotError(message, ErrorType.VALIDATION, context, true);
    }

    /**
     * Create a database error
     */
    static database(message: string, context: ErrorContext = {}): BotError {
        return new BotError(message, ErrorType.DATABASE, context, false);
    }

    /**
     * Create an API error
     */
    static api(message: string, context: ErrorContext = {}): BotError {
        return new BotError(message, ErrorType.API, context, false);
    }

    /**
     * Create a permission error
     */
    static permission(message: string, context: ErrorContext = {}): BotError {
        return new BotError(message, ErrorType.PERMISSION, context, true);
    }
}

export const errorHandler = ErrorHandler.getInstance();
