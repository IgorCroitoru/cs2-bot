import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import { logger } from "../../logger";
import {
  AbstractTaskProcessor,
  TaskItem,
  TaskProcessorConfig,
} from "./AbstractTaskQueue";
import { Bot } from "./Bot";
import DealDto from "./Dtos/DealDto";
import { TradeEvents } from "./Interfaces/Events";
import { OfferData, PollData } from "./Interfaces/PollData";
import { CustomError, ERR } from "./CustomError";
import { delay, exponentialBackoff } from "../utils";
import TradeOfferManager, {
  EResult,
  ETradeOfferState,
} from "steam-tradeoffer-manager";
import { assetid } from "steamcommunity";
import CEconItem from "steamcommunity/classes/CEconItem";
import config from "../../config";
import timersPromises from "timers/promises";
import Deal from "./Deal";
import * as files from "../lib/files";
import path from "path";

export enum EPauseReason {
  /**
   * Offer limit exceeded for the bot
   */
  OFFER_LIMIT_EXCEEDED = "OFFER_LIMIT_EXCEEDED",
  /**
   * User limit exceeded for the bot
   */
  USER_LIMIT_EXCEEDED = "USER_LIMIT_EXCEEDED",
  /**
   * Today total trade limit exceeded for the bot
   */
  DAILY_TRADE_LIMIT_EXCEEDED = "DAILY_TRADE_LIMIT_EXCEEDED",
  /**
   * Rate limit exceeded for the bot
   */
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
}
export type PauseReasonKeys = keyof typeof EPauseReason;

export class NewTrades extends AbstractTaskProcessor<DealDto, TradeEvents> {
  private declineQueue: TradeOffer[] = [];
  private isProcessingDeclines = false;
  protected override pauseReason: EPauseReason | null = null;
  // private _dealError: {[dealId: number]: DealErrorData} = {};
  private _pauseConfig: {
    totalTradeLimit: number;
    userTradeLimit: number;
    userPauseDuration: number;
  } = {
    totalTradeLimit: 30,
    userTradeLimit: 5,
    userPauseDuration: 60000, // 1 minute
  };
  // private _pausedUsers: Set<string> = new Set(); // Users who have hit the 5 trade limit

  constructor(bot: Bot, config: TaskProcessorConfig) {
    super(bot, config);
    this.loadPauseConfig();
    // this.loadPausedUsers();
  }

  override bindEvents(): void {
    // Listen for offer state changes to resume processing when offers complete
    this.bot.tradeManager.on("realTimeTradeCompleted", (offer) => {
      logger.info(
        `Offer #${offer.id} status ${offer.state} completed, checking if trades can resume...`
      );
    });
    this.bot.tradeManager.on("realTimeTradeConfirmationRequired", (offer) => {
      logger.info(
        `Offer #${offer.id} requires confirmation, pausing trade processing...`
      );
    });
    this.bot.tradeManager.on("sentOfferChanged", (offer, oldState) => {
      if (this.isOfferFinished(offer.state)) {
        // An offer reached final state, check if we should resume
        if (
          this._paused &&
          (this.pauseReason === EPauseReason.OFFER_LIMIT_EXCEEDED ||
            this.pauseReason === EPauseReason.USER_LIMIT_EXCEEDED)
        ) {
          logger.info(
            `Offer #${offer.id} reached final state (${offer.state}), checking if trades can resume...`
          );
          this.checkAndResumeFromOfferLimit();
        }
      }
    });
  }
  public override shouldPause(task: TaskItem<DealDto>): {
    pause: boolean;
    reason?: string;
    time?: number;
  } {
    const activeOffers = this.getActiveOffers(
      this.bot.tradeManager.pollData as PollData
    );

    const totalActiveCount =
      Object.keys(activeOffers.sent).length +
      Object.keys(activeOffers.received).length;

    if (totalActiveCount >= this._pauseConfig.totalTradeLimit) {
      return {
        pause: true,
        reason: EPauseReason.OFFER_LIMIT_EXCEEDED,
        time: this._pauseConfig.userPauseDuration,
      };
    }
    const usersOffersCount = new Map<string, number>();
    let everyGotFive = true;

    for (const offer of Object.values(activeOffers.sent)) {
      const userId = offer.partnerId;
      if (userId) {
        usersOffersCount.set(userId, (usersOffersCount.get(userId) || 0) + 1);
      }
    }
    for (const [userId, count] of usersOffersCount.entries()) {
      if (count < this._pauseConfig.userTradeLimit) {
        everyGotFive = false;
        break;
      }
    }
    if (everyGotFive) {
      return { pause: true, reason: EPauseReason.USER_LIMIT_EXCEEDED, time: 0 };
    }

    return { pause: false };
  }

