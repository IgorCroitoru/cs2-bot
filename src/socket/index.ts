import { io as Client, Socket } from "socket.io-client";
import dotenv from 'dotenv';
import path from 'path';
import { logger } from "../../logger";
import { IngoingEvents, InitQuery, InventorySocketEventsIngoing, InventorySocketEventsOutgoing, OutgoingEvents, SocketEvents, TradeSocketEventsIngoing, TradeSocketEventsOutgoing } from "../Classes/Interfaces/SocketEvents";
dotenv.config({ path: path.resolve(__dirname, '../.env') });

type SocketClientOptions = {
    serverUrl: string;
    reconnectAttempts?: number;
    reconnectDelay?: number;
};

export class SocketClient<TIngoing extends Record<string, any> = IngoingEvents, TOutgoing extends Record<string, any> = OutgoingEvents> {
    public socket: Socket<TIngoing, TOutgoing>;
    private isVolatile = false;
    retryCounter = 0;

    constructor(private options: SocketClientOptions, initQuery: InitQuery) {
        this.socket = Client(this.options.serverUrl, {
            reconnectionAttempts: this.options.reconnectAttempts || Infinity,
            reconnectionDelay: this.options.reconnectDelay || 1000,
            query: initQuery
        });
        
        this.setupSocketListeners();
    }

    /**
     * Get the socket instance
     */
    public getSocket(): Socket<TIngoing, TOutgoing> {
        return this.socket;
    }

    private setupSocketListeners(): void {
        this.socket.on("connect", () => {
            
            this.retryCounter = 0
            logger.info(`Connected to server`)
        });

        this.socket.on("disconnect", () => {
            logger.warn("Disconnected from server");
        });

        this.socket.on("connect_error", (error) => {
            this.retryCounter++;
            if (this.retryCounter % 100 === 0) {
                logger.error(`Connection error: ${error}. Attempts: ${this.retryCounter}`);
            }
            
        });

        (this.socket as any).on("reconnect_attempt", (attempt: number) => {
            logger.info(`Reconnection attempt #${attempt}`);
        });
       
    }

    
    public disconnect(): void {
        this.socket.disconnect();
    }

    public isConnected(): boolean {
        return this.socket.connected;
    }
}

// Factory function to create and return a socket client
export const createSocketClient = <TIngoing extends Record<string, any> = TradeSocketEventsIngoing, TOutgoing extends Record<string, any> = TradeSocketEventsOutgoing>(
    options: SocketClientOptions, 
    query: InitQuery
): SocketClient<TIngoing, TOutgoing> => {
    return new SocketClient<TIngoing, TOutgoing>(options, query);
};

// Factory function to create and return just the socket
export const createSocket = <TIngoing extends Record<string, any> = TradeSocketEventsIngoing, TOutgoing extends Record<string, any> = TradeSocketEventsOutgoing>(
    options: SocketClientOptions, 
    query: InitQuery
): Socket<TIngoing, TOutgoing> => {
    const client = new SocketClient<TIngoing, TOutgoing>(options, query);
    return client.getSocket();
};

// Singleton instance of SocketClient
let socketClient: SocketClient<any, any> | null = null;

export const setupSocketClient = <TIngoing extends Record<string, any> = TradeSocketEventsIngoing, TOutgoing extends Record<string, any> = TradeSocketEventsOutgoing>(
    options: SocketClientOptions, 
    query: InitQuery
): SocketClient<TIngoing, TOutgoing> => {
    if (!socketClient) {
        socketClient = new SocketClient<TIngoing, TOutgoing>(options, query);
    }
    return socketClient as SocketClient<TIngoing, TOutgoing>;
};

export const getSocketClient = <TIngoing extends Record<string, any> = TradeSocketEventsIngoing, TOutgoing extends Record<string, any> = TradeSocketEventsOutgoing>(): SocketClient<TIngoing, TOutgoing> => {
    if (!socketClient) {
        throw new Error("Socket client has not been set up. Call setupSocketClient first.");
    }
    return socketClient as SocketClient<TIngoing, TOutgoing>;
};

// Get just the socket from singleton
export const getSocket = <TIngoing extends Record<string, any> = TradeSocketEventsIngoing, TOutgoing extends Record<string, any> = TradeSocketEventsOutgoing>(): Socket<TIngoing, TOutgoing> => {
    const client = getSocketClient<TIngoing, TOutgoing>();
    return client.getSocket();
};
