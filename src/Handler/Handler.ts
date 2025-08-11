import { Bot } from "../Classes/Bot";
import genPaths, { Paths } from "../resources/paths";
import { logger } from "../../logger";
import * as files from '../lib/files'
import TradeOfferManager from "steam-tradeoffer-manager";
import {   PollData } from "../Classes/Interfaces/PollData";
import DealDto from "../Classes/Dtos/DealDto";

export interface PauseState 
{
    paused: boolean;
    reason?: string;
    pauseEndTime?: number;
    timestamp: number; 
}

export type PauseType = 'bot' | 'trades' | 'inventory';

export interface Pause {
      bot: PauseState;
      trades?: PauseState;
      inventory?: PauseState;
}

export interface OnRun {
    loginAttempts?: number[];
    pollData?: PollData;
    dealQueue?: DealDto[];
    pauseStates?: Pause;
}

export class Handler {
    private paths: Paths;
    private poller: NodeJS.Timeout | null = null;
    private bot:Bot;

    constructor(bot: Bot) {
        this.paths = genPaths(bot.options.accountName);
        this.bot = bot
    }

    get getPaths(): Paths {
        return this.paths;
    }

    async onRun(): Promise<OnRun> {
        this.startPoller();
        
        const loginAttempts = await files.readFile(this.paths.files.loginAttempts, true);
        const pollData:PollData = await files.readFile(this.paths.files.pollData,true);
        const pauseStates = await this.getAllPauseStates();
        
        return { 
            loginAttempts: (loginAttempts && Array.isArray(loginAttempts)) ? loginAttempts as number[] : [],
            pollData: pollData ?? {},
            pauseStates
            // depositQueue: (depositQueue && Array.isArray(depositQueue)) ? depositQueue as DepositDto[] : [] 
        }
    }
    
    onShutdown(): void {
        this.stopPoller();
        
    }


    // refreshPollDataPath() {
    //     const newPaths = genPaths(this.bot.options.accountName);
    //     const pathChanged = newPaths.files.pollData !== this.paths.files.pollData;
    //     this.paths = newPaths;

    //     if (!pathChanged) {
    //         return;
    //     }

    //     files
    //         .readFile(this.paths.files.pollData, true)
    //         .then((pollDataFile: any | null) => {
    //             const currentPollData = this.bot.tradeManager.pollData;
    //             const activeOffers = this.bot.trades.getActiveOffers(currentPollData);
    //             const newPollData = pollDataFile
    //                 ? pollDataFile
    //                 : ({ sent: {}, received: {}, offerData: {} } as any);
    //             Object.keys(activeOffers).forEach(intent => {
    //                 (activeOffers[intent] as string[]).forEach(id => {
    //                     (newPollData[intent] as Record<string, number>)[id] = (
    //                         currentPollData[intent] as Record<string, number>
    //                     )[id];

    //                     newPollData.offerData[id] = currentPollData.offerData[id];
    //                 });
    //             });
    //             this.bot.tradeManager.pollData = newPollData;
    //             // TODO: Remove duplicate entries
    //             // Duplicates are already handled in src/lib/tools/polldata
    //             // so this is only for optimizing storage
    //         })
    //         .catch(err => {
    //             logger.error('Failed to update polldata path:', err);
    //         });
    // }
    async onPollData(pollData:PollData):Promise<void>{
        await files.writeFile(this.paths.files.pollData,pollData,true).catch(err => {
            logger.warn('Failed to save polldata: ', err);
        });
    }
    
    // async onDepositError(depositError: DepositErrorData): Promise<void> {
    //     const filePath = this.paths.files.depositError;
    
    //     // Read existing errors from the file
    //     files.readFile(filePath, true)
    //         .then(async existingData => {
    //             const errors: { [depositId: number]: DepositErrorData } = existingData || {};
    
    //             // Update or add the new error in the errors object
    //             errors[depositError.depositId] = depositError;
    
    //             // Write all errors back to the file
    //             await files.writeFile(filePath, errors ,true)
               