  public override requeueCondition(taskData: TaskItem<DealDto>): boolean {
    const activeOffers = this.getActiveOffers(
      this.bot.tradeManager.pollData as PollData
    );
    const userActiveCount = [
      ...Object.values(activeOffers.sent),
      ...Object.values(activeOffers.received),
    ].filter((offer) => offer.partnerId === taskData.data.userId64).length;
    return userActiveCount >= this._pauseConfig.userTradeLimit;
  }
  // Check if we can resume from offer limit pause
  private async checkAndResumeFromOfferLimit(): Promise<void> {
    try {
      const activeOffers = this.getActiveOffers(
        this.bot.tradeManager.pollData as PollData
      );
      const activeCount =
        Object.keys(activeOffers.sent).length +
        Object.keys(activeOffers.received).length;
      const limit = this._pauseConfig.totalTradeLimit;
      const usersOffersCount = new Map<string, number>();
      // Check if we can resume based on pause reason
      if (this.pauseReason === EPauseReason.OFFER_LIMIT_EXCEEDED) {
        if (activeCount < limit) {
          logger.info(
            `Active trades: ${activeCount}/${limit} - resuming trade processing`
          );
          this.resume();
        } else {
          logger.debug(
            `Still at total limit: ${activeCount}/${limit} active trades`
          );
        }
      } else if (this.pauseReason === EPauseReason.USER_LIMIT_EXCEEDED) {
        [
          ...Object.values(activeOffers.sent),
          ...Object.values(activeOffers.received),
        ].forEach((offer) => {
          const userId = offer.partnerId;
          if (userId) {
            usersOffersCount.set(
              userId,
              (usersOffersCount.get(userId) || 0) + 1
            );
          }
        });
        let everyGotFive = true;
        for (const [userId, count] of usersOffersCount.entries()) {
          if (count < this._pauseConfig.userTradeLimit) {
            everyGotFive = false;
            break;
          }
        }
        if (!everyGotFive) {
          logger.debug(
            `Not all users have reached their trade limit - resuming to process other users`
          );
          this.resume();
        }
      }
    } catch (error) {
      logger.error("Error checking active trades count:", error);
    }
  }

  // Get current active trades count, optionally for a specific user
  async requestActiveOffersCount(userId?: string): Promise<number> {
    return new Promise((resolve) => {
      this.bot.tradeManager.getOffers(1, (err, sent, received) => {
        if (err) {
          logger.error("Error getting active trades count:", err);
          resolve(30); // Assume full limit on error to be safe
          return;
        }

        // Count offers that are active or awaiting confirmation
        const activeOffers = sent.filter(
          (offer) => offer.state === 2 || offer.state === 9 // Active or CreatedNeedsConfirmation
        );

        if (userId) {
          // Count trades with specific user
          const userActiveCount = activeOffers.filter(
            (offer) => offer.partner.getSteamID64() === userId
          ).length;
          resolve(userActiveCount);
        } else {
          // Return total active trades
          resolve(activeOffers.length);
        }
      });
    });
  }

  // Check if we can send an offer (not at user limit or total limit)
  // async canSendOffer(userId: string): Promise<{
  //   canSend: boolean;
  //   reason?: EPauseReason;
  //   totalTrades?: number;
  //   userTrades?: number;
  // }> {
  //   const activeOffers = this.getActiveOffers(
  //     this.bot.tradeManager.pollData as PollData
  //   );
  //   const totalActiveCount =
  //     Object.keys(activeOffers.sent).length +
  //     Object.keys(activeOffers.received).length;
  //   const userActiveCount = [
  //     Object.values(activeOffers.sent),
  //     ...Object.values(activeOffers.received).filter(
  //       (offer) => offer.partnerId === userId
  //     ),
  //   ].length;

