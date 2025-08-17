import { Bot } from "./Bot";
import EventEmitter from "events";
import { logger } from "../../logger";
import { delay } from "../utils";
import * as files from "../lib/files";
import { PauseState, PauseType } from "../Handler/Handler";

export interface TaskQueueEvents {
  taskQueued: [taskId: string, queueSize: number];
  pause: [paused: boolean, reason: string | null, pauseEndTime?: number];
  taskCompleted: [taskId: string];
  taskFailed: [taskId: string, error: any];
  taskRetrying: [taskId: string, retryCount: number, retryDelay: number];
  taskCancelled: [taskId: string];
}
export type TaskQueueStatus =
  | "error"
  | "queued"
  | "retrying"
  | "bot_unavailable"
  | "service_paused";
export interface TaskQueueResponse {
  status: TaskQueueStatus;
  error?: {
    message: string;
    retry_after?: number;
  };
  message?: string;
  queue_position?: number;
  estimated_wait?: number;
  taskId?: string;
}

export interface TaskItem<Data = any> {
  id: string;
  timestamp: number;
  retries: number;
  pause?: PauseInfo
  data: Data;
}

export interface TaskProcessorConfig {
  maxQueueSize?: number;
  maxRetries?: number;
  delayBetweenTasks: number;
  defaultPauseDuration?: number;
  queueFilePath?: string;
  pauseType: PauseType; // Component type for pause state persistence
}

export interface PauseInfo {
  isPaused: boolean;
  pauseEndTime: number | null;
  pauseReason: string | null;
  pausedAt: number | null;
}

/**
 * Abstract base class for processing tasks in a queue with pause/resume functionality.
 *
 * @template T - The task type that extends TaskItem
 * @template K - The event type for task processor events
 *
 * @extends EventEmitter
 *
 * @example
 * ```typescript
 * class MyTaskProcessor extends AbstractTaskProcessor<MyTask, MyEventType> {
 *   processTask(task: MyTask): Promise<void> {
 *     // Implementation
 *   }
 *   // ... other required methods
 * }
 * ```
 */
export abstract class AbstractTaskProcessor<
  T,
  EventMap extends Record<string | symbol, any[]>
