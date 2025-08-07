import CEconItem from "steamcommunity/classes/CEconItem";
import { Bot } from "./Bot";
import { assetid } from "steamcommunity";
import { CustomError, ERR } from "./CustomError";
import { logger } from "../../logger";
import { delay } from "../utils";
import config from "../../config";
import { InventoryEvents } from "./Interfaces/Events";
import  EventEmitter  from "events";
import { ExtendedEconItem, ExtendedMEconItemExchange } from "./Interfaces/ExtendedItem";

export type InventoryStatus = 'ok' | 'error' | 'queued' | 'retrying' | 'bot_unavailable' | 'service_paused';

export interface InventoryQueueResponse {
    status: InventoryStatus;
    error?: {
        message: string,
        retry_after?: number,
    };
    message?: string;
    queue_position?: number;
    estimated_wait?: number;
    inventory?: CEconItem[];
}

interface InventoryTask {
        id: string;
        steamId: string;
        timestamp: number;
        retries: number;
}
export default class Inventory extends EventEmitter{
    //public queue: Queue<SteamID|string> = new Queue<SteamID|string>
    private queue: InventoryTask[] = [];
    private processing = false;
    private _inventoryFetchPaused: boolean = false;
    private pauseEndTime: number | null = null;
    private pauseTimeoutId: NodeJS.Timeout | null = null;
    constructor(public readonly bot:Bot){
        super()
    }
    
    public override on<K extends keyof InventoryEvents>(event: K, listener: (...args: InventoryEvents[K]) => void): this {
        return super.on(event, listener);
    }
    public override emit<K extends keyof InventoryEvents>(event: K, ...args: InventoryEvents[K]): boolean {
        return super.emit(event, ...args);
    }
    // Enhanced enqueue with better error handling
    async enqueue(steamId: string, callback: (response: InventoryQueueResponse) => void): Promise<void> {
        // Check bot status first
        if (!this.bot.ready) {
            return callback({
                status: 'bot_unavailable',
                error: {
                    message: `Bot is currently ready: ${this.bot.ready}`,
                }
            });
        }

        // Check if paused
        if (this._inventoryFetchPaused || this.bot.isPaused) {
            return callback({
                status: 'service_paused',
                error: {
                    message: 'Inventory service is temporarily paused',
                    retry_after: this.getResumeTime() ?? undefined
                }
            });
        }

        // Check queue capacity
        // if (this.queue.length >= config.inventory.maxQueueSize) {
        //     return callback({
        //         status: 'queue_full',
        //         error: {
        //             message: 'Inventory request queue is full, try again later',
        //             queue_size: this.queue.length
        //         }
        //     }, []);
        // }

        const task: InventoryTask = {
            //temp ID generation, can be replaced with a more robust ID system
            id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            steamId,
            timestamp: Date.now(),
            retries: 0
        };

        this.queue.push(task);
        
        // Immediate feedback
        callback({
            status: 'queued',
            message: 'Request queued for processing',
            queue_position: this.queue.length,
            estimated_wait: this.estimateWaitTime()
        });

        this.process();
    }

    async process(): Promise<void> {
        if (this.processing || this.queue.length === 0 || this._inventoryFetchPaused) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0 && !this._inventoryFetchPaused) {
            const task = this.queue.shift()!;
            
            try {
                await this.processInventoryTask(task);
            } catch (err) {
                logger.error(`Error processing inventory task ${task.id}:`, err);
                await this.handleTaskError(task, err);
            }

            // Rate limiting delay
            if (this.queue.length > 0) {
                await delay(config.inventory.delayBetweenReq);
            }
        }