  //   const totalLimit = this._pauseConfig.totalTradeLimit;
  //   const userLimit = this._pauseConfig.userTradeLimit;

  //   if (totalActiveCount >= totalLimit) {
  //     return {
  //       canSend: false,
  //       reason: EPauseReason.OFFER_LIMIT_EXCEEDED,
  //       totalTrades: totalActiveCount,
  //       userTrades: userActiveCount,
  //     };
  //   }

  //   if (userActiveCount >= userLimit) {
  //     return {
  //       canSend: false,
  //       reason: EPauseReason.USER_LIMIT_EXCEEDED,
  //       totalTrades: totalActiveCount,
  //       userTrades: userActiveCount,
  //     };
  //   }

  //   return {
  //     canSend: true,
  //     totalTrades: totalActiveCount,
  //     userTrades: userActiveCount,
  //   };
  // }

  // // Getter for dealError
  // get dealError(): {[dealId: number]: DealErrorData} {
  //   return this._dealError;
  // }

  // // Setter for dealError with automatic file saving
  // set dealError(errors: {[dealId: number]: DealErrorData}) {
  //   this._dealError = errors;
  //   // Don't await here to avoid blocking, but log errors
  //   this.saveDealErrors().catch(err => {
  //     logger.error('Failed to save deal errors after setter:', err);
  //   });
  // }

  // // Method to add a single deal error
  // async addDealError(dealId: number, errorData: DealErrorData): Promise<void> {
  //   this._dealError[dealId] = errorData;
  //   await this.saveDealErrors();
  // }

  // // Method to remove a deal error
  // async removeDealError(dealId: number): Promise<boolean> {
  //   if (this._dealError.hasOwnProperty(dealId)) {
  //     delete this._dealError[dealId];
  //     await this.saveDealErrors();
  //     return true;
  //   }
  //   return false;
  // }

  // // Method to clear all deal errors
  // async clearDealErrors(): Promise<void> {
  //   this._dealError = {};
  //   await this.saveDealErrors();
  // }

  // // Method to load deal errors from file
  // async loadDealErrors(): Promise<void> {
  //   try {
  //     const filePath = this.bot.handler.getPaths.files.dealError;
  //     const dataDealsError = await files.readFile(filePath, true);
  //     this._dealError = this.isValidDealErrorData(dataDealsError)
  //       ? (dataDealsError as { [dealId: number]: DealErrorData })
  //       : {};
  //     logger.debug(`Loaded ${Object.keys(this._dealError).length} deal errors from file`);
  //   } catch (error) {
  //     logger.error('Failed to load deal errors from file:', error);
  //     this._dealError = {};
  //   }
  // }

  // Load pause configuration from file
  async loadPauseConfig(): Promise<void> {
    try {
      const filePath = path.join(
        this.bot.handler.getPaths.files.dir,
        "pauseConfig.json"
      );
      const configData = await files.readFile(filePath, true);
      if (this.isValidPauseConfig(configData)) {
        this._pauseConfig = { ...this._pauseConfig, ...configData };
      }
      logger.debug(`Loaded pause config:`, this._pauseConfig);
    } catch (error) {
      logger.debug("Using default pause config (file not found or invalid)");
    }
  }

  // Save pause configuration to file
  async savePauseConfig(): Promise<void> {
    try {
      const filePath = path.join(
        this.bot.handler.getPaths.files.dir,
        "pauseConfig.json"
      );
      await files.writeFile(filePath, this._pauseConfig, true);
    } catch (error) {
      logger.error("Failed to save pause config:", error);
    }
  }

  // Load paused users from file
  // async loadPausedUsers(): Promise<void> {
  //   try {
  //     const filePath = path.join(
  //       this.bot.handler.getPaths.files.dir,
  //       "pausedUsers.json"
  //     );
  //     const usersData = await files.readFile(filePath, true);
  //     if (Array.isArray(usersData)) {
  //       this._pausedUsers = new Set(usersData);
  //     }
  //     logger.debug(`Loaded ${this._pausedUsers.size} paused users`);
  //   } catch (error) {
  //     logger.debug("No paused users file found, starting with empty set");
  //     this._pausedUsers = new Set();
  //   }
  // }

