import { Bot } from "./Bot";
import TradeOfferManager, { EResult  } from "steam-tradeoffer-manager";
import { DealErrorData , OfferData, PollData } from "./Interfaces/PollData";
import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import timersPromises from 'timers/promises';
import { delay, exponentialBackoff } from "../utils";
import SteamID from "steamid";
import { CustomError, ERR } from "./CustomError";
import CEconItem from "steamcommunity/classes/CEconItem";
import { assetid } from "steamcommunity";
import { logger } from "../../logger";
import { TradeEvents } from "./Interfaces/Events";
import EventEmitter from 'events'
import Queue from "./Queue";
import config from "../../config";
import * as files from '../lib/files'
import DealDto from "./Dtos/DealDto";
import Deal from "./Deal";
export default class Trades extends EventEmitter{
    public queue: Queue<DealDto> =new Queue<DealDto>
    private processing: boolean = false
    private jobSet: Set<number> = new Set<number>();
    public dealError: {[dealId: number]: DealErrorData} = {}
    constructor(public readonly bot:Bot){
        super()
        this.bot = bot
        
    }

    bindEventHandler(){
      this.bot.on('ready',()=>{
        this.startProcessingQueue()
      })
        
    }

    on<K extends keyof TradeEvents>(event: K, listener: (...args: TradeEvents[K]) => void): this {
        return super.on(event, listener);
    }
    emit<K extends keyof TradeEvents>(event: K, ...args: TradeEvents[K]): boolean {
        return super.emit(event, ...args);
    }
    isValidDealErrorData(dealError: any): dealError is { [dealId: number]: DealErrorData } {
        if (typeof dealError !== 'object' || dealError === null) {
            return false;
        }
    
        for (const key in dealError) {
            if (Object.prototype.hasOwnProperty.call(dealError, key)) {
                const dealId = Number(key);
    
                // Check if the key is a valid number
                if (isNaN(dealId)) {
                    return false;
                }
    
                const errorData = dealError[dealId];
    
                if (
                    typeof errorData !== 'object' ||
                    typeof errorData.dealId !== 'number' ||
                    typeof errorData.error === 'undefined' || // `error` can be of any type
                    typeof errorData.timestamp !== 'number'
                ) {
                    return false;
                }
            }
        }
    
        return true;
    }
    public async enqueue(deal: DealDto): Promise<void> {
        // if (!this.bot.isReady) {
        //     throw new CustomError("Bot is not ready", ERR.NotReady);
        // }
        if (this.jobSet.has(deal.id)) {
            logger.warn(`Deal with id ${deal.id} is already in the queue.`);
            return;
        }
        this.jobSet.add(deal.id)
        this.queue.enqueue(deal);
        await files.writeFile(this.bot.handler.getPaths.files.dealQueue,this.queue.getAllElements(),true)
        if (!this.processing && this.bot.ready) {
            this.processQueue();
        }
    }

    
    public async startProcessingQueue(): Promise<void> {
        if (!this.processing) {
            await this.processQueue();
        }
    }
    
    private async processQueue(): Promise<void> {
        this.processing = true;

        while (this.queue.size() > 0) {
            const deal = this.queue.dequeue();
            if (!deal) continue;

            this.jobSet.delete(deal.id);
            await files.writeFile(this.bot.handler.getPaths.files.dealQueue,this.queue.getAllElements(),true)
            try {
                await this.processDeal(deal);
            } catch (err) {
                logger.error(`Error processing deal ${deal.id}:`, err);
            }

            await delay(config.offer.delayBetweenOffers); 
        }

        this.processing = false;
    }

    private async processDeal(deal: DealDto): Promise<void> {
        const uniqReceive = deal.items_to_receive ? this.removeDuplicates(deal.items_to_receive) : [];

        // If items_to_give is defined, assign to uniqGive, else assign an empty array
        const uniqGive = deal.items_to_give ? this.removeDuplicates(deal.items_to_give) : [];
        let offer: TradeOffer;
        try {
            offer = await this.createOffer(deal.tradeUrl, uniqGive,uniqReceive);
        } catch (err) {
            const dealSt = new Deal(deal.id,undefined, undefined) 
                
            let error = err instanceof Error ? err : new Error(String(err))
            this.emit("offerCreation",error,undefined,dealSt);
            return;
        }

        await new Promise<void>((resolve) => {
            this.sendOfferRetry(offer, 0, (err, status) => {
                const dealSt= new Deal(deal.id,offer.id,status === 'sent' ? 'active': status )

                if (err) {
                    this.emit("offerCreation", err,undefined,dealSt);
                } else {
                    this.emit("offerCreation", null,dealSt.status, dealSt, offer);
                    offer.data('dealId', deal.id);
                }

                resolve();
            });
        });
    }
    