    //         })
    //         .catch(err => {
    //             logger.warn('Error processing deposit error data: ', err);
    //         });
    // }
    onRefreshToken(token: string): void {
        logger.info('New refresh key');
        files.writeFile(this.paths.files.refreshToken, token, false).catch(err => {
            logger.warn('Failed to save refresh token: ', err);
        });
    }
    onCookies(cookies: string[]): void{
        logger.info("New cookies")
        files.writeFile(this.paths.files.cookies, cookies, true).catch(err=> {
            logger.warn('Error saving cookies: ', err)
        })
    }
    onLoginAttempts(attempts: number[]): void {
        files.writeFile(this.paths.files.loginAttempts, attempts, true).catch(err => {
            logger.warn('Failed to save login attempts: ', err);
        });
    }
    onPauseBot(pause: boolean, reason: string | null, pauseEnd: number) {
        const pauseState: PauseState = {
            paused: pause,
            reason: reason || undefined,
            pauseEndTime: pauseEnd,
            timestamp: Date.now()
        };
        this.setPauseState('bot', pauseState);
    }
    async onPause(type: PauseType, pause: boolean, reason?: string, pauseEndTime?: number) {
        const pauseState: PauseState = {
            paused: pause,
            reason: reason || undefined,
            pauseEndTime,
            timestamp: Date.now()
        };
        await this.setPauseState(type, pauseState);
    }

    // ============================================================================
    // UNIFIED PAUSE STATE MANAGEMENT
    // ============================================================================

    async setPauseState(type: PauseType, pauseState: PauseState): Promise<void> {
        try {
            const pauseFilePath = this.paths.files.pauseState;
            
            // Load existing pause states
            let allPauseStates = await this.getAllPauseStates();
            
            // Update the specific pause type
            allPauseStates[type] = pauseState;
            
            await files.writeFile(pauseFilePath, allPauseStates, true);
            logger.info(`${type} pause state updated: ${JSON.stringify({
                paused: pauseState.paused,
                reason: pauseState.reason,
                endTime: pauseState.pauseEndTime ? new Date(pauseState.pauseEndTime).toISOString() : 'indefinite'
            })}`);
        } catch (err) {
            logger.warn(`Failed to save ${type} pause state: `, err);
        }
    }

    async getAllPauseStates(): Promise<Pause> {
        try {
            const pauseFilePath = this.paths.files.pauseState;
            const pauseStates = await files.readFile(pauseFilePath, true);
            
            if (this.isValidPauseStates(pauseStates)) {
                return pauseStates;
            }
        } catch (err) {
            logger.debug('No pause states file found or error reading, returning defaults');
        }
        
        // Return default state
        return {
            bot: {
                paused: false,
                timestamp: Date.now()
            }
        };
    }

    async getPauseState(type: PauseType): Promise<PauseState> {
        const allStates = await this.getAllPauseStates();
        return allStates[type] || {
            paused: false,
            timestamp: Date.now()
        };
    }

    private isValidPauseStates(states: any): states is Pause {
        return (
            typeof states === 'object' &&
            states !== null &&
            (typeof states.bot === 'undefined' || this.isValidPauseState(states.bot)) &&
            (typeof states.trades === 'undefined' || this.isValidPauseState(states.trades)) &&
            (typeof states.inventory === 'undefined' || this.isValidPauseState(states.inventory))
        );
    }

    private isValidPauseState(state: any): state is PauseState {
        return (
            typeof state === 'object' &&
            state !== null &&
            typeof state.paused === 'boolean' &&
            typeof state.timestamp === 'number' &&
            (typeof state.reason === 'undefined' || typeof state.reason === 'string') &&
            (typeof state.pauseEndTime === 'undefined' || typeof state.pauseEndTime === 'number')
        );
    }

    async pauseComponent(type: PauseType, reason?: string, pauseEndTime?: number): Promise<void> {
        const pauseState: PauseState = {
            paused: true,
            reason,
            pauseEndTime,
            timestamp: Date.now()
        };

        await this.setPauseState(type, pauseState);
        
        if (pauseEndTime && pauseEndTime > Date.now()) {
            logger.warn(`${type} paused for ${(pauseEndTime - Date.now()) / 60000} minutes until ${new Date(pauseEndTime).toISOString()}: ${reason}`);
        } else {
            logger.warn(`${type} paused indefinitely: ${reason}`);
        }
    }