  // // Save paused users to file
  // async savePausedUsers(): Promise<void> {
  //   try {
  //     const filePath = path.join(
  //       this.bot.handler.getPaths.files.dir,
  //       "pausedUsers.json"
  //     );
  //     await files.writeFile(filePath, Array.from(this._pausedUsers), true);
  //   } catch (error) {
  //     logger.error("Failed to save paused users:", error);
  //   }
  // }

  // // Add user to paused list
  // async addPausedUser(userId: string): Promise<void> {
  //   this._pausedUsers.add(userId);
  //   await this.savePausedUsers();
  //   logger.info(`Added user ${userId} to paused users list`);
  // }

  // // Remove user from paused list
  // async removePausedUser(userId: string): Promise<boolean> {
  //   const removed = this._pausedUsers.delete(userId);
  //   if (removed) {
  //     await this.savePausedUsers();
  //     logger.info(`Removed user ${userId} from paused users list`);
  //   }
  //   return removed;
  // }

  // // Check if user is paused
  // isUserPaused(userId: string): boolean {
  //   return this._pausedUsers.has(userId);
  // }

  // Validate pause config structure
  private isValidPauseConfig(config: any): boolean {
    return (
      typeof config === "object" &&
      config !== null &&
      (typeof config.totalTradeLimit === "undefined" ||
        typeof config.totalTradeLimit === "number") &&
      (typeof config.userTradeLimit === "undefined" ||
        typeof config.userTradeLimit === "number") &&
      (typeof config.userPauseDuration === "undefined" ||
        typeof config.userPauseDuration === "number")
    );
  }

  async processTask(task: TaskItem<DealDto>): Promise<void> {
    logger.info(`Processing deal ${task.id} (${task.id})`);

    // // Check if we can send an offer to this user (user limit and total limit)
    // const canSend = await this.canSendOffer(task.data.userId64);
    // if (!canSend.canSend) {

    // }

    const uniqReceive = task.data.items_to_receive
      ? this.removeDuplicates(task.data.items_to_receive)
      : [];
    const uniqGive = task.data.items_to_give
      ? this.removeDuplicates(task.data.items_to_give)
      : [];

    let offer: TradeOffer;
    try {
      offer = await this.createOffer(task.data.tradeUrl, uniqGive, uniqReceive);
    } catch (err) {
      const dealSt = new Deal(task.data.id, undefined);
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("offerCreation", error, dealSt);
      throw error; // Let the abstract class handle the error
    }

    // Send the offer with retry logic
    await new Promise<void>((resolve, reject) => {
      this.sendOfferRetry(offer, 0, (err, status) => {
        const dealSt = new Deal(task.data.id, offer.id);

        if (err) {
          this.emit("offerCreation", err, dealSt);
          reject(err);
        } else {
          this.emit("offerCreation", null, dealSt, offer);
          offer.data("partnerId", task.data.userId64);
          offer.data("dealId", task.id);
          logger.info(
            `Successfully processed deal ${task.id}, offer #${offer.id} created`
          );
          resolve();
        }
      });
    });
  }

  async handleTaskError(task: TaskItem<DealDto>, error: any): Promise<void> {
    // Check if this is a retryable error and we haven't exceeded max retries
    if (this.shouldRetry(task, error)) {
      await this.retryTask(task, error);
      return;
    }

    // Emit final error event
    const dealSt = new Deal(task.data.id, undefined);
    this.emit(
      "offerCreation",
      error instanceof Error ? error : new Error(String(error)),
      dealSt
    );
  }

  validateTask(taskData: DealDto): boolean {
    return (
      typeof taskData.id === "number" &&
      typeof taskData.tradeUrl === "string" &&
      taskData.tradeUrl.length > 0 &&
      typeof taskData.userId64 === "string" &&
      /^\d{17}$/.test(taskData.userId64) && // Valid Steam ID format
      Array.isArray(taskData.items_to_give || []) &&
      Array.isArray(taskData.items_to_receive || [])
    );
  }

