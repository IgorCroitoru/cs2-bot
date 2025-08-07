import { Bot } from "../Classes/Bot";
import genPaths, { Paths } from "../resources/paths";
import { logger } from "../../logger";
import * as files from '../lib/files'
import TradeOfferManager from "steam-tradeoffer-manager";
import {   PollData } from "../Classes/Interfaces/PollData";
import DealDto from "../Classes/Dtos/DealDto";

export interface PauseState {
    isPaused: boolean;
    pauseEndTime: number | null;
    pauseReason: string | null;
    pausedAt: number | null;
}

export interface OnRun {
    loginAttempts?: number[];
    pollData?: PollData;
    dealQueue?: DealDto[];
    pauseState?: PauseState;
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
        const pauseState:PauseState = await files.readFile(this.paths.files.pauseState, true);
        
        return { 
            loginAttempts: (loginAttempts && Array.isArray(loginAttempts)) ? loginAttempts as number[] : [],
            pollData: pollData ?? {},
            pauseState: pauseState ?? {
                isPaused: false,
                pauseEndTime: null,
                pauseReason: null,
                pausedAt: null
            }
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

    // ============================================================================
    // PAUSE STATE MANAGEMENT
    // ============================================================================

    async onPauseStateChange(pauseState: PauseState): Promise<void> {
        try {
            await files.writeFile(this.paths.files.pauseState, pauseState, true);
            logger.info('Pause state saved:', {
                isPaused: pauseState.isPaused,
                reason: pauseState.pauseReason,
                endTime: pauseState.pauseEndTime ? new Date(pauseState.pauseEndTime).toISOString() : null
            });
        } catch (err) {
            logger.warn('Failed to save pause state: ', err);
        }
    }

    async pauseBot(pauseDuration: number, reason: string): Promise<void> {
        const pauseState: PauseState = {
            isPaused: true,
            pauseEndTime: Date.now() + pauseDuration,
            pauseReason: reason,
            pausedAt: Date.now()
        };

        await this.onPauseStateChange(pauseState);
        logger.warn(`Bot paused for ${pauseDuration/60000} minutes until ${new Date(pauseState.pauseEndTime!).toISOString()}: ${reason}`);
    }

    async resumeBot(): Promise<void> {
        const pauseState: PauseState = {
            isPaused: false,
            pauseEndTime: null,
            pauseReason: null,
            pausedAt: null
        };

        await this.onPauseStateChange(pauseState);
        logger.info('Bot resumed');
    }

    async getPauseState(): Promise<PauseState> {
        try {
            const pauseState = await files.readFile(this.paths.files.pauseState, true);
            return pauseState ?? {
                isPaused: false,
                pauseEndTime: null,
                pauseReason: null,
                pausedAt: null
            };
        } catch (err) {
            logger.warn('Failed to read pause state, assuming not paused: ', err);
            return {
                isPaused: false,
                pauseEndTime: null,
                pauseReason: null,
                pausedAt: null
            };
        }
    }

    async checkAndResolvePauseState(): Promise<boolean> {
        const pauseState = await this.getPauseState();
        
        if (pauseState.isPaused && pauseState.pauseEndTime) {
            const now = Date.now();
            
            // Check if pause has expired
            if (now >= pauseState.pauseEndTime) {
                await this.resumeBot();
                logger.info('Pause expired, bot automatically resumed');
                return false; // Not paused anymore
            }
            
            return true; // Still paused
        }
        
        return pauseState.isPaused;
    }

    getPauseTimeRemaining(pauseState: PauseState): number {
        if (!pauseState.isPaused || !pauseState.pauseEndTime) {
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
        const pauseState = await this.getPauseState();
        const isCurrentlyPaused = await this.checkAndResolvePauseState();
        
        return {
            ready: this.bot.ready,
            paused: isCurrentlyPaused,
            pauseInfo: pauseState.isPaused ? {
                reason: pauseState.pauseReason,
                pausedAt: pauseState.pausedAt ? new Date(pauseState.pausedAt).toISOString() : null,
                endTime: pauseState.pauseEndTime ? new Date(pauseState.pauseEndTime).toISOString() : null,
                timeRemaining: this.formatPauseTimeRemaining(pauseState),
                timeRemainingMs: this.getPauseTimeRemaining(pauseState)
            } : null,
            acceptingCommands: this.bot.ready && !isCurrentlyPaused
        };
    }

    private startPoller(): void {
        if (this.poller === null) {
            this.poller = setInterval(async () => {
                try {
                    // Check if pause has expired and auto-resume if needed
                    await this.checkAndResolvePauseState();
                    
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
