import { Bot } from "./src/Classes/Bot";
import dotenv from "dotenv";
import path from "path";
import { logger } from "./logger";
import ON_DEATH from "death";
import BotManager from "./src/Classes/BotManager";
import HttpManager from "./src/Classes/HttpManager";
import TradesProcessor from "./src/Classes/TradesProcessor";
import { getSocketClient, setupSocketClient, SocketClient } from "./src/socket";
import config from "./config";
import InventoryProcessor from "./src/Classes/InventoryProcessor";
import { Inventory } from "./src/Classes/Inventory";
import { Trades } from "./src/Classes/Trades";
import { OutboxQueue } from "./src/Classes/OutboxQueue";
import { ServiceContainer } from "./ServiceContainer"; // Add this import
// import { InspectProcessor } from "./src/Classes/Inspect/InspectProcessor";
import GameData from "./src/Classes/Inspect/GameData";
import { StatsPublisher } from "./src/Classes/StatPublisher";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const botManager: BotManager = new BotManager();
const services = ServiceContainer.getInstance(); // Get singleton instance

async function startBotManager() {
  try {
    
    await botManager.start({
      accountName: String(process.env.USER_2_LOGIN),
      password: String(process.env.USER_2_PASSWORD),
      authCode: String(process.env.USER_2_SECRET_KEY),
    });

    if (botManager.bot) {
      // Store bot in service container
      services.setBot(botManager.bot);

      // Initialize services
      const gameData = new GameData(config.gameData.updateInterval, config.gameData.enableUpdate);
      services.setGameData(gameData);
      const tradeManager = new Trades(
        botManager.bot,
        {
          delayBetweenTasks: config.offer.delayBetweenOffers,
          maxRetries: config.offer.maxRetries,
          pauseType: "trades",
          queueFilePath: botManager.bot.handler.getPaths.files.dealQueue,
        },
        gameData
      );
      services.setTradeManager(tradeManager);

      const inventory = new Inventory(botManager.bot, {
        delayBetweenTasks: config.inventory.delayBetweenReq,
        maxRetries: config.inventory.maxRetries,
        pauseType: "inventory",
      });
      services.setInventory(inventory);

      setupSocketClient(
        {
          serverUrl: String(process.env.BOT_MANAGER_SOCKET),
          reconnectAttempts: config.socket.reconnectAttempts,
          reconnectDelay: config.socket.reconnectDelay,
        },
        {
          username: String(process.env.USER_2_LOGIN),
          id64: String(process.env.USER_2_ID64),
          ready: botManager.isBotReady,
        }
      );

      const socketClient = getSocketClient();
      services.setSocketClient(socketClient);

      const outboxQueue = new OutboxQueue({
        filePath: botManager.bot.handler.getPaths.files.outboxEvents,
        maxRetries: 5,
        retryDelayMs: 1000,
        maxRetryDelayMs: 30000,
        enablePersistence: true,
      });
      services.setOutboxQueue(outboxQueue);

      const tradesProcessor = new TradesProcessor(
        tradeManager,
        socketClient.getSocket(),
        outboxQueue
      );
      services.setTradesProcessor(tradesProcessor);

      const inventProcessor = new InventoryProcessor(
        inventory,
        socketClient.getSocket()
      );
      services.setInventoryProcessor(inventProcessor);
      // const inspectProcessor = new InspectProcessor(botManager.bot);
      // services.setInspectProcessor(inspectProcessor);
      // Now HttpManager can access all services
      const httpManager = new HttpManager(services); // Pass entire service container
      services.setHttpManager(httpManager);

      await Promise.all([tradesProcessor.start(), inventProcessor.start()]);
      const statsPublisher = new StatsPublisher(
        config.stats?.heartbeatIntervalMs || 30000,  // 30 seconds
        config.stats?.deltaCheckIntervalMs || 5000   // 5 seconds
      );
      services.setStatsPublisher(statsPublisher);
      httpManager.start();

      logger.info("All services initialized and started successfully");
    }
  } catch (err) {
    throw err;
  }
}

// Update shutdown handler
ON_DEATH({ uncaughtException: true })(
  (signalOrErr, origin?: string | Error) => {
    const crashed = !["SIGINT", "SIGTERM"].includes(
      signalOrErr as "SIGINT" | "SIGTERM" | "SIGQUIT"
    );

    const error =
      origin instanceof Error
        ? origin
        : signalOrErr instanceof Error
        ? signalOrErr
        : null;

    if (crashed && error) {
      logger.error("Bot crashed:", {
        message: error.message,
        stack: error.stack,
        origin: origin,
        signal: signalOrErr,
      });
    } else {
      logger.warn("Received kill signal:", signalOrErr, origin);
    }

    // Graceful shutdown
    services.shutdown().then(() => {
      process.exit(crashed ? 1 : 0);
    });
  }
);

async function main() {
  try {
    // const httpManager = new HttpManager();
    // httpManager.start();

    // Start the BotManager
    await startBotManager();
  } catch (error) {
    logger.error(`Failed to start: ${(error as Error).message}`);
    throw error;
  }
}

main().catch((err) => {
  logger.error(`An error occurred: ${(err as Error).message}`);
  //throw err;
  // process.exit(1)
});