  createTask(taskData: DealDto, taskId: string): TaskItem<DealDto> {
    // Create a task item that satisfies both interfaces
    const taskItem: TaskItem<DealDto> = {
      data: { ...taskData }, // Include all DealDto properties
      id: taskId, // Override id with string taskId
      timestamp: Date.now(),
      retries: 0,
    };

    return taskItem as unknown as TaskItem<DealDto>;
  }

  // Add retry logic methods
  protected shouldRetry(task: TaskItem<DealDto>, error: any): boolean {
    return (
      task.retries < (this.config.maxRetries || 3) &&
      this.isRetryableError(error)
    );
  }

  protected isRetryableError(error: any): boolean {
    if (!(error instanceof CustomError)) return false;

    // Don't retry these permanent errors
    const nonRetryableErrors = [
      ERR.BadTradeUrl,
      ERR.Escrow,
      ERR.TradeBan,
      ERR.TargetCannotTrade,
      ERR.AccessDenied,
      ERR.InvalidItems,
    ];
    const retryableErrors = [ERR.ItemServerUnavailable];
    return (
      error.eresult !== undefined &&
      !nonRetryableErrors.includes(error.eresult) &&
      (error.eresult === ERR.GeneralError ||
        retryableErrors.includes(error.eresult))
    );
  }

  protected async retryTask(
    task: TaskItem<DealDto>,
    error: any
  ): Promise<void> {
    task.retries++;

    const retryDelay = Math.min(1000 * Math.pow(2, task.retries), 30000);

    setTimeout(() => {
      this.queue.unshift(task); // Add back to front
      this.jobSet.add(task.id);
      if (!this.processing) {
        this.process();
      }
    }, retryDelay);

    this.emit("taskRetrying", task.id, task.retries, retryDelay);
    logger.warn(
      `Retrying deal ${task.id} in ${retryDelay}ms (attempt ${task.retries})`
    );
  }

  // Enhanced status with trade limit information
  public async getDetailedStatus() {
    const baseStatus = this.getStatus();
    const activeTrades = this.getActiveOffers(
      this.bot.tradeManager.pollData as PollData
    );
    const activeCount =
      Object.keys(activeTrades.sent).length +
      Object.keys(activeTrades.received).length;

    return {
      ...baseStatus,
      active_trades: activeCount,
      trade_limit: this._pauseConfig.totalTradeLimit,
      user_trade_limit: this._pauseConfig.userTradeLimit,
      user_pause_duration: this._pauseConfig.userPauseDuration,
      trades_available: this._pauseConfig.totalTradeLimit - activeCount,
    };
  }

  // Manually check if we should resume from offer limit (useful for debugging)
  public async forceCheckOfferLimit(): Promise<boolean> {
    if (
      this._paused &&
      this.pauseReason === EPauseReason.OFFER_LIMIT_EXCEEDED
    ) {
      await this.checkAndResumeFromOfferLimit();
      return !this._paused; // Return true if we resumed
    }
    return false; // Not paused for offer limit
  }

  // Configuration getters and setters
  get pauseConfig() {
    return { ...this._pauseConfig };
  }

  async setPauseConfig(
    config: Partial<typeof this._pauseConfig>
  ): Promise<void> {
    this._pauseConfig = { ...this._pauseConfig, ...config };
    await this.savePauseConfig();
    logger.info("Updated pause configuration:", this._pauseConfig);
  }

  // get pausedUsers(): string[] {
  //   return Array.from(this._pausedUsers);
  // }

  // // Clear all paused users
  // async clearPausedUsers(): Promise<void> {
  //   this._pausedUsers.clear();
  //   await this.savePausedUsers();
  //   logger.info("Cleared all paused users");
  // }

  // // Check if we have any tasks for non-paused users (useful for queue optimization)
  // hasProcessableTasksInQueue(): boolean {
  //   return this.queue.some((task) => !this.isUserPaused(task.data.userId64));
  // }

