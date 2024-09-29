import { Bot } from "./src/Classes/Bot";
import dotenv from 'dotenv';
import path from 'path';
import { logger } from "./logger";
import ON_DEATH from 'death';
import BotManager from "./src/Classes/BotManager";
import HttpManager from "./src/Classes/HttpManager";
import Trades from "./src/Classes/Trades";
import FS from 'fs'
import CEconItem from "steamcommunity/classes/CEconItem";
import SteamID from "steamid";
import TradesProcessor from "./src/Classes/TradesEventsHandler";
import { getSocketClient, setupSocketClient,SocketClient } from "./src/socket";
import config from "./config";
import InventoryProcessor from "./src/Classes/InvetoryEventsHandler";
import Inventory from "./src/Classes/Inventory";
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const botManager: BotManager = new BotManager();
let socketClient:SocketClient
async function startBotManager() {
    try {
        await botManager.start({
            accountName: String(process.env.USER_2_LOGIN),
            password: String(process.env.USER_2_PASSWORD),
            authCode: String(process.env.USER_2_SECRET_KEY)
        });
        if(botManager.bot){
            const tradeManager = new Trades(botManager.bot)
            const inventory = new Inventory(botManager.bot)
            const httpManager = new HttpManager(inventory);
            httpManager.start();
            setupSocketClient({
                serverUrl: String(process.env.BOT_MANAGER_SOCKET),
                reconnectAttempts: config.socket.reconnectAttempts,
                reconnectDelay:config.socket.reconnectDelay
            },
            {
                username:String(process.env.USER_2_LOGIN),
                id64: String(process.env.USER_2_ID64),
                ready: botManager.isBotReady
            })
            socketClient=getSocketClient()
            const tradesProcessor:TradesProcessor = new TradesProcessor(tradeManager,socketClient)
            const inventProcessor:InventoryProcessor = new InventoryProcessor(inventory,socketClient)
            await Promise.all([
                tradesProcessor.start(),
                inventProcessor.start()
            ])
        }
        
    } catch (err) {
        throw err
    }
}

async function main() {
    try{
        // const httpManager = new HttpManager();
        // httpManager.start();
    
        // Start the BotManager
        await startBotManager();
    }catch(error){
        
        logger.error(`Failed to start: ${(error as Error).message}`);
        throw error
    }
   
}

ON_DEATH({ uncaughtException: true })((signalOrErr, origin?: string | Error) => {
    const crashed = !['SIGINT', 'SIGTERM'].includes(signalOrErr as 'SIGINT' | 'SIGTERM' | 'SIGQUIT');

    const error = origin instanceof Error ? origin : signalOrErr instanceof Error ? signalOrErr : null;

    if (crashed && error) {
        logger.error('Bot crashed:', error, origin, signalOrErr);

        

    } else {
        logger.warn('Received kill signal:', signalOrErr, origin);
        process.exit(1)
    }

    //botManager.stop(crashed ? error : null);
});

main().catch((err) => {
    logger.error(`An error occurred: ${(err as Error).message}`);
    //throw err;
    // process.exit(1)
});
