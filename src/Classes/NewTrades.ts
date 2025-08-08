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
   * User limit exceeded - all users have reached their trade limit
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
  } = {
    totalTradeLimit: 30,
    userTradeLimit: 5,
  };
  // private _pausedUsers: Set<string> = new Set(); // Users who have hit the 5 trade limit

  constructor(bot: Bot, config: TaskProcessorConfig) {
    super(bot, config);
    // this.loadPauseConfig();
    // this.loadPausedUsers();
  }

  override bindEvents(): void {
    // Listen for offer state changes to resume processing when offers complete
    this.bot.tradeManager.on("realTimeTradeCompleted", (offer) => {
      logger.info(
        `Offer #${offer.id} status ${offer.state} completed, checking if trades can resume...`
      );
      this.checkAndResumeFromOfferLimit();
    });
    
    this.bot.tradeManager.on("realTimeTradeConfirmationRequired", (offer) => {
      logger.info(
        `Offer #${offer.id} requires confirmation, pausing trade processing...`
      );
    });
    
    this.bot.tradeManager.on("sentOfferChanged", (offer, oldState) => {
      if (this.isOfferFinished(offer.state)) {
        // An offer reached final state, check if we should resume
        logger.info(
          `Offer #${offer.id} reached final state (${offer.state}), checking if trades can resume...`
        );
        this.checkAndResumeFromOfferLimit();
      }
    });

    // Listen for received offer state changes as well
    this.bot.tradeManager.on("receivedOfferChanged", (offer, oldState) => {
      if (this.isOfferFinished(offer.state)) {
        logger.info(
          `Received offer #${offer.id} reached final state (${offer.state}), checking if trades can resume...`
        );
        this.checkAndResumeFromOfferLimit();
      }
    });
  }
  public override shouldPauseQueue(task: TaskItem<DealDto>): {
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

    // Check if we've exceeded the total offer limit
    if (totalActiveCount >= this._pauseConfig.totalTradeLimit) {
      return {
        pause: true,
        reason: EPauseReason.OFFER_LIMIT_EXCEEDED,
        time: 0, // Indefinite pause until offers complete
      };
    }

    // Count offers per user to check if all users have reached their limit
    const usersOffersCount = new Map<string, number>();
    let hasAnyUserWithSpace = false;

    // Count sent offers
    Object.values(activeOffers.sent).forEach((offer) => {
      const userId = offer.partnerId;
      if (userId) {
        usersOffersCount.set(userId, (usersOffersCount.get(userId) || 0) + 1);
      }
    });

    // Count received offers
    Object.values(activeOffers.received).forEach((offer) => {
      const userId = offer.partnerId;
      if (userId) {
        usersOffersCount.set(userId, (usersOffersCount.get(userId) || 0) + 1);
      }
    });

    // Check if any user has space for more offers
    for (const [userId, count] of usersOffersCount.entries()) {
      if (count < this._pauseConfig.userTradeLimit) {
        hasAnyUserWithSpace = true;
        break;
      }
    }

    // If all users who have active offers have reached their limit, pause
    if (usersOffersCount.size > 0 && !hasAnyUserWithSpace) {
      return { 
        pause: true, 
        reason: EPauseReason.USER_LIMIT_EXCEEDED, 
        time: 0 // Indefinite pause until offers complete
      };
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

  // Enhanced method to check and resume from various pause conditions
  private async checkAndResumeFromOfferLimit(): Promise<void> {
    try {
      // Only check if we're actually paused
      if (!this._paused || !this.pauseReason) {
        return;
      }

      const activeOffers = this.getActiveOffers(
        this.bot.tradeManager.pollData as PollData
      );
      const activeCount =
        Object.keys(activeOffers.sent).length +
        Object.keys(activeOffers.received).length;
      const limit = this._pauseConfig.totalTradeLimit;

      logger.debug(`Checking resume conditions: ${activeCount}/${limit} active offers, pause reason: ${this.pauseReason}`);

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
        // Count offers per user
        const usersOffersCount = new Map<string, number>();
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

        // Check if any user now has space for more offers
        let hasUserWithSpace = false;
        for (const [userId, count] of usersOffersCount.entries()) {
          if (count < this._pauseConfig.userTradeLimit) {
            hasUserWithSpace = true;
            break;
          }
        }

        if (hasUserWithSpace || activeCount < limit) {
          logger.info(
            `User trade limits have space or total limit decreased - resuming trade processing`
          );
          this.resume();
        } else {
          logger.debug(
            `All users still at trade limit, waiting for offers to complete`
          );
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


  // Load pause configuration from file
  // async loadPauseConfig(): Promise<void> {
  //   try {
  //     const filePath = path.join(
  //       this.bot.handler.getPaths.files.dir,
  //       "pauseConfig.json"
  //     );
  //     const configData = await files.readFile(filePath, true);
  //     if (this.isValidPauseConfig(configData)) {
  //       this._pauseConfig = { ...this._pauseConfig, ...configData };
  //     }
  //     logger.debug(`Loaded pause config:`, this._pauseConfig);
  //   } catch (error) {
  //     logger.debug("Using default pause config (file not found or invalid)");
  //   }
  // }

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

  // Validate pause config structure
  // private isValidPauseConfig(config: any): boolean {
  //   return (
  //     typeof config === "object" &&
  //     config !== null &&
  //     (typeof config.totalTradeLimit === "undefined" ||
  //       typeof config.totalTradeLimit === "number") &&
  //     (typeof config.userTradeLimit === "undefined" ||
  //       typeof config.userTradeLimit === "number") &&
  //     (typeof config.userPauseDuration === "undefined" ||
  //       typeof config.userPauseDuration === "number")
  //   );
  // }

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

    // Handle different types of errors
    if (error instanceof CustomError) {
      switch (error.eresult) {
        case ERR.TotalOfferLimitExceeded:
          // Total limit exceeded - pause queue
          logger.warn(`Total offer limit exceeded for deal ${task.data.id}, pausing queue`);
          this.pause(0, EPauseReason.OFFER_LIMIT_EXCEEDED);
          this.queue.unshift(task); // Add back to front
          this.jobSet.add(task.id);
          return;

        case ERR.UserOfferLimitExceeded:
          // This is unexpected result because we check user limit before sending
          // User limit exceeded - requeue task (will be skipped until user has space)
          logger.warn(`User offer limit unexpectedly exceeded for deal ${task.data.id}, requeueing task`);
          this.queue.unshift(task);
          this.jobSet.add(task.id);
          return;

        case ERR.RateLimitExceeded:
          // Rate limit - pause with exponential backoff
          const pauseDuration = Math.min(30000 * Math.pow(2, task.retries), 300000);
          logger.warn(`Rate limit exceeded for deal ${task.data.id}, pausing for ${pauseDuration}ms`);
          this.pause(pauseDuration, EPauseReason.RATE_LIMIT_EXCEEDED);
          this.queue.unshift(task);
          this.jobSet.add(task.id);
          return;
      }
    }

    // Standard retry logic with exponential backoff
    const retryDelay = Math.min(1000 * Math.pow(2, task.retries), 30000);

    setTimeout(() => {
      this.queue.unshift(task); // Add back to front
      this.jobSet.add(task.id);
      if (!this.processing && !this._paused) {
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
      trades_available: this._pauseConfig.totalTradeLimit - activeCount,
    };
  }

  // Manually check if we should resume from offer limit (useful for debugging)
  public async forceCheckOfferLimit(): Promise<boolean> {
    if (this._paused && this.pauseReason) {
      await this.checkAndResumeFromOfferLimit();
      return !this._paused; // Return true if we resumed
    }
    return false; // Not paused
  }

  // Enhanced method to check if tasks can be resumed
  public canResumeProcessing(): boolean {
    if (!this._paused) return true;
    
    const activeOffers = this.getActiveOffers(
      this.bot.tradeManager.pollData as PollData
    );
    const activeCount =
      Object.keys(activeOffers.sent).length +
      Object.keys(activeOffers.received).length;

    switch (this.pauseReason) {
      case EPauseReason.OFFER_LIMIT_EXCEEDED:
        return activeCount < this._pauseConfig.totalTradeLimit;
      
      case EPauseReason.USER_LIMIT_EXCEEDED:
        // Check if any user has space
        const usersOffersCount = new Map<string, number>();
        [...Object.values(activeOffers.sent), ...Object.values(activeOffers.received)]
          .forEach((offer) => {
            const userId = offer.partnerId;
            if (userId) {
              usersOffersCount.set(userId, (usersOffersCount.get(userId) || 0) + 1);
            }
          });
        
        for (const [userId, count] of usersOffersCount.entries()) {
          if (count < this._pauseConfig.userTradeLimit) {
            return true;
          }
        }
        return false;
      
      default:
        return false;
    }
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
          // Check current offer counts to determine the type of limit exceeded
          const offers = this.getActiveOffers(
            this.bot.tradeManager.pollData as PollData
          );
          const activeCount =
            Object.keys(offers.sent).length +
            Object.keys(offers.received).length;
          
          // Count offers for this specific user
          const userOffers = [
            ...Object.values(offers.sent),
            ...Object.values(offers.received),
          ];
          
          // Try to get partner ID from offer if available
          let partnerId: string | undefined;
          try {
            partnerId = offer.partner?.getSteamID64();
          } catch (e) {
            // Fallback if partner info not available
          }
          
          const userCount = partnerId 
            ? userOffers.filter(o => o.partnerId === partnerId).length
            : 0;

          if (activeCount >= this._pauseConfig.totalTradeLimit) {
            logger.warn(
              `Total offer limit exceeded (${activeCount}/${this._pauseConfig.totalTradeLimit}) - pausing trades processing`
            );
            this.pause(0, EPauseReason.OFFER_LIMIT_EXCEEDED);
            return callback(
              new CustomError(
                "Total offer limit exceeded",
                ERR.TotalOfferLimitExceeded
              )
            );
          } else if (userCount >= this._pauseConfig.userTradeLimit) {
            logger.warn(
              `User trade limit exceeded for ${partnerId} (${userCount}/${this._pauseConfig.userTradeLimit}) - task will be requeued`
            );
            return callback(
              new CustomError(
                "User trade limit exceeded",
                ERR.UserOfferLimitExceeded
              )
            );
          } else {
            logger.warn(
              `Unexpected offer limit exceeded (total: ${activeCount}, user: ${userCount}) - pausing trades processing`
            );
            this.pause(0, EPauseReason.OFFER_LIMIT_EXCEEDED);
            return callback(
              new CustomError("Offer Limit Exceeded", ERR.RateLimitExceeded)
            );
          }
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