  // // Get tasks for paused users in current queue
  // getPausedUserTasks(): TaskItem<DealDto>[] {
  //   return this.queue.filter((task) => this.isUserPaused(task.data.userId64));
  // }

  // // Get tasks for non-paused users in current queue
  // getProcessableUserTasks(): TaskItem<DealDto>[] {
  //   return this.queue.filter((task) => !this.isUserPaused(task.data.userId64));
  // }

  // // Save deal errors to file
  // private async saveDealErrors(): Promise<void> {
  //   try {
  //     const filePath = this.bot.handler.getPaths.files.dealError;
  //     await files.writeFile(filePath, this._dealError, true);
  //   } catch (error) {
  //     logger.error('Failed to save deal errors:', error);
  //     throw error;
  //   }
  // }

  // isValidDealErrorData(
  //   dealError: any
  // ): dealError is { [dealId: number]: DealErrorData } {
  //   if (typeof dealError !== "object" || dealError === null) {
  //     return false;
  //   }

  //   for (const key in dealError) {
  //     if (Object.prototype.hasOwnProperty.call(dealError, key)) {
  //       const dealId = Number(key);

  //       // Check if the key is a valid number
  //       if (isNaN(dealId)) {
  //         return false;
  //       }

  //       const errorData = dealError[dealId];

  //       if (
  //         typeof errorData !== "object" ||
  //         typeof errorData.dealId !== "number" ||
  //         typeof errorData.error === "undefined" || // `error` can be of any type
  //         typeof errorData.timestamp !== "number"
  //       ) {
  //         return false;
  //       }
  //     }
  //   }

  //   return true;
  // }
  public async declineOfferManually(offer: TradeOffer) {
    await delay(config.offer.delayBetweenOfferDecline);
    offer.decline((err) => {
      if (err) {
        logger.error(`Error declining incoming offer #${offer.id}: `, err);
      } else {
        logger.info(`Successfully declined offer #${offer.id}`);
      }
    });
  }
  public queueOfferDecline(offer: TradeOffer): void {
    if (this.declineQueue.includes(offer)) {
      logger.warn(`Offer #${offer.id} is already in the decline queue`);
      return;
    }
    this.declineQueue.push(offer);

    // Start processing if not already running
    if (!this.isProcessingDeclines) {
      this.processDeclineQueue();
    }
  }

  private async processDeclineQueue(): Promise<void> {
    if (this.isProcessingDeclines || this.declineQueue.length === 0) {
      return;
    }

    this.isProcessingDeclines = true;
    logger.info(
      `Starting to process ${this.declineQueue.length} offer declines`
    );

    while (this.declineQueue.length > 0) {
      const offer = this.declineQueue.shift();
      if (offer) {
        try {
          await this.declineOfferSequential(offer);
        } catch (error) {
          logger.error(`Failed to decline offer #${offer.id}:`, error);
        }

        // Delay between each decline
        if (this.declineQueue.length > 0) {
          await delay(config.offer.delayBetweenOfferDecline);
        }
      }
    }

    this.isProcessingDeclines = false;
    logger.info("Finished processing decline queue");
  }

  private async declineOfferSequential(offer: TradeOffer): Promise<void> {
    return new Promise((resolve, reject) => {
      offer.decline((err) => {
        if (err) {
          logger.error(`Error declining incoming offer #${offer.id}:`, err);
          reject(err);
        } else {
          logger.info(`Successfully declined offer #${offer.id}`);
          resolve();
        }
      });
    });
  }

  public getFilteredInventory(itemsAsset: assetid[], items: CEconItem[]) {
    return items.filter((item) => {
      return itemsAsset.some((i) => {
        return item.assetid.toString() === i.toString();
      });
    });
  }
  private removeDuplicates(items: CEconItem[]): CEconItem[] {
    const seen = new Set<string | number>();
    return items.filter((item) => {
      const duplicate = seen.has(item.assetid);
      seen.add(item.assetid);
      return !duplicate;
    });
  }

