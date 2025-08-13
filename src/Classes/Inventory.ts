import CEconItem from "steamcommunity/classes/CEconItem";
import { logger } from "../../logger";
import { AbstractTaskProcessor, TaskItem, TaskProcessorConfig } from "./AbstractTaskQueue";
import { Bot } from "./Bot";
import { CustomError, ERR } from "./CustomError";
import { InventoryEvents } from "./Interfaces/Events";

interface InventoryTask {
    steamId: string;
}
export class Inventory extends AbstractTaskProcessor<InventoryTask, InventoryEvents>{
     constructor(bot: Bot,
        config: TaskProcessorConfig,
    ){
        super(bot, config);
    }

    override bindEvents(): void {
        
    }
    async processTask(task: TaskItem<InventoryTask>): Promise<void> {
        logger.info(`Processing inventory request for ${task.data.steamId} (${task.id})`);

        const inventory = await this.getInventory(task.data.steamId);

        logger.info(`Successfully retrieved inventory for ${task.data.steamId} (${task.id}): ${inventory.length} items`);
        this.emit("inventoryFetched", task.data.steamId, null, "ok", inventory, task.id);
    }

    async handleTaskError(task: TaskItem<InventoryTask>, error: any): Promise<void> {
        // Check if this is a retryable error and we haven't exceeded max retries
        if (this.shouldRetry(task, error)) {
            await this.retryTask(task, error);
            return;
        }

        // Final error handling - emit error event
        const errorMessage = error instanceof CustomError ? 
            {
                message: error.message,
                eresult: error.eresult,
            } : {
                message: error instanceof Error ? error.message : String(error),
            };

        logger.error(`Final error for inventory task ${task.id}:`, errorMessage);
        this.emit("inventoryFetched", task.data.steamId, errorMessage, 'error', [], task.id);
    }

    // Add the missing retry methods
    protected shouldRetry(task: TaskItem<InventoryTask>, error: any): boolean {
        return task.retries < (this.config.maxRetries || 3) && this.isRetryableError(error);
    }

    protected isRetryableError(error: any): boolean {
        return error instanceof CustomError && 
               error.eresult !== undefined &&
               [ERR.GeneralError].includes(error.eresult);
    }

    protected async retryTask(task: TaskItem<InventoryTask>, error: any): Promise<void> {
        task.retries++;
        
        const retryDelay = Math.min(2000 * Math.pow(2, task.retries), 30000);
        
        setTimeout(() => {
            this.queue.unshift(task); // Add back to front
            this.jobSet.add(task.id);
            if (!this.isProcessing()) {
                this.process();
            }
        }, retryDelay);

        this.emit('taskRetrying', task.id, task.retries, retryDelay);
        logger.warn(`Retrying inventory task ${task.id} in ${retryDelay}ms (attempt ${task.retries})`);
    }
    // createTaskId(taskData: InventoryTask): string {
    //     return `inv_${taskData.steamId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // }

    validateTask(taskData: InventoryTask): boolean {
        return typeof taskData.steamId === 'string' && 
               taskData.steamId.length > 0 &&
               /^\d{17}$/.test(taskData.steamId); // Valid Steam ID format
    }
    createTask(taskData: InventoryTask, taskId: string): TaskItem<InventoryTask> {
        return {
            data: taskData ,
            id: taskId,
            timestamp: Date.now(),
            retries: 0
        };
    }
    public getInventory(steamID: string): Promise<CEconItem[]> {
        return new Promise((resolve, reject) => {
            this.bot.tradeManager.getUserInventoryContents(steamID, 730, 2, false, (err, inventory) => {
                if (err) {
                    logger.warn("Inventory fetch error:", err);

                    if (err.message === "This profile is private.") {
                        return reject(new CustomError("This profile is private.", ERR.PrivateProfile));
                    }
                    else if (err.message.includes("RateLimitExceeded")) {
                        return reject(new CustomError(err.message, ERR.RateLimitExceeded));
                    }
                    else if (err.message.includes("HTTP error 429")) {
                        return reject(new CustomError("Rate limited by Steam", ERR.RateLimitExceeded));
                    }
                    else if (err.message.includes("HTTP error 503")) {
                        return reject(new CustomError("Steam service unavailable", ERR.GeneralError));
                    }
                    else if (err.message.includes("timeout")) {
                        return reject(new CustomError("Request timeout", ERR.GeneralError));
                    }
                    else {
                        return reject(new CustomError(err.message, ERR.GeneralError));
                    }
                }

                // Additional validation of the response
                if (!Array.isArray(inventory)) {
                    return reject(new CustomError("Invalid inventory response", ERR.GeneralError));
                }

                logger.debug(`Successfully fetched ${inventory.length} items for ${steamID}`);
                resolve(inventory);
            });
        });
    }
   
}