> extends EventEmitter {
  protected queue: (TaskItem<T>)[] = [];
  private processing = false;
  private _paused: boolean = false;
  protected pauseEndTime: number | null = null;
  protected pauseTimeoutId: NodeJS.Timeout | null = null;
  protected pauseReason: string | null = null;
  protected jobSet: Set<string> = new Set<string>();
  protected totalProcessed: number = 0;
  protected totalFailed: number = 0;
  protected lastProcessedAt: number = 0;
  // protected _config: TaskProcessorConfig;

  constructor(
    public readonly bot: Bot,
    protected readonly config: TaskProcessorConfig,
  ) {
    super();
    // Load pause state from file on initialization
    this.loadPauseState();
  }

  abstract processTask(task: TaskItem<T>): Promise<void>;
  abstract handleTaskError(task: TaskItem<T>, error: any): Promise<void>;
  abstract bindEvents(): void;
  abstract validateTask(taskData: T): boolean;
  abstract createTask(taskData: T, taskId: string): TaskItem<T>;

public override on<K extends keyof TaskQueueEvents | keyof EventMap | string | symbol>(
  event: K,
  listener: (...args: K extends keyof TaskQueueEvents
    ? TaskQueueEvents[K]
    : K extends keyof EventMap
    ? EventMap[K]
    : any[]) => void
): this {
  return super.on(event as string, listener);
}

public override emit<K extends keyof TaskQueueEvents | keyof EventMap | string | symbol>(
  event: K,
  ...args: K extends keyof TaskQueueEvents
    ? TaskQueueEvents[K]
    : K extends keyof EventMap
    ? EventMap[K]
    : any[]
): boolean {
  return super.emit(event as string, ...args);
}


public override off<K extends keyof TaskQueueEvents | keyof EventMap | string | symbol>(
  event: K,
  listener: (...args: K extends keyof TaskQueueEvents
    ? TaskQueueEvents[K]
    : K extends keyof EventMap
    ? EventMap[K]
    : any[]) => void
): this {
    return super.off(event as string, listener);
}


  // Common queue management
  public async enqueue(
    taskData: T,
    callback: (response: TaskQueueResponse) => void
  ): Promise<void> {
    if (!this.bot.ready) {
      return callback({
        status: "bot_unavailable",
        error: {
          message: `Bot is currently ready: ${this.bot.ready}`,
        },
      });
    }
    if(this.bot.isPaused){
      return callback({
        status: "service_paused",
        error: {
          message: `Bot is currently paused`,
        },
      });
    }
    // if (this._paused) {
    //   return callback({
    //     status: "service_paused",
    //     error: {
    //       message: `Service is paused: ${this.pauseReason}`,
    //     },
    //   });
    // }

    if (!this.validateTask(taskData)) {
      return callback({
        status: "error",
        error: {
          message: "Invalid task data",
        },
      });
    }

    const taskId = this.createTaskId(taskData);

    if (this.jobSet.has(taskId)) {
      logger.warn(`Task with id ${taskId} is already in the queue.`);
      return callback({
        status: "error",
        error: {
          message: `Task with id ${taskId} is already in the queue.`,
        },
      });
    }

    const task = this.createTask(taskData, taskId);

    // if (
    //   this._config.maxQueueSize &&
    //   this.queue.length >= this._config.maxQueueSize
    // ) {
    //   throw new Error("Queue is full");
    // }
    this.queue.push(task);
    this.jobSet.add(taskId);
 
    // Save queue state if file path is provided
    if (this.config.queueFilePath) {
      await this.saveQueueState();
    }
    if(this.isPaused()){
      const canResume = this.canResumeQueue();
      if(canResume){
        logger.info(`Resuming queue processing for task ${task.id}`);
        this.resume();
      }
      else{
        logger.info(`Queue cannot be resumed`);
      }

    }
   
    this.emit("taskQueued", taskId, this.queue.length);
    callback({
      status: "queued",
      message: "Request queued for processing",
      queue_position: this.queue.length,
      estimated_wait: this.estimateWaitTime(),
      taskId: task.id,
    });
    if (!this.processing && this.bot.ready && !this._paused && !this.bot.isPaused) {
      this.process();
    }
  }
  /**
   * Additional condition to skip task from queue
   * @param taskData 
   * @returns true if task should be skipped and requeued, false otherwise
   */
  requeueCondition(taskData: TaskItem<T>): boolean {
    return false; // Default implementation, can be overridden
  }

  private async requeueTask(task: TaskItem<T>):Promise<void>{
     if (this.queue.length === 0) {
      this.queue.push(task); // No other tasks, push at end
    } else {
      this.queue.splice(1, 0, task); // Insert at index 1
    }
    this.jobSet.add(task.id);
    if(this.config.queueFilePath){
      await this.saveQueueState();
    }
  }

  canResumeQueue(): boolean {
    if (!this.isPaused()) return true;
    // Implement your logic to determine if the queue can be resumed
    return false;
  }

  shouldPauseQueue(): {pause: boolean, reason?: string, time?: number} {
    return {
      pause: false,
      reason: undefined,
      time: undefined
    }

  }
  public async process(): Promise<void> {
    if (
      this.processing ||
      this.queue.length === 0 ||
      this._paused ||
      !this.bot.ready ||
      this.bot.isPaused
    ) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && !this._paused && this.bot.ready && !this.bot.isPaused) {
      const shouldPause = this.shouldPauseQueue();
      if (shouldPause.pause) {
        const pauseInfo = shouldPause;
        this.pause(pauseInfo.time || this.config.defaultPauseDuration || 0, pauseInfo.reason ?? null);
        break;
      }
      const task = this.queue.shift()!;
      this.jobSet.delete(task.id);

      if (this.config.queueFilePath) {
        await this.saveQueueState();
      }

      try {
        const shouldSkip = this.requeueCondition(task);
        if (shouldSkip) {
          logger.info(`Requeuing task ${task.id} due to requeue condition`);
          await this.requeueTask(task);
          continue; 
        }
        await this.processTask(task);
        this.lastProcessedAt = Date.now();
        this.totalProcessed++;
        this.emit("taskCompleted", task.id);
      } catch (err) {
        logger.debug(`Error processing task ${task.id}:`, err);
        await this.handleTaskError(task, err);
        this.totalFailed++;
        this.emit("taskFailed", task.id, err);
      }

      // Rate limiting delay
      if (this.queue.length > 0) {
        await delay(this.config.delayBetweenTasks);
      }
      
    }

    this.processing = false;
  }

  protected createTaskId(taskData?: T): string {
   
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  }

  // ============================================================================
  // PAUSE STATE PERSISTENCE
  // ============================================================================

  private async loadPauseState(): Promise<void> {
    try {
      const pauseState = await this.bot.handler.getPauseState(this.config.pauseType);
      
      // Restore pause state
      this._paused = pauseState.paused;
      this.pauseReason = pauseState.reason || null;
      this.pauseEndTime = pauseState.pauseEndTime || null;
      
      // If paused with end time, set up auto-resume
      if (this._paused && this.pauseEndTime) {
        const remainingTime = this.pauseEndTime - Date.now();
        if (remainingTime > 0) {
          this.pauseTimeoutId = setTimeout(() => {
            this.resume();
          }, remainingTime);
          logger.info(`${this.config.pauseType} queue restored paused state, resuming in ${Math.round(remainingTime / 1000)}s`);
        } else {
          // Pause time has already expired, resume immediately
          this._paused = false;
          this.pauseEndTime = null;
          this.pauseReason = null;
        }
      } else if (this._paused) {
        logger.info(`${this.config.pauseType} queue restored indefinite pause state: ${this.pauseReason}`);
      }
    } catch (err) {
      logger.debug(`No pause state found for ${this.config.pauseType} queue or error loading: ${err}`);
    }
  }

  private async savePauseState(): Promise<void> {
    try {
      // Create pause state object
      const pauseState: PauseState = {
        paused: this._paused,
        reason: this.pauseReason || undefined,
        pauseEndTime: this.pauseEndTime || undefined,
        timestamp: Date.now()
      };
      // Use Handler's method to save pause state
      await this.bot.handler.setPauseState(this.config.pauseType, pauseState);
      
    } catch (err) {
      logger.warn(`Failed to save pause state for ${this.config.pauseType}: ${err}`);
    }
  }
 
  public pause(pauseDuration: number, reason: string | null): void {
    if (this.pauseTimeoutId) {
      clearTimeout(this.pauseTimeoutId);
    }

    this._paused = true;
    this.pauseReason = reason;

    if (pauseDuration === 0) {
      // Indefinite pause
      this.pauseEndTime = null;
      this.emit("pause", true, reason);
    } else {
      this.pauseEndTime = Date.now() + pauseDuration;
      this.emit("pause", true, reason, this.pauseEndTime);
      
      this.pauseTimeoutId = setTimeout(() => {
        this.resume();
      }, pauseDuration);
    }

    // Save pause state to file
    this.savePauseState().catch(err => 
      logger.warn(`Failed to save pause state: ${err}`)
    );
  }

  public resume(): void {
    if(this.bot.isPaused || this.bot.ready === false){
      return;
    }
    if (this._paused && this.pauseTimeoutId) {
      clearTimeout(this.pauseTimeoutId);
    }

    this._paused = false;
    this.pauseEndTime = null;
    this.pauseTimeoutId = null;
    this.pauseReason = null;

    this.emit("pause", false, null);

    // Save resume state to file
    this.savePauseState().catch(err => 
      logger.warn(`Failed to save resume state: ${err}`)
    );

    if (!this.processing) {
      this.process();
    }
  }

  // Status and utility methods
  public size(): number {
    return this.queue.length;
  }

  public isPaused(): boolean {
    return this._paused;
  }

  public isProcessing(): boolean {
    return this.processing;
  }

  public getPauseTimeRemaining(): number {
    if (!this._paused || !this.pauseEndTime) {
      return 0;
    }
    return Math.max(0, this.pauseEndTime - Date.now());
  }

  public getPauseEndTime(): string | null {
    if (!this.pauseEndTime) {
      return null;
    }
    return new Date(this.pauseEndTime).toISOString();
  }

  public formatPauseTimeRemaining(): string {
    const remaining = this.getPauseTimeRemaining();
    if (remaining === 0) {
      return "Not paused";
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  public getStatus() {
    return {
      size: this.queue.length,
      processing: this.processing,
      paused: this._paused,
      pauseReason: this.pauseReason,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      pause_end_time: this.getPauseEndTime(),
      pause_time_remaining_ms: this.getPauseTimeRemaining(),
      pause_time_remaining_human: this.formatPauseTimeRemaining(),
      lastProcessedAt: this.lastProcessedAt,
      estimated_wait: this.queue.length * this.config.delayBetweenTasks,
    };
  }

  public cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.jobSet.delete(taskId);
      this.emit("taskCancelled", taskId);

      if (this.config.queueFilePath) {
        this.saveQueueState().catch((err) =>
          logger.error("Failed to save queue state after cancellation:", err)
        );
      }

      return true;
    }
    return false;
  }

  // Queue persistence
  protected async saveQueueState(): Promise<void> {
    if (this.config.queueFilePath) {
      await files
        .writeFile(this.config.queueFilePath, this.queue, true)
        .catch((err) => {
          logger.error("Failed to save queue state:", err);
        });
    }
  }
  private estimateWaitTime(): number {
    const queueLength = Math.max(0.1, this.queue.length - 1);
    return queueLength * this.config.delayBetweenTasks;
  }
  public async loadQueueState(): Promise<void> {
    if (this.config.queueFilePath) {
      try {
        const queueData = await files.readFile(this.config.queueFilePath, true);
        if (Array.isArray(queueData)) {
          this.queue = queueData;
          this.queue.forEach((task) => this.jobSet.add(task.id));
          logger.info(`Loaded ${this.queue.length} tasks from queue state`);
        }
      } catch (err) {
        logger.warn(`Failed to load queue state: ${err}`);
        this.queue = [];
      }
    }
  }

  // Retry logic
  //   protected shouldRetry(task: T, error: any): boolean {
  //     return (
  //       task.retries < (this._config.maxRetries || 3) &&
  //       this.isRetryableError(error)
  //     );
  //   }

  //   protected abstract isRetryableError(error: any): boolean;

  //   protected async retryTask(task: T, error: any): Promise<void> {
  //     task.retries++;

  //     const retryDelay = Math.min(1000 * Math.pow(2, task.retries), 30000);

  //     setTimeout(() => {
  //       this.queue.unshift(task); // Add back to front
  //       this.jobSet.add(task.id);
  //       if (!this.processing) {
  //         this.process();
  //       }
  //     }, retryDelay);

  //     this.emit("taskRetrying", task.id, task.retries, retryDelay);
  //     logger.warn(
  //       `Retrying task ${task.id} in ${retryDelay}ms (attempt ${task.retries})`
  //     );
  //   }

  // Cleanup
  public destroy(): void {
    if (this.pauseTimeoutId) {
      clearTimeout(this.pauseTimeoutId);
      this.pauseTimeoutId = null;
    }
    this.pauseEndTime = null;
    this._paused = false;
    this.processing = false;
    this.queue = [];
    this.jobSet.clear();
  }
}


