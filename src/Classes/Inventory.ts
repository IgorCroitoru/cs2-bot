import CEconItem from "steamcommunity/classes/CEconItem";
import { Bot } from "./Bot";
import { assetid } from "steamcommunity";
import SteamID from "steamid";
import { CustomError, ERR } from "./CustomError";
import Queue from "./Queue";
import { logger } from "../../logger";
import { delay } from "../utils";
import config from "../../config";
import { reject } from "async";
import { InventoryEvents } from "./Interfaces/Events";
import  EventEmitter  from "events";
import SteamCommunity from "steamcommunity";
import FS from 'fs'
import { ExtendedEconItem, ExtendedMEconItemExchange } from "./Interfaces/ExtendedItem";
export default class Inventory  extends EventEmitter{
    //public queue: Queue<SteamID|string> = new Queue<SteamID|string>
    private queue: ((callback: (err?: any) => void) => Promise<void>)[] = [];
    private processing = false;
    constructor(public readonly bot:Bot){
        super()
    }
    on<K extends keyof InventoryEvents>(event: K, listener: (...args: InventoryEvents[K]) => void): this {
        return super.on(event, listener);
    }
    emit<K extends keyof InventoryEvents>(event: K, ...args: InventoryEvents[K]): boolean {
        return super.emit(event, ...args);
    }
    enqueue(task: (callback: (err?: any) => void) => Promise<void>) {
        if (!this.bot.isReady) {
            throw new CustomError("Bot is not ready", ERR.NotReady);
        }
        this.queue.push(task);
        this.process();
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        const task = this.queue.shift();
        if (task) {
            try {
                await task((err)=>{
                    if(err){
                        if(err instanceof CustomError){
                            if(err.eresult === ERR.RateLimitExceeded){
                                logger.error("Rate Limit Exceeded...");
                                this.pause(config.rates.limitExceeded);
                            }
                            else{
                                logger.error(`Error task: ${err}`)
                            }
                        }
                        else{
                            console.error(err)
                        }
                    }
                   
                });
            } catch (err) {
                logger.error('Error processing task:', err);
            }
        }

        this.processing = false;
        if (this.queue.length > 0 && this.bot.isReady) {
            setTimeout(() => this.process(), config.inventory.delayBetweenReq); 
        }
    }

    size() {
        return this.queue.length;
    }

   
    pause(pauseDuration:number) {
        this.bot.setReady = false
        logger.warn(`Pausing bot requests for: ${pauseDuration/60000} min`)
        setTimeout(() => {
            this.bot.setReady = true;
            this.process();
        }, pauseDuration);
    }
    public getFilteredInventory(itemsAsset: assetid[], items:CEconItem[]){
        return items.filter(item=> {
            return itemsAsset.some(i=>{
                return(item.assetid.toString() === i.toString())
            })
        })
    }
    private removeDuplicates(items: CEconItem[]): CEconItem[] {
        const seen = new Set<string|number>();
        return items.filter(item => {
            const duplicate = seen.has(item.assetid);
            seen.add(item.assetid);
            return !duplicate;
        });
    }
    public getInventory(steamID: string):Promise<CEconItem[]>{
        return new Promise((resolve, reject)=> {
            this.bot.tradeManager.getUserInventoryContents(steamID,730,2,false, (err, inventory)=> {
                if(err){
                    if(err.message === "This profile is private."){
                        return reject(new CustomError("This profile is private.",ERR.PrivateProfile))
                    }
                    else if(err.message.includes("RateLimitExceeded")){
                        return reject(new CustomError(err.message, ERR.RateLimitExceeded))
                    }
                    else{
                        return reject(new CustomError(err.message, ERR.GeneralError))
                    }
                }
                resolve(inventory)
              
            })
        })
    }

    public getMyInventory(): Promise<ExtendedEconItem[]>{
        return new Promise((resolve,reject)=>{
            this.bot.tradeManager.getInventoryContents(730,2,false, (err, inventory) => {
                if(err){
                   
                    if(err.message.includes("RateLimitExceeded")){
                        return reject(new CustomError(err.message, ERR.RateLimitExceeded))
                    }
                    else{
                        return reject(new CustomError(err.message, ERR.GeneralError))
                    }
                }
                const gameInventory = this.bot.csClient.inventory
                const extendedInv = inventory as ExtendedEconItem[]
                extendedInv.forEach(item=>{
                    gameInventory?.forEach(gi=>{
                        if(item.assetid == gi.id){
                            item.paint_index = gi.paint_index,
                            item.paint_seed = gi.paint_seed,
                            item.paint_wear = gi.paint_wear,
                            item.tradable_after = gi.tradable_after,
                            item.stickers = gi.stickers
                        }
                    
                    })
                })
                resolve(inventory)
            })
        })
    }
}