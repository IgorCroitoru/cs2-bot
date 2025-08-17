import { logger } from "../../logger";
import { ServiceContainer } from "../../ServiceContainer";
import { AbstractTaskProcessor } from "./AbstractTaskQueue";
import { BotStatsDelta, BotStatsSnapshot, QueueStats } from "./Interfaces/StatsSnapshot";

export class StatsPublisher {
  private state: BotStatsSnapshot;
  private heartbeatTimer?: NodeJS.Timeout;
  private deltaTimer?: NodeJS.Timeout;
  private services: ServiceContainer;
  private startTime = Date.now();

  constructor(
    private heartbeatIntervalMs = 30000, // 30 seconds for full snapshot
    private deltaCheckIntervalMs = 5000 // 5 seconds for delta check
  ) {
    this.services = ServiceContainer.getInstance();
    this.state = this.createInitialState();
    this.setupSocketHandlers();
    this.startTimers();
  }
  private createInitialState(): BotStatsSnapshot {
    const bot = this.services.getBot();

    return {
      botId: bot?.community.steamID?.getSteamID64() || "unknown",
      timestamp: Date.now(),
      queues: {},
      bot: {
        ready: bot?.ready || false,
        paused: false, // Will be updated in collectCurrentState
        uptime: 0,
        steamId: bot?.community.steamID?.getSteamID64() || "unknown",
      },
      system: {
        memoryUsage: process.memoryUsage(),
      },
    };
  }
  private setupSocketHandlers(): void {
    const socketClient = this.services.getSocketClient();
    if (!socketClient) {
      logger.warn("No socket client available for stats publisher");
      return;
    }


    // socket.on("botStatsRequest", () => {
    //   logger.debug("Server requested bot stats snapshot");
    //   this.emitSnapshot();
    // });
  }
  private startTimers(): void {
    // Periodic full snapshot
    this.heartbeatTimer = setInterval(() => {
      this.emitSnapshot();
    }, this.heartbeatIntervalMs);

    // Periodic delta check
    this.deltaTimer = setInterval(() => {
      this.checkForChanges();
    }, this.deltaCheckIntervalMs);

    logger.info(
      `BotStatsPublisher started - snapshots every ${this.heartbeatIntervalMs}ms, deltas every ${this.deltaCheckIntervalMs}ms`
    );
  }

  private checkForChanges(): void {
    const newState = this.collectCurrentState();
    const changes: Partial<BotStatsSnapshot> = {};
    let hasChanges = false;

    // Check bot state changes
    if (JSON.stringify(this.state.bot) !== JSON.stringify(newState.bot)) {
      changes.bot = newState.bot;
      hasChanges = true;
    }

    // Check queue changes
    if (JSON.stringify(this.state.queues) !== JSON.stringify(newState.queues)) {
      changes.queues = newState.queues;
      hasChanges = true;
    }

    // Check system changes (memory usage can change frequently, so only check significant changes)
    const memoryChange = Math.abs(
      (this.state.system?.memoryUsage.heapUsed || 0) -
        (newState.system?.memoryUsage.heapUsed || 0)
    );
    if (memoryChange > 10 * 1024 * 1024) {
      // Only report if >10MB change
      changes.system = newState.system;
      hasChanges = true;
    }

    if (hasChanges) {
      this.state = { ...this.state, ...changes };
      this.emitDelta(changes);
    }
  }
  private getQueueStatsFromProcessor(
    processor: AbstractTaskProcessor<any, any>,
    type: string
  ): QueueStats {
    // Access private/protected properties carefully
    const status = processor.getStatus();

    return {
      type,
      size: status.size,
      processing: status.processing,
      paused: status.paused,
      pauseReason: status.pauseReason ?? undefined,
      pauseTimeRemaining: status.pause_time_remaining_ms,
      totalProcessed: status.totalProcessed,
      totalFailed: status.totalFailed,
      lastProcessedAt: undefined,
    };
  }
  private collectCurrentState(): BotStatsSnapshot {
    const bot = this.services.getBot();
    const tradeManager = this.services.getTradeManager();
    const inventory = this.services.getInventory();
    const outboxQueue = this.services.getOutboxQueue();

    // Collect queue stats
    const queues: { [key: string]: QueueStats } = {};

    // Trade queue stats
    if (tradeManager) {
      queues.trades = this.getQueueStatsFromProcessor(tradeManager, "trades");
    }

    // Inventory queue stats
    if (inventory) {
      queues.inventory = this.getQueueStatsFromProcessor(
        inventory,
        "inventory"
      );
    }
    const outboxStats = outboxQueue.getStats();
    // Outbox queue stats
    if (outboxQueue) {
      queues.outbox = {
        type: "outbox",
        size: outboxStats.total,
        processing: outboxQueue.isProcessing(),
        paused: outboxQueue.isPaused(),
        pauseReason: outboxQueue.isPaused() ? "manual" : undefined,
        totalProcessed: outboxStats.completed,
        totalFailed: outboxStats.failed,
        lastProcessedAt: outboxStats.lastProcessedAt,
      };
    }

    // Get trade manager stats
    return {
      botId: bot?.community.steamID.getSteamID64() || "unknown",
      timestamp: Date.now(),
      queues,
      bot: {
        ready: bot?.ready || false,
        paused: bot.isPaused,
        uptime: Date.now() - this.startTime,
        steamId: bot?.community.steamID.getSteamID64() || "unknown",
      },
      system: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
    };
  }
  private emitDelta(changes: Partial<BotStatsSnapshot>): void {
    const socketClient = this.services.getSocketClient();
    if (!socketClient) {
      logger.debug("No socket client available, skipping delta emission");
      return;
    }

    this.state.timestamp = Date.now();

    const delta: BotStatsDelta = {
      botId: this.state.botId,
      timestamp: this.state.timestamp,
      changes,
    };

    const socket = socketClient.getSocket();
    socket.volatile.emit("botStatsDelta", delta);
  }

  private emitSnapshot(): void {
    const socketClient = this.services.getSocketClient();
    if (!socketClient) {
      logger.debug("No socket client available, skipping snapshot emission");
      return;
    }

    this.state = this.collectCurrentState();

    const socket = socketClient.getSocket();
    socket.volatile.emit("botStats", this.state);

  }

  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.deltaTimer) {
      clearInterval(this.deltaTimer);
      this.deltaTimer = undefined;
    }
    logger.info("BotStatsPublisher stopped");
  }

  // Manual triggers
  public forceSnapshot(): void {
    logger.debug("Forcing stats snapshot");
    this.emitSnapshot();
  }

  public forceCheck(): void {
    logger.debug("Forcing stats delta check");
    this.checkForChanges();
  }

  // Get current stats (for HTTP API or debugging)
  public getCurrentStats(): BotStatsSnapshot {
    return { ...this.state };
  }
}
