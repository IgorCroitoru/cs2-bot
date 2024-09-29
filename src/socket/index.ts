import { io as Client, Socket } from "socket.io-client";
import dotenv from 'dotenv';
import path from 'path';
import { logger } from "../../logger";
import config from "../../config";
import { InitQuery, ResponseCallbackData, SocketEvents } from "../Classes/Interfaces/SocketEvents";
import { TradeEvents } from "../Classes/Interfaces/Events";
dotenv.config({ path: path.resolve(__dirname, '../.env') });



type SocketClientOptions = {
    serverUrl: string;
    reconnectAttempts?: number;
    reconnectDelay?: number;
};

export class SocketClient {
    public socket: Socket;
    private isVolatile = false
    retryCounter = 0;
    constructor(private options: SocketClientOptions, initQuery:InitQuery) {
        this.socket = Client(this.options.serverUrl, {
            reconnectionAttempts: this.options.reconnectAttempts || Infinity,
            reconnectionDelay: this.options.reconnectDelay || 1000,
            query: initQuery
        });

        this.setupSocketListeners();
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

        this.socket.on("reconnect_attempt", (attempt) => {
            logger.info(`Reconnection attempt #${attempt}`);
        });
       
    }

    emitWithTimeout<K extends keyof SocketEvents>(timeout: number, event: K, ...args: SocketEvents[K]): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout'));
            }, timeout);
            const socket = this.isVolatile ? this.socket.volatile : this.socket;
            socket.emit(event, ...args, (response: any) => {
                this.isVolatile = false
                clearTimeout(timeoutId);
                
                return resolve(response);
               
            });
        });
    }
    emitWithAck<K extends keyof SocketEvents>(event:K, ...args:SocketEvents[K]):Promise<any>{
        return new Promise((resolve, reject) => {
            const socket = this.isVolatile ? this.socket.volatile : this.socket;
    
            // Emit the event and listen for acknowledgment
            socket.emit(event, ...args, (ack: any) => {
                this.isVolatile = false; // Reset the flag after the operation
    
                if (ack instanceof Error) {
                    reject(ack);
                } else {
                    resolve(ack);
                }
            });
        });
    }
    on<K extends keyof SocketEvents>(event:K, listener:(...args:SocketEvents[K])=> void):void{
        const socket = this.isVolatile ? this.socket.volatile : this.socket;
        socket.on(event, listener as any);
        this.isVolatile = false; 
    }
    emit<K extends keyof SocketEvents>(event: K, ...args: SocketEvents[K]): void{
        const socket = this.isVolatile ? this.socket.volatile : this.socket;
        socket.emit(event, ...args);
        this.isVolatile = false;  
    }

    get volatile(): this{
        this.isVolatile = true;
        return this;
    }
    // on<K extends keyof TradeEvents>(event: K, listener: (...args: TradeEvents[K]) => void): this {
    //     return super.on(event, listener);
    // }
    // emit<K extends keyof TradeEvents>(event: K, ...args: TradeEvents[K]): boolean {
    //     return super.emit(event, ...args);
    // }
    // public on(event: string, callback: (...args: any[]) => void): void {
    //     this.socket.on(event, callback);
    // }

    // public emit(event: string, ...args: any[]): void {
    //     this.socket.emit(event, ...args);
    // }

    public disconnect(): void {
        this.socket.disconnect();
    }

    public isConnected(): boolean {
        return this.socket.connected;
    }
}

// Singleton instance of SocketClient
let socketClient: SocketClient | null = null;

export const setupSocketClient = (options: SocketClientOptions, query: InitQuery): void => {
    if (!socketClient) {
        socketClient = new SocketClient(options,query);
    }
};

export const getSocketClient = (): SocketClient => {
    if (!socketClient) {
        throw new Error("Socket client has not been set up. Call setupSocketClient first.");
    }
    return socketClient;
};