  public async createOffer(
    tradeUrl: string,
    items_to_give?: CEconItem[],
    items_to_receive?: CEconItem[]
  ): Promise<TradeOffer> {
    try {
      const offer = this.bot.tradeManager.createOffer(tradeUrl);
      offer.addTheirItems(items_to_receive ?? []);
      offer.addMyItems(items_to_give ?? []);
      const userDetails = await new Promise<{
        me: TradeOffer.UserDetails;
        them: TradeOffer.UserDetails;
      }>((resolve, reject) => {
        offer.getUserDetails((err, me, them) => {
          if (err) {
            if (
              err.message.includes(
                "This Trade URL is no longer valid for sending a trade offer to"
              )
            ) {
              return reject(new CustomError("Bad trade url", ERR.BadTradeUrl));
            }

            reject(err);
          } else {
            resolve({ me, them });
          }
        });
      });

      if (
        userDetails.me.escrowDays > 0 ||
        (userDetails.them.escrowDays > 0 && config.offer.rejectEscrow)
      ) {
        throw new CustomError("Items with escrow not accepted", ERR.Escrow);
      }

      if (!userDetails.them) {
        throw new CustomError("Bad trade url", ERR.BadTradeUrl);
      }

      return offer;
    } catch (error) {
      throw error;
    }
  }

  isItemAssetArray(items: any[]): items is assetid[] {
    return (
      (items.length > 0 && typeof items[0] === "number") ||
      typeof items[0] === "string"
    );
  }

  sendOfferRetry(
    offer: TradeOffer,
    attempts = 0,
    callback: (err: Error | null, status?: "sent" | "pending") => void
  ): void {
    offer.send((err, status) => {
      attempts++;

      if (err) {
        if (
          attempts > config.offer.maxRetries ||
          err.message.includes("can only be sent to friends") ||
          err.message.includes("is not available to trade") ||
          err.message.includes("maximum number of items allowed in inventory")
        ) {
          if (err.cause === "ItemServerUnavailable") {
            return callback(
              new CustomError(
                "Items server not available",
                ERR.ItemServerUnavailable
              )
            );
          }
          return callback(err);
        }
        if (err.cause === "TradeBan") {
          return callback(new CustomError("User trade banned", ERR.TradeBan));
        }
        if (err.cause === "OfferLimitExceeded") {
          // Pause trades processing until an offer completes

          const offers = this.getActiveOffers(
            this.bot.tradeManager.pollData as PollData
          );
          const activeCount =
            Object.keys(offers.sent).length +
            Object.keys(offers.received).length;
          const userCount = [
            ...Object.values(offers.sent),
            ...Object.values(offers.received),
          ].length;
          if (activeCount >= this._pauseConfig.totalTradeLimit) {
            logger.warn(
              "Offer limit exceeded - pausing trades processing until offer completes"
            );
            this.pause(0, EPauseReason.OFFER_LIMIT_EXCEEDED); // Indefinite pause
            return callback(
              new CustomError(
                "Offer limit exceeded",
                ERR.TotalOfferLimitExceeded
              )
            );
          } else if (userCount >= this._pauseConfig.userTradeLimit) {
            logger.warn(
              "User trade limit exceeded - pausing trades processing until offer completes"
            );
            return callback(
              new CustomError(
                "User trade limit exceeded",
                ERR.UserOfferLimitExceeded
              )
            );
          } else {
            logger.warn(
              `Unexpected offer limit exceeded(total: ${activeCount} user: ${userCount}) - pausing trades processing until offer completes`
            );
          }

          return callback(
            new CustomError("Offer Limit Exceeded", ERR.RateLimitExceeded)
          );
        }
        if (err.cause === "TargetCannotTrade") {
          return callback(
            new CustomError("User cannot trade", ERR.TargetCannotTrade)
          );
        }
        if (err.cause === "ItemServerUnavailable") {
          return setTimeout(() => {
            this.sendOfferRetry(offer, attempts, callback);
          }, exponentialBackoff(attempts));
        }
        if (err.cause !== undefined) {
          return callback(err);
        }

        if (err.eresult !== undefined) {
          if (Number(err.eresult) === EResult.Revoked) {
            return callback(
              new CustomError(
                `One or more of items do not exist in the inventories, refresh it`,
                ERR.InvalidItems
              )
            );
          }
        }

        if (err.message !== "Not Logged In") {
          // Retry after some time
          return setTimeout(() => {
            this.sendOfferRetry(offer, attempts, callback);
          }, exponentialBackoff(attempts));
        }
        if (Number(err.eresult) === EResult.AccessDenied) {
          return callback(new CustomError("Access Denied", ERR.AccessDenied));
        } else {
          return callback(new CustomError(err.message));
        }
        // Optionally handle the 'Not Logged In' case, for example:
        // return this.bot.getWebSession(true).then(() => {
        //     setTimeout(() => {
        //         this.sendOfferRetry(offer, attempts, callback);
        //     }, exponentialBackoff(attempts));
        // }).catch(callback);
      }
      callback(null, status);
    });
  }
  // getOfflineOffers(): Promise<TradeOffer[]> {
  //   const sentOffers: TradeOffer[] = [];
  //   const pollData = this.bot.tradeManager.pollData as PollData;

