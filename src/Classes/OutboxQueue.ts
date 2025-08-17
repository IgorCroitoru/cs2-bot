import { EventEmitter } from "events";
import { logger } from "../../logger";
import * as files from "../lib/files";
import { OutboxEvent, OutboxConfig, OutboxEventStatus } from "./Interfaces/OutboxEvents";
import { OutgoingEvents } from "./Interfaces/SocketEvents";

export type Last<T extends any[]> = T extends [...infer H, infer L] ? L : any;
export type AllButLast<T extends any[]> = T extends [...infer H, infer L]
  ? H
  : any[];
export type FirstArg<T> = T extends (arg: infer Param) => infer Result
  ? Param
  : any;

// Extract event parameters from OutgoingEvents
export type EventParams<Events, K extends keyof Events> = Events[K] extends (
  ...args: infer P
) => any
  ? P
  : never;

// Extract callback type from event parameters
export type ExtractCallbackResponse<Events, K extends keyof Events> = FirstArg<
  Last<EventParams<Events, K>>
>;

// Extract payload parameters (all but the callback)
export type ExtractPayload<Events, K extends keyof Events> = AllButLast<
  EventParams<Events, K>
>;

// Create a handler type that matches the socket.io pattern
export type OutboxEventHandler<Events, K extends keyof Events> = (
  ...args: ExtractPayload<Events, K>
) => Promise<ExtractCallbackResponse<Events, K>>;

// Create the handlers interface
export type OutboxEventHandlers<Events = OutgoingEvents> = {
  [K in keyof Events]?: OutboxEventHandler<Events, K>;
};
type UnwrapTuple<T> = T extends [infer U] ? U : T;

export type ExtractPayloadExceptCallback<
  Events,
  K extends keyof Events
> = UnwrapTuple<AllButLast<EventParams<Events, K>>>;

export class OutboxQueue extends EventEmitter {
  private events: OutboxEvent[] = [];
  private processing = false;
  private paused = false;
  private eventHandlers: Partial<OutboxEventHandlers<OutgoingEvents>> = {};
  private lastProcessedAt?: number;
  constructor(private config: OutboxConfig) {
    super();
    this.loadEvents();
  }

  private getNextSequenceNumber(groupId: string): number {
    const groupEvents = this.events.filter(
      (e) => e.group?.id === groupId && e.status !== "completed"
    );
    return groupEvents.length > 0
      ? Math.max(...groupEvents.map((e) => e.group?.sequence || 0)) + 1
      : 1;
  }
  /**
   * Add an event to the outbox queue
   */
  public async addEvent<K extends keyof OutgoingEvents>(
    type: K,
    payload: ExtractPayloadExceptCallback<OutgoingEvents, K>,
    priority: number = 0,
    maxRetries?: number,
    timeoutMs?: number,
    groupId?: string
  ): Promise<string> {
    const event: OutboxEvent<ExtractPayloadExceptCallback<OutgoingEvents, K>> =
      {
        id: this.generateEventId(),
        type,
        payload,
        timestamp: Date.now(),
        priority,
        retries: 0,
        maxRetries: maxRetries ?? this.config.maxRetries,
        status: "pending",
        timeoutMs: timeoutMs ?? this.config.defaultTimeoutMs,
        
      };
      groupId ? (event.group = { id: groupId, sequence: this.getNextSequenceNumber(groupId) }) : undefined;

    // Insert in priority order (higher priority first, then by timestamp)
    this.insertEventSorted(event);

    // Save immediately after adding
    if (this.config.enablePersistence) {
      await this.saveEvents();
    }

    this.emit("eventAdded", event);
    logger.debug(
      `Added outbox event: ${type} (${event.id}) with ${event.timeoutMs}ms timeout`
    );

    // Start processing immediately if not paused and not already processing
    if (!this.paused && !this.processing) {
      setImmediate(() => this.processEvents());
    }

    return event.id;
  }

