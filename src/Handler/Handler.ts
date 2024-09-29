import { Bot } from "../Classes/Bot";
import genPaths, { Paths } from "../resources/paths";
import { logger } from "../../logger";
import * as files from '../lib/files'
import TradeOfferManager from "steam-tradeoffer-manager";
import {   PollData } from "../Classes/Interfaces/PollData";
import DealDto from "../Classes/Dtos/DealDto";
export interface OnRun {
    loginAttempts?: number[];
    pollData?: PollData;
    dealQueue?: DealDto[]
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
        const pollData:PollData = await files.readFile(this.paths.files.pollData,true)
        // const depositQueue:DepositDto[] = await files.readFile(this.paths.files.depositQueue,true)
        return { 
            loginAttempts: (loginAttempts && Array.isArray(loginAttempts)) ? loginAttempts as number[] : [],
            pollData: pollData ?? {},
            // depositQueue: (depositQueue && Array.isArray(depositQueue)) ? depositQueue as DepositDto[] : [] 
        }
    }
    
    // onPollData(pollData: any): void {
    //     files.writeFile(this.paths.files.pollData, pollData, true).catch(err => {
    //         logger.warn('Failed to save polldata: ', err);
    //     });
    // }


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
        await files.waitForWriting()
        await files.writeFile(this.paths.files.pollData,pollData,true)
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

    private startPoller(): void {
        if (this.poller === null) {
            this.poller = setInterval(() => {
                // Polling logic here
            }, 1000);
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