    public async declineOffer(offer:TradeOffer){
        await delay(config.offer.delayBetweenOfferDecline);
        offer.decline((err) => {
            if (err) {
                logger.error(`Error declining incoming offer #${offer.id}: `, err);
            } else {
                logger.info(`Successfully declined offer #${offer.id}`);
            }
        });
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
    

    public async createOffer(tradeUrl: string, items_to_give?: CEconItem[],items_to_receive?:CEconItem[] ): Promise<TradeOffer> {
        try {
            const offer = this.bot.tradeManager.createOffer(tradeUrl);
            offer.addTheirItems(items_to_receive ?? []);
            offer.addMyItems(items_to_give ?? [])
            const userDetails = await new Promise<{ me: TradeOffer.UserDetails, them: TradeOffer.UserDetails }>((resolve, reject) => {
                offer.getUserDetails((err, me, them) => {
                    
                    if (err) {
                        if(err.message.includes("This Trade URL is no longer valid for sending a trade offer to")){
                            return reject(new CustomError("Bad trade url", ERR.BadTradeUrl));
                        }
                       
                        reject(err);
                    } else {
                        resolve({ me, them });
                    }
                });
            });
            
    
            if (userDetails.me.escrowDays > 0) {
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
        return items.length > 0 && typeof items[0] === 'number' || typeof items[0] === 'string';
    }
    
    
    sendOfferRetry(offer: TradeOffer, attempts = 0, callback: (err: Error | null, status?: 'sent' | 'pending') => void): void {
        offer.send((err, status) => {
            attempts++;
            
            if (err) {
                if (
                    attempts > 5 ||
                    err.message.includes('can only be sent to friends') ||
                    err.message.includes('is not available to trade') ||
                    err.message.includes('maximum number of items allowed in inventory')
                ) {
                    if(err.cause === 'ItemServerUnavailable'){
                        return callback(new CustomError("Items server not available", ERR.ItemServerUnavailable))
                    }
                    return callback(err);
                }
                if(err.cause === 'TradeBan'){
                    return callback(new CustomError('User trade banned',ERR.TradeBan))
                }
                if(err.cause === 'OfferLimitExceeded'){
                    return callback(new CustomError("Offer Limit Exceeded", ERR.RateLimitExceeded))
                }
                if(err.cause === 'TargetCannotTrade'){
                    return callback(new CustomError("User cannot trade", ERR.TargetCannotTrade))
                }
                if(err.cause === "ItemServerUnavailable"){
                    return setTimeout(() => {
                        this.sendOfferRetry(offer, attempts, callback);
                    }, exponentialBackoff(attempts));
                }
                if (err.cause!==undefined) {
                    return callback(err);
                }
    
                if (err.eresult !== undefined) {
                    if (Number(err.eresult) === EResult.Revoked) {
                        return callback(new CustomError(`One or more of items do not exist in the inventories, refresh it`, ERR.InvalidItems));
                    }
                }
    
                if (err.message !== 'Not Logged In') {
                    // Retry after some time
                    return setTimeout(() => {
                        this.sendOfferRetry(offer, attempts, callback);
                    }, exponentialBackoff(attempts));
                }
                if(Number(err.eresult) === EResult.AccessDenied){
                    return callback(new CustomError("Access Denied", ERR.AccessDenied))
                }
                else{
                    return callback(new CustomError(err.message))
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
    getOfflineOffers(): Promise<TradeOffer[]> {
        const sentOffers: TradeOffer[] = [];
        const pollData = this.bot.tradeManager.pollData as PollData;
    
        return new Promise<TradeOffer[]>((resolve, reject) => {
            const offerPromises: Promise<void>[] = [];
    
            for (const offerId in pollData.offerData) {
                if (pollData.offerData.hasOwnProperty(offerId)) {
                    const offerData = pollData.offerData[offerId];
                    
                    if (!offerData.creationAck || !offerData.finalStateAck) {
                        // Create a promise for each getOffer call
                        const offerPromise = new Promise<void>((resolveOffer) => {
                            this.bot.tradeManager.getOffer(offerId, (err, offer) => {
                                if (err) {
                                    logger.error(`Error requesting offer #${offerId}`);
                                } else if (offer) {
                                    sentOffers.push(offer);
                                }
                                resolveOffer();
                            });
                        });
    
                        offerPromises.push(offerPromise);
                    }
                }
            }
    
            // Wait for all getOffer promises to resolve before resolving the main promise
            Promise.all(offerPromises).then(() => resolve(sentOffers));
        });
    }
    
    // getOfflineOffers(pollData: PollData): { [offerID: string]: OfferData } {
    //     const incompleteOffers: { [offerID: string]: OfferData } = {};
    //     // Iterate through all offers in offerData
    //     for (const offerID in pollData.offerData) {
    //         if (pollData.offerData.hasOwnProperty(offerID)) {
    //             const offer = pollData.offerData[offerID];
    //             // Check if either creationAck or finalStateAck is false or undefined
    //             if (!offer.creationAck || !offer.finalStateAck) {
    //                 incompleteOffers[offerID] = offer;
    //             }
    //         }
    //     }
    
    //     return incompleteOffers;
    // }
        
      
    // async getOfflineDepositErrors(onlyNonChecked: boolean = true): Promise<{ [depositId: number]: DepositErrorData }> {
    //     const path = this.bot.handler.getPaths.files.depositError;
    
    //     try {
    //         // Read the file asynchronously
    //         const data = await files.readFile(path, true);
    
    //         // Check if data exists and is in the expected format
    //         const errors: { [depositId: number]: DepositErrorData } = data.depositError || {};
    //         const filteredErrors: { [depositId: number]: DepositErrorData } = {};
    
    //         // Iterate over the errors object
    //         for (const depositId in errors) {
    //             if (errors.hasOwnProperty(depositId)) {
    //                 const errorData = errors[depositId];
                    
    //                 // Filter based on the onlyNonChecked flag
    //                 if (!onlyNonChecked || !errorData.serverAck) {
    //                     filteredErrors[parseInt(depositId, 10)] = errorData;
    //                 }
    //             }
    //         }
    
    //         return filteredErrors;
    
    //     } catch (err) {
    //         logger.warn('Error reading offline data:', err);
    //         return {}; // Return an empty object in case of an error
    //     }
    // }
    
    
    getActiveOffers(pollData: PollData) {
        const sent: string[] = [];
        const received: string[] = [];

        for (const id in pollData.sent) {
            if (!Object.prototype.hasOwnProperty.call(pollData.sent, id)) {
                continue;
            }
            const state = pollData.sent[id];
            if (
                state === TradeOfferManager.ETradeOfferState['Active'] ||
                state === TradeOfferManager.ETradeOfferState['CreatedNeedsConfirmation']
            ) {
                sent.push(id);
            }
        }

        for (const id in pollData.received) {
            if (!Object.prototype.hasOwnProperty.call(pollData.received, id)) {
                continue;
            }

            const state = pollData.received[id];
            if (state === TradeOfferManager.ETradeOfferState['Active']) {
                received.push(id);
            }
        }

        return { sent, received };
    }
    public acceptOfferRetry(offer:TradeOffer, attempts:number){
        return new Promise((resolve,reject)=> {
            offer.accept((err,status)=> {
                attempts++
                if (err) {
                    if (attempts > 5 || err.eresult !== undefined || err.cause !== undefined) {
                        return reject(err);
                    }

                    if (err.message !== 'Not Logged In') {
                        // We got an error getting the offer, retry after some time
                        return void timersPromises.setTimeout(exponentialBackoff(attempts)).then(() => {
                            resolve(this.acceptOfferRetry(offer, attempts));
                        });
                    }
                    void timersPromises.setTimeout(exponentialBackoff(attempts)).then(() => {
                        resolve(this.acceptOfferRetry(offer, attempts));
                    });
                }
                return resolve(status)

            })
           
        })
    }
}