  /**
   * Register a handler for a specific event type
   */
  public registerHandler<K extends keyof OutgoingEvents>(
    type: K,
    handler: OutboxEventHandler<OutgoingEvents, K>
  ): void {
    this.eventHandlers[type] = handler;
    logger.debug(`Registered handler for event type: ${type}`);
  }

  /**
   * Register multiple handlers at once
   */
  public registerHandlers(
    handlers: Partial<OutboxEventHandlers<OutgoingEvents>>
  ): void {
    Object.entries(handlers).forEach(([type, handler]) => {
      if (handler) {
        this.registerHandler(
          type as keyof OutgoingEvents,
          handler as OutboxEventHandler<OutgoingEvents, keyof OutgoingEvents>
        );
      }
    });
  }
  private hasEarlierUnfinishedGroupEvent(event: OutboxEvent): boolean {
    if(!event.group) return false; // No group, nothing to check
    return this.events.some(
      (e) =>
        e.group !== undefined &&
        e.group?.id === event.group?.id &&
        e.group?.sequence < event.group?.sequence &&
        e.status !== "completed"
    );
  }

  /**
   * Unregister a handler for a specific event type
   */
  public unregisterHandler(type: keyof OutgoingEvents): void {
    delete this.eventHandlers[type];
    logger.debug(`Unregistered handler for event type: ${type}`);
  }

  /**
   * Process pending events continuously
   */
  private async processEvents(): Promise<void> {
    if (this.processing || this.paused) return;

    this.processing = true;
    logger.debug("Started continuous event processing");

    try {
      // Keep processing while there are pending events and not paused
      while (!this.paused) {
        // Find pending events ready for processing
        const pendingEvents = this.events.filter((e) => e.status === "pending");
        const eligibleEvents = pendingEvents.filter(e => 
          this.isReadyForRetry(e) && !this.hasEarlierUnfinishedGroupEvent(e)
        );
        if (pendingEvents.length === 0) {
          logger.debug("No pending events remaining");
          break;
        }
        if (eligibleEvents.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        const nextEvent = eligibleEvents[0];

        try {
          await this.processEvent(nextEvent);

          // Save after each event is processed
          if (this.config.enablePersistence) {
            await this.saveEvents();
          }

          // Remove completed events from the queue immediately
          if (nextEvent.status === "completed") {
            this.events = this.events.filter((e) => e.id !== nextEvent.id);
          }
        } catch (error) {
          logger.error(`Error processing outbox event ${nextEvent.id}:`, error);
        }

        // Small delay between events to prevent overwhelming
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      logger.debug(
        "Event processing completed - no more pending events or paused"
      );
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single event with timeout support
   */
  private async processEvent(event: OutboxEvent): Promise<void> {
    const handler = this.eventHandlers[event.type];
    if (!handler) {
      logger.warn(`No handler registered for event type: ${event.type}`);
      event.status = "failed";
      event.lastError = "No handler registered";
      return;
    }

    event.status = "processing";
    event.processingStartedAt = Date.now();
    this.emit("eventProcessing", event);

    // const timeoutMs = event.timeoutMs || this.config.defaultTimeoutMs;

    try {
      const result = await handler(event.payload);
      event.status = "completed";
      this.emit("eventCompleted", event, result);
      logger.info(
        `Completed outbox event: ${event.type} (${event.id}) in ${
          Date.now() - (event.processingStartedAt || 0)
        }ms`
      );
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        error.message.toLowerCase().includes("operation has timed out");

      if (isTimeout) {
        this.handleEventTimeout(event, error);
      } else {
        this.handleEventError(event, error);
      }
    }
    finally {
      this.lastProcessedAt = Date.now();
    }
  }

  /**
   * Handle event timeout
   */
  private handleEventTimeout(event: OutboxEvent, error: any): void {
    event.retries++;
    event.lastError = `Timeout after ${event.timeoutMs}ms: ${
      error instanceof Error ? error.message : String(error)
    }`;

    if (event.retries >= event.maxRetries) {
      event.status = "timeout";
      this.emit("eventTimeout", event, error);
      logger.error(
        `Event timed out after ${event.retries} retries: ${event.type} (${event.id})`
      );
    } else if (this.config.enableTimeoutRetry) {
      event.status = "pending";
      event.nextRetryAt = Date.now() + this.calculateRetryDelay(event.retries);
      this.emit("eventRetrying", event, error);
      logger.warn(
        `Retrying timed out event: ${event.type} (${event.id}) - attempt ${event.retries}/${event.maxRetries}`
      );
    } else {
      event.status = "timeout";
      this.emit("eventTimeout", event, error);
      logger.error(
        `Event timed out (retry disabled): ${event.type} (${event.id})`
      );
    }
  }

  /**
   * Handle regular event error
   */
  private handleEventError(event: OutboxEvent, error: any): void {
    event.retries++;
    event.lastError = error instanceof Error ? error.message : String(error);

    if (event.retries >= event.maxRetries) {
      event.status = "failed";
      this.emit("eventFailed", event, error);
      logger.error(
        `Failed outbox event after ${event.retries} retries: ${event.type} (${event.id})`,
        error
      );
    } else {
      event.status = "pending";
      event.nextRetryAt = Date.now() + this.calculateRetryDelay(event.retries);
      this.emit("eventRetrying", event, error);
      logger.warn(
        `Retrying outbox event: ${event.type} (${event.id}) - attempt ${event.retries}/${event.maxRetries}`
      );
    }
  }

  /**
   * Retry all timed out events (useful for socket reconnection)
   */
  public async retryAllTimedOutEvents(): Promise<number> {
    const timedOutEvents = this.getTimedOutEvents();
    let retryCount = 0;

    for (const event of timedOutEvents) {
      // Reset the event for retry
      event.status = "pending";
      event.retries = Math.max(0, event.retries - 1); // Give it one more chance
      event.nextRetryAt = undefined;
      event.lastError = undefined;
      event.processingStartedAt = undefined;
      retryCount++;

      logger.debug(`Retrying timed out event: ${event.type} (${event.id})`);
    }

    if (retryCount > 0) {
      if (this.config.enablePersistence) {
        await this.saveEvents();
      }

      this.emit("timeoutEventsRetried", retryCount);
      logger.info(`Retrying ${retryCount} timed out events`);

      // Start processing immediately if not paused
      if (!this.paused) {
        setImmediate(() => this.processEvents());
      }
    }

    return retryCount;
  }

  /**
   * Retry timeout events that occurred within a specific time window
   */
  public async retryRecentTimeoutEvents(
    withinMinutes: number = 30
  ): Promise<number> {
    const cutoffTime = Date.now() - withinMinutes * 60 * 1000;
    const recentTimeoutEvents = this.events.filter(
      (e) => e.status === "timeout" && e.timestamp >= cutoffTime
    );

    let retryCount = 0;

    for (const event of recentTimeoutEvents) {
      event.status = "pending";
      event.retries = Math.max(0, event.retries - 1);
      event.nextRetryAt = undefined;
      event.lastError = undefined;
      event.processingStartedAt = undefined;
      retryCount++;
    }

    if (retryCount > 0) {
      if (this.config.enablePersistence) {
        await this.saveEvents();
      }

      logger.info(
        `Retrying ${retryCount} recent timeout events (within ${withinMinutes} minutes)`
      );

      if (!this.paused) {
        setImmediate(() => this.processEvents());
      }
    }

    return retryCount;
  }
  /**
   * Check if event is ready for retry
   */
  private isReadyForRetry(event: OutboxEvent): boolean {
    if (event.status !== "pending") return false;
    if (!event.nextRetryAt) return true;
    return Date.now() >= event.nextRetryAt;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    const delay = Math.min(
      this.config.retryDelayMs * Math.pow(2, retryCount - 1),
      this.config.maxRetryDelayMs
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  /**
   * Insert event in sorted order (priority desc, timestamp asc)
   */
  private insertEventSorted(event: OutboxEvent): void {
    const index = this.events.findIndex(
      (e) =>
        e.priority < event.priority ||
        (e.priority === event.priority && e.timestamp > event.timestamp)
    );

    if (index === -1) {
      this.events.push(event);
    } else {
      this.events.splice(index, 0, event);
    }
  }

  /**
   * Load events from file
   */
  private async loadEvents(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const data = await files.readFile(this.config.filePath, true);
      if (Array.isArray(data)) {
        this.events = data.filter(this.isValidOutboxEvent);
        this.sortEvents();
        logger.debug(`Loaded ${this.events.length} outbox events from storage`);
      }
    } catch (error) {
      logger.warn("Failed to load outbox events:", error);
      this.events = [];
    }
  }

  /**
   * Save events to file
   */
  private async saveEvents(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      // Only persist events that are not completed
      const eventsToSave = this.events.filter((e) => e.status !== "completed");
      await files.writeFile(this.config.filePath, eventsToSave, true);
      logger.debug(`Saved ${eventsToSave.length} outbox events to storage`);
    } catch (error) {
      logger.error("Failed to save outbox events:", error);
    }
  }

  /**
   * Sort events by priority and timestamp
   */
  private sortEvents(): void {
    this.events.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.timestamp - b.timestamp; // Earlier timestamp first
    });
  }

  /**
   * Validate event structure
   */
  private isValidOutboxEvent(event: any): event is OutboxEvent {
    // Basic type checks
    if (!event || typeof event !== 'object') {
      return false;
    }

    // Required string fields
    if (typeof event.id !== 'string' || event.id.trim() === '') {
      return false;
    }

    if (typeof event.type !== 'string' || event.type.trim() === '') {
      return false;
    }

    // Required number fields
    if (typeof event.timestamp !== 'number' || !Number.isInteger(event.timestamp) || event.timestamp <= 0) {
      return false;
    }

    if (typeof event.priority !== 'number' || !Number.isInteger(event.priority)) {
      return false;
    }

    if (typeof event.retries !== 'number' || !Number.isInteger(event.retries) || event.retries < 0) {
      return false;
    }

    if (typeof event.maxRetries !== 'number' || !Number.isInteger(event.maxRetries) || event.maxRetries < 0) {
      return false;
    }

    // Validate status enum
    const statuses: OutboxEventStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout'];
    if (!statuses.includes(event.status)) {
      return false;
    }

    // Optional fields validation
    if (event.nextRetryAt !== undefined && (typeof event.nextRetryAt !== 'number' || event.nextRetryAt <= 0)) {
      return false;
    }

    if (event.lastError !== undefined && typeof event.lastError !== 'string') {
      return false;
    }

    if (event.timeoutMs !== undefined && (typeof event.timeoutMs !== 'number' || event.timeoutMs <= 0)) {
      return false;
    }

    if (event.processingStartedAt !== undefined && (typeof event.processingStartedAt !== 'number' || event.processingStartedAt <= 0)) {
      return false;
    }

    // Validate group structure
    if (event.group !== undefined) {
      if (typeof event.group !== 'object' || event.group === null) {
        return false;
      }

      if (typeof event.group.id !== 'string' || event.group.id.trim() === '') {
        return false;
      }

      if (typeof event.group.sequence !== 'number' || !Number.isInteger(event.group.sequence) || event.group.sequence < 1) {
        return false;
      }
    }

    // Validate payload exists (can be any type)
    if (event.payload === undefined) {
      return false;
    }

    return true;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Pause event processing
   */
  public pause(): void {
    if (this.paused) return;

    this.paused = true;
    this.emit("processingPaused");
    logger.debug("OutboxQueue processing paused");
  }

  /**
   * Resume event processing
   */
  public async resume(): Promise<void> {
    if (!this.paused) return;

    this.paused = false;
    this.emit("processingResumed");
    logger.debug("OutboxQueue processing resumed");

    // Start processing if there are pending events
    if (
      this.events.some((e) => e.status === "pending" && this.isReadyForRetry(e))
    ) {
      await this.processEvents();
    }
  }

  /**
   * Check if processing is paused
   */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * Check if currently processing events
   */
  public isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get queue statistics
   */
  public getStats() {
    const stats = {
      total: this.events.length,
      pending: this.events.filter((e) => e.status === "pending").length,
      processing: this.events.filter((e) => e.status === "processing").length,
      completed: this.events.filter((e) => e.status === "completed").length,
      failed: this.events.filter((e) => e.status === "failed").length,
      cancelled: this.events.filter((e) => e.status === "cancelled").length,
      timeout: this.events.filter((e) => e.status === "timeout").length,
      lastProcessedAt: this.lastProcessedAt,
      isProcessing: this.processing,
      isPaused: this.paused,
    };


    return stats;
  }

  /**
   * Get events by type
   */
  public getEventsByType(type: keyof OutgoingEvents): OutboxEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get event by ID
   */
  public getEvent(eventId: string): OutboxEvent | undefined {
    return this.events.find((e) => e.id === eventId);
  }

  /**
   * Force immediate processing of pending events
   */
  public async forceProcess(): Promise<void> {
    if (!this.processing && !this.paused) {
      await this.processEvents();
    }
  }

  /**
   * Clear completed events
   */
  public async clearCompleted(): Promise<number> {
    const initialCount = this.events.length;
    this.events = this.events.filter((e) => e.status !== "completed");
    const removedCount = initialCount - this.events.length;

    if (removedCount > 0 && this.config.enablePersistence) {
      await this.saveEvents();
      logger.debug(`Cleared ${removedCount} completed outbox events`);
    }

    return removedCount;
  }

  /**
   * Cancel an event by ID
   */
  public async cancelEvent(eventId: string): Promise<boolean> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) return false;

    event.status = "cancelled";

    if (this.config.enablePersistence) {
      await this.saveEvents();
    }

    this.emit("eventCancelled", event);
    return true;
  }

  /**
   * Retry a timed out event
   */
  public async retryTimedOutEvent(eventId: string): Promise<boolean> {
    const event = this.events.find(
      (e) => e.id === eventId && e.status === "timeout"
    );
    if (!event) return false;

    event.status = "pending";
    event.retries = 0; // Reset retries for manual retry
    event.nextRetryAt = undefined;
    event.lastError = undefined;
    event.processingStartedAt = undefined;

    if (this.config.enablePersistence) {
      await this.saveEvents();
    }

    this.emit("eventRetried", event);
    logger.debug(
      `Manually retrying timed out event: ${event.type} (${event.id})`
    );

    // Process immediately if not paused
    if (!this.paused) {
      setImmediate(() => this.processEvents());
    }
    return true;
  }

  /**
   * Get events by status including timeout
   */
  public getEventsByStatus(status: OutboxEvent["status"]): OutboxEvent[] {
    return this.events.filter((e) => e.status === status);
  }

  /**
   * Get all timed out events
   */
  public getTimedOutEvents(): OutboxEvent[] {
    return this.events.filter((e) => e.status === "timeout");
  }

  /**
   * Clear timed out events
   */
  public async clearTimedOutEvents(): Promise<number> {
    const initialCount = this.events.length;
    this.events = this.events.filter((e) => e.status !== "timeout");
    const removedCount = initialCount - this.events.length;

    if (removedCount > 0 && this.config.enablePersistence) {
      await this.saveEvents();
      logger.debug(`Cleared ${removedCount} timed out events`);
    }

    return removedCount;
  }
  public async retryEvent(eventId: string): Promise<boolean> {
    const event = this.events.find(
      (e) => e.id === eventId && e.status === "failed"
    );
    if (!event) return false;

    event.status = "pending";
    event.retries = 0;
    event.nextRetryAt = undefined;
    event.lastError = undefined;

    if (this.config.enablePersistence) {
      await this.saveEvents();
    }

    this.emit("eventRetried", event);

    // Process events immediately if not paused
    if (!this.paused) {
      setImmediate(() => this.processEvents());
    }

    return true;
  }

  /**
   * Cleanup and shutdown
   */
  public async shutdown(): Promise<void> {
    if (this.config.enablePersistence) {
      await this.saveEvents();
    }

    this.removeAllListeners();
    logger.debug("Outbox queue shutdown complete");
  }
}