  //   return new Promise<TradeOffer[]>((resolve, reject) => {
  //     const offerPromises: Promise<void>[] = [];

  //     for (const offerId in pollData.offerData) {
  //       if (pollData.offerData.hasOwnProperty(offerId)) {
  //         const offerData = pollData.offerData[offerId];

  //         if (!offerData.creationAck || !offerData.finalStateAck) {
  //           // Create a promise for each getOffer call
  //           const offerPromise = new Promise<void>((resolveOffer) => {
  //             this.bot.tradeManager.getOffer(offerId, (err, offer) => {
  //               if (err) {
  //                 logger.error(`Error requesting offer #${offerId}`);
  //               } else if (offer) {
  //                 sentOffers.push(offer);
  //               }
  //               resolveOffer();
  //             });
  //           });

  //           offerPromises.push(offerPromise);
  //         }
  //       }
  //     }

  //     // Wait for all getOffer promises to resolve before resolving the main promise
  //     Promise.all(offerPromises).then(() => resolve(sentOffers));
  //   });
  // }
  public isOfferFinished(state: number): boolean {
    return (
      [
        TradeOfferManager.ETradeOfferState.Accepted,
        TradeOfferManager.ETradeOfferState.Expired,
        TradeOfferManager.ETradeOfferState.Canceled,
        TradeOfferManager.ETradeOfferState.Declined,
        TradeOfferManager.ETradeOfferState.InvalidItems,
      ] as number[]
    ).includes(state);
  }

  getActiveOffers(pollData: PollData) {
    const sent: {
      [offerID: string]: OfferData;
    } = {};
    const received: {
      [offerID: string]: OfferData;
    } = {};

    for (const id in pollData.sent) {
      if (!Object.prototype.hasOwnProperty.call(pollData.sent, id)) {
        continue;
      }
      const state = pollData.sent[id];
      if (
        state === TradeOfferManager.ETradeOfferState["Active"] ||
        state === TradeOfferManager.ETradeOfferState["CreatedNeedsConfirmation"]
      ) {
        sent[id] = pollData.offerData[id] || {};
      }
    }

    for (const id in pollData.received) {
      if (!Object.prototype.hasOwnProperty.call(pollData.received, id)) {
        continue;
      }

      const state = pollData.received[id];
      if (state === TradeOfferManager.ETradeOfferState["Active"]) {
        received[id] = pollData.offerData[id] || {};
      }
    }

    return { sent, received };
  }
  public acceptOfferRetry(offer: TradeOffer, attempts: number) {
    return new Promise((resolve, reject) => {
      offer.accept((err, status) => {
        attempts++;
        if (err) {
          if (
            attempts > 5 ||
            err.eresult !== undefined ||
            err.cause !== undefined
          ) {
            return reject(err);
          }

          if (err.message !== "Not Logged In") {
            // We got an error getting the offer, retry after some time
            return void timersPromises
              .setTimeout(exponentialBackoff(attempts))
              .then(() => {
                resolve(this.acceptOfferRetry(offer, attempts));
              });
          }
          void timersPromises
            .setTimeout(exponentialBackoff(attempts))
            .then(() => {
              resolve(this.acceptOfferRetry(offer, attempts));
            });
        }
        return resolve(status);
      });
    });
  }
}