        this.processing = false;
    }

    private async processInventoryTask(task: InventoryTask): Promise<void> {
        try {
            logger.info(`Processing inventory request for ${task.steamId} (${task.id})`);
            
            const inv = await this.getInventory(task.steamId);
            this.emit("inventoryFetched", task.steamId, null, 'ok', inv, task.id);
            // task.callback({
            //     status: 'success',
            //     steamId: task.steamId,
            //     taskId: task.id,
            //     processed_at: Date.now()
            // }, inv);

        } catch (err) {
            await this.handleTaskError(task, err);
        }
    }

    private async handleTaskError(task: InventoryTask, err: any): Promise<void> {
        const isRetryableError = err instanceof CustomError && err.eresult !== undefined && 
            [ERR.RateLimitExceeded, ERR.GeneralError].includes(err.eresult);

        // if (isRetryableError && task.retries < config.inventory.maxRetries) {
        //     task.retries++;
            
        //     if (err.eresult === ERR.RateLimitExceeded) {
        //         // Pause service and requeue task
        //         this.pause(config.rates.limitExceeded, "Rate limit exceeded");
        //         this.queue.unshift(task); // Put back at front
        //         return;
        //     }

        //     // Exponential backoff for other retryable errors
        //     const delay = Math.min(1000 * Math.pow(2, task.retries), 30000);
        //     setTimeout(() => {
        //         this.queue.unshift(task);
        //         this.process();
        //     }, delay);
        //     // task.callback({
        //     //     status: 'retrying',
        //     //     error: err.message,
        //     //     retry_attempt: task.retries,
        //     //     retry_delay: delay
        //     // });
            
        //     return;
        // }
        const errorMessage = err instanceof CustomError ? 
            {
                message:err.message,
                eresult: err.eresult,
            } : {
                message: err instanceof Error ? err.message : String(err),
            }
        this.emit("inventoryFetched", task.steamId, errorMessage, 'error', [], task.id);
        // Final error response
        // task.callback({
        //     status: 'error',
        //     error: {
        //         message: err.message || 'Unknown error',
        //         eresult: err.eresult,
        //         retries_attempted: task.retries,
        //         taskId: task.id
        //     }
        // }, []);
    }

    private estimateWaitTime(): number {
        return this.queue.length * config.inventory.delayBetweenReq;
    }

   

    size() {
        return this.queue.length;
    }

   
   pause(pauseDuration: number, cause: string) {
        // Clear any existing pause timeout
        if (this.pauseTimeoutId) {
            clearTimeout(this.pauseTimeoutId);
        }

        this._inventoryFetchPaused = true;
        this.pauseEndTime = Date.now() + pauseDuration;
        
        // this.emit("pause", true, cause, this.pauseEndTime);
        logger.warn(`Pausing bot requests for: ${pauseDuration/60000} min (until ${new Date(this.pauseEndTime).toISOString()})`);
        
        this.pauseTimeoutId = setTimeout(() => {
            this._inventoryFetchPaused = false;
            this.pauseEndTime = null;
            this.pauseTimeoutId = null;
            // this.emit("pause", false, null, 0);
            logger.info('Inventory service resumed');
            this.process();
        }, pauseDuration);
    }

    // Method to manually resume (cancel pause early)
    resume(): void {
        if (this._inventoryFetchPaused && this.pauseTimeoutId) {
            clearTimeout(this.pauseTimeoutId);
            this._inventoryFetchPaused = false;
            this.pauseEndTime = null;
            this.pauseTimeoutId = null;
            // this.emit("pause", false, null, 0);
            logger.info('Inventory service manually resumed');
            this.process();
        }
    }

    // Get remaining pause time in milliseconds
    getPauseTimeRemaining(): number {
        if (!this._inventoryFetchPaused || !this.pauseEndTime) {
            return 0;
        }
        return Math.max(0, this.pauseEndTime - Date.now());
    }

    // Get pause end time as ISO string
    getPauseEndTime(): string | null {
        if (!this.pauseEndTime) {
            return null;
        }
        return new Date(this.pauseEndTime).toISOString();
    }

    // Enhanced getResumeTime method
    private getResumeTime(): number | null {
        return this.pauseEndTime;
    }

    // Enhanced status methods with pause information
    getQueueStatus() {
        return {
            size: this.queue.length,
            processing: this.processing,
            paused: this._inventoryFetchPaused,
            pause_end_time: this.getPauseEndTime(),
            pause_time_remaining_ms: this.getPauseTimeRemaining(),
            pause_time_remaining_human: this.formatPauseTimeRemaining(),
            estimated_wait: this.estimateWaitTime()
        };
    }

    // Helper method to format remaining time in human-readable format
    private formatPauseTimeRemaining(): string {
        const remaining = this.getPauseTimeRemaining();
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
    public getFilteredInventory(itemsAsset: assetid[], items:CEconItem[]){
        return items.filter(item=> {
            return itemsAsset.some(i=>{
                return(item.assetid.toString() === i.toString())
            })
        })
    }
    private removeDuplicates(items: CEconItem[]): CEconItem[] {
        const seen = new Set<string|number>();
        return items.filter(item => {
            const duplicate = seen.has(item.assetid);
            seen.add(item.assetid);
            return !duplicate;
        });
    }
    public getInventory(steamID: string):Promise<CEconItem[]>{
        return new Promise((resolve, reject)=> {
            this.bot.tradeManager.getUserInventoryContents(steamID,730,2,false, (err, inventory)=> {
                if(err){
                    if(err.message === "This profile is private."){
                        return reject(new CustomError("This profile is private.",ERR.PrivateProfile))
                    }
                    else if(err.message.includes("RateLimitExceeded")){
                        return reject(new CustomError(err.message, ERR.RateLimitExceeded))
                    }
                    else{
                        return reject(new CustomError(err.message, ERR.GeneralError))
                    }
                }
                resolve(inventory)
              
            })
        })
    }

    public getMyInventory(): Promise<ExtendedEconItem[]>{
        return new Promise((resolve,reject)=>{
            this.bot.tradeManager.getInventoryContents(730,2,false, (err, inventory) => {
                if(err){
                   
                    if(err.message.includes("RateLimitExceeded")){
                        return reject(new CustomError(err.message, ERR.RateLimitExceeded))
                    }
                    else{
                        return reject(new CustomError(err.message, ERR.GeneralError))
                    }
                }
                const gameInventory = this.bot.csClient.inventory
                const extendedInv = inventory as ExtendedEconItem[]
                extendedInv.forEach(item=>{
                    gameInventory?.forEach(gi=>{
                        if(item.assetid == gi.id){
                            item.paint_index = gi.paint_index,
                            item.paint_seed = gi.paint_seed,
                            item.paint_wear = gi.paint_wear,
                            item.tradable_after = gi.tradable_after,
                            item.stickers = gi.stickers
                        }
                    
                    })
                })
                resolve(inventory)
            })
        })
    }
}