    async resumeComponent(type: PauseType): Promise<void> {
        const pauseState: PauseState = {
            paused: false,
            timestamp: Date.now()
        };

        await this.setPauseState(type, pauseState);
        logger.info(`${type} resumed`);
    }

    async checkAndResolvePauseState(type: PauseType): Promise<boolean> {
        const pauseState = await this.getPauseState(type);
        
        if (pauseState.paused && pauseState.pauseEndTime) {
            const now = Date.now();
            
            // Check if pause has expired
            if (now >= pauseState.pauseEndTime) {
                await this.resumeComponent(type);
                logger.info(`${type} pause expired, automatically resumed`);
                return false; // Not paused anymore
            }
            
            return true; // Still paused
        }
        
        return pauseState.paused;
    }

    getPauseTimeRemaining(pauseState: PauseState): number {
        if (!pauseState.paused || !pauseState.pauseEndTime) {
            return 0;
        }
        return Math.max(0, pauseState.pauseEndTime - Date.now());
    }

    formatPauseTimeRemaining(pauseState: PauseState): string {
        const remaining = this.getPauseTimeRemaining(pauseState);
        if (remaining === 0) {
            return 'Not paused';
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // ============================================================================
    // STATUS UTILITIES
    // ============================================================================

    async getBotStatus() {
        const pauseState = await this.getPauseState('bot');
        const isCurrentlyPaused = await this.checkAndResolvePauseState('bot');
        
        return {
            ready: this.bot.ready,
            paused: isCurrentlyPaused,
            pauseInfo: pauseState.paused ? {
                reason: pauseState.reason,
                pausedAt: new Date(pauseState.timestamp).toISOString(),
                endTime: pauseState.pauseEndTime ? new Date(pauseState.pauseEndTime).toISOString() : null,
                timeRemaining: this.formatPauseTimeRemaining(pauseState),
                timeRemainingMs: this.getPauseTimeRemaining(pauseState)
            } : null,
            acceptingCommands: this.bot.ready && !isCurrentlyPaused
        };
    }

    async getComponentStatus(type: PauseType) {
        const pauseState = await this.getPauseState(type);
        const isCurrentlyPaused = await this.checkAndResolvePauseState(type);
        
        return {
            type,
            paused: isCurrentlyPaused,
            pauseInfo: pauseState.paused ? {
                reason: pauseState.reason,
                pausedAt: new Date(pauseState.timestamp).toISOString(),
                endTime: pauseState.pauseEndTime ? new Date(pauseState.pauseEndTime).toISOString() : null,
                timeRemaining: this.formatPauseTimeRemaining(pauseState),
                timeRemainingMs: this.getPauseTimeRemaining(pauseState)
            } : null
        };
    }

    async getAllComponentsStatus() {
        const allStates = await this.getAllPauseStates();
        const components: { [K in PauseType]: any } = {} as any;
        
        for (const type of ['bot', 'trades', 'inventory'] as PauseType[]) {
            components[type] = await this.getComponentStatus(type);
        }
        
        return components;
    }

    private startPoller(): void {
        if (this.poller === null) {
            this.poller = setInterval(async () => {
                try {
                    // Check if pause has expired for each component and auto-resume if needed
                    await this.checkAndResolvePauseState('bot');
                    await this.checkAndResolvePauseState('trades');
                    await this.checkAndResolvePauseState('inventory');
                    
                    // Add other polling logic here
                    // - Check file system health
                    // - Monitor queue status
                    // - Check bot connection status
                    
                } catch (err) {
                    logger.error('Error in poller:', err);
                }
            }, 5000); // Check every 5 seconds
            logger.debug('Poller started');
        }
    }

    stopPoller(): void {
        if (this.poller !== null) {
            clearInterval(this.poller);
            this.poller = null;
            logger.debug('Poller stopped');
        }
    }
}
