// src/ServiceContainer.ts
import { Bot } from "./src/Classes/Bot";
import { Trades } from "./src/Classes/Trades";
import { Inventory } from "./src/Classes/Inventory";
import TradesProcessor from "./src/Classes/TradesProcessor";
import InventoryProcessor from "./src/Classes/InventoryProcessor";
import HttpManager from "./src/Classes/HttpManager";
import { OutboxQueue } from "./src/Classes/OutboxQueue";
import { SocketClient } from "./src/socket";
// import { InspectProcessor } from "./src/Classes/Inspect/InspectProcessor";
import GameData from "./src/Classes/Inspect/GameData";
import { StatsPublisher } from "./src/Classes/StatPublisher";

export class ServiceContainer {
    private static instance: ServiceContainer;
    public statsPublisher?: StatsPublisher;
    public bot?: Bot;
    public tradeManager?: Trades;
    public inventory?: Inventory;
    public httpManager?: HttpManager;
    public tradesProcessor?: TradesProcessor;
    public inventoryProcessor?: InventoryProcessor;
    public outboxQueue?: OutboxQueue;
    public socketClient?: SocketClient;
    // public inspectProcessor?: InspectProcessor;
    public gameData?: GameData; 
    private constructor() {}

    public static getInstance(): ServiceContainer {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer();
        }
        return ServiceContainer.instance;
    }

    public setStatsPublisher(statsPublisher: StatsPublisher): void {
        this.statsPublisher = statsPublisher;
    }

    public setBot(bot: Bot): void {
        this.bot = bot;
    }

    public setTradeManager(tradeManager: Trades): void {
        this.tradeManager = tradeManager;
    }

    public setInventory(inventory: Inventory): void {
        this.inventory = inventory;
    }

    public setHttpManager(httpManager: HttpManager): void {
        this.httpManager = httpManager;
    }

    public setTradesProcessor(tradesProcessor: TradesProcessor): void {
        this.tradesProcessor = tradesProcessor;
    }

    public setInventoryProcessor(inventoryProcessor: InventoryProcessor): void {
        this.inventoryProcessor = inventoryProcessor;
    }

    public setOutboxQueue(outboxQueue: OutboxQueue): void {
        this.outboxQueue = outboxQueue;
    }

    public setSocketClient(socketClient: SocketClient): void {
        this.socketClient = socketClient;
    }
    // public setInspectProcessor(inspectProcessor: InspectProcessor): void {
    //     this.inspectProcessor = inspectProcessor;
    // }
    public setGameData(gameData: GameData): void {
        this.gameData = gameData;
    }
    // Getter methods with validation
    public getStatsPublisher(): StatsPublisher {
        if (!this.statsPublisher) throw new Error('StatsPublisher not initialized');
        return this.statsPublisher;
    }
    public getBot(): Bot {
        if (!this.bot) throw new Error('Bot not initialized');
        return this.bot;
    }

    public getTradeManager(): Trades {
        if (!this.tradeManager) throw new Error('TradeManager not initialized');
        return this.tradeManager;
    }

    public getInventory(): Inventory {
        if (!this.inventory) throw new Error('Inventory not initialized');
        return this.inventory;
    }

    public getHttpManager(): HttpManager {
        if (!this.httpManager) throw new Error('HttpManager not initialized');
        return this.httpManager;
    }

    public getTradesProcessor(): TradesProcessor {
        if (!this.tradesProcessor) throw new Error('TradesProcessor not initialized');
        return this.tradesProcessor;
    }

    public getInventoryProcessor(): InventoryProcessor {
        if (!this.inventoryProcessor) throw new Error('InventoryProcessor not initialized');
        return this.inventoryProcessor;
    }

    public getOutboxQueue(): OutboxQueue {
        if (!this.outboxQueue) throw new Error('OutboxQueue not initialized');
        return this.outboxQueue;
    }

    public getSocketClient(): SocketClient {
        if (!this.socketClient) throw new Error('SocketClient not initialized');
        return this.socketClient;
    }

    // public getInspectProcessor(): InspectProcessor {
    //     if (!this.inspectProcessor) throw new Error('InspectProcessor not initialized');
    //     return this.inspectProcessor;
    // }
    public getGameData(): GameData {
        if (!this.gameData) throw new Error('GameData not initialized');
        return this.gameData;
    }
    // Utility method to check if all services are ready
    // public isReady(): boolean {
    //     return !!(
    //         this.bot &&
    //         this.tradeManager &&
    //         this.inventory &&
    //         this.httpManager &&
    //         this.tradesProcessor &&
    //         this.inventoryProcessor &&
    //         this.outboxQueue &&
    //         this.socketClient &&
    //         this.inspectProcessor
    //     );
    // }

    // Clean shutdown method
    public async shutdown(): Promise<void> {
        // Add cleanup logic for each service
        // await this.tradesProcessor?.stop?.();
        // await this.inventoryProcessor?.stop?.();
        // ... other cleanup
    }
}