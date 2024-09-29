import {getSocketClient,setupSocketClient,SocketClient }from "../socket";
import Trades from "./Trades";
import {NewDealPayload, OfferChangeStatePayload, OfferCreationPayload, ResponseCallback, ResponseCallbackData} from "./Interfaces/SocketEvents";
import { logger } from "../../logger";
import {  DealErrorData, PollData } from "./Interfaces/PollData";
// import { mainServerAck } from "./Interfaces/PollData";
import { CustomError } from "./CustomError";
import { delay, ensureArray, getState} from "../utils";
import config from "../../config";
import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import * as files from "../lib/files"
import DealDto from "./Dtos/DealDto";
import { ExtendedMEconItemExchange } from "./Interfaces/ExtendedItem";
import fs from 'fs'
import TradeOfferManager, { MEconItemExchange } from "steam-tradeoffer-manager";
import writeFile from "write-file-atomic";
export default class TradesProcessor{
    constructor(private readonly trades:Trades, private readonly clientSocket: SocketClient){
        
    }

    async start(){
        this.bindEvents()
        const dataDeals = await files.readFile(this.trades.bot.handler.getPaths.files.dealQueue, true)
        const dataDealsError = await files.readFile(this.trades.bot.handler.getPaths.files.dealError, true)
        const deals = (Array.isArray(dataDeals)) ? dataDeals as DealDto[]: []
        this.trades.dealError = this.trades.isValidDealErrorData(dataDealsError) ? dataDealsError as { [dealId: number]: DealErrorData }: {}
        this.trades.bindEventHandler()
        deals.forEach(async d=> {
            await this.trades.enqueue(d)
        })
        
    }
    bindEvents(){
        //SOCKETS EVENTS BINDING
        this.clientSocket.socket.on("connect", async ()=>{
            // awaiting a delay for sending all buffered messages in socket queue
            // is made for avoiding sending duplicates 
            logger.debug('Awaiting sending deals from buffer')
            await delay(10000) 
            logger.debug('Starting sending offline data')
            this.emitOfflineData()
        })
        this.clientSocket.on("newDeal", async (deal,callback)=>{
            try {
                if(Array.isArray(deal)){
                    deal.forEach(async d=>{
                        d.items_to_give = d.items_to_give ? ensureArray(d.items_to_give): []
                        d.items_to_receive = d.items_to_receive ? ensureArray(d.items_to_receive): []
                        await this.trades.enqueue(d)
                    })
                }
                else{
                    deal.items_to_give = deal.items_to_give ? ensureArray(deal.items_to_give): []
                    deal.items_to_receive = deal.items_to_receive ? ensureArray(deal.items_to_receive): []
                    await this.trades.enqueue(deal)
                }

                
                
                callback({ status: 'ok' });
            } catch (e) {
                logger.error(`Error processing deal ${deal}}:`, e);
                if(e instanceof CustomError){
                    callback({ status: 'error', error:{
                        eresult:e.eresult,
                        message:e.message,
                        status_code: e.statusCode,
                        cause:e.cause
                    } });
                }
                else{
                    callback({ status: 'error', error:e });
                }
                
            }
        });

     
        //TRADES EVENTS BINDING
        this.trades.on("offerCreation", async (error, status, deal, offer) => {
           
            if (offer) {
                const created_at = Math.floor(Date.now() / 1000)
                const expiry_at = Math.floor(Date.now() / 1000) + config.offer.cancelTime
                logger.info(`Offer #${offer.id} was sent to ${offer.partner.getSteamID64()}`);
                offer.data("trade_offer_created_at",created_at)
                offer.data("trade_offer_expiry_at", expiry_at  )
                try {
                    const data:OfferCreationPayload = {
                        error:error,
                        status:status,
                        deal,
                        trade_offer_created_at: created_at,
                        trade_offer_expiry_at: expiry_at
                    }
                    // setting false from here in case that program crashes when awaiting for response
                    // so when starting again to have it as unacknowledged 
                    offer.data("creationAck", false) 

                    await this.emitOfferCreation(data, (response) => {
                        offer.data("creationAck", true);
                      });
                        
                } catch (e) {
                    if(e instanceof Error && e.message.includes('Timeout')){
                        logger.warn(`No ack from server for offer: ${offer.id}`);
                        offer.data("creationAck", false);
                    }
                    
                }
            } else if (error) {
                logger.error(`Error while creating offer for deal ${deal.id}: ${error.message}`);
                const offerError:DealErrorData = {
                    dealId:deal.id,
                    error,
                    timestamp: Math.floor(Date.now() / 1000),
                }
                try {
                    //emitting error
                    const data:OfferCreationPayload = {
                        error:error,
                        status:status,
                        deal,
                        trade_offer_expiry_at: null,
                        trade_offer_created_at: null
                    }
                    this.trades.dealError[deal.id] = offerError
                    await files.writeFile(this.trades.bot.handler.getPaths.files.dealError, this.trades.dealError,true)
                    await this.emitOfferCreation(data, async (response) => {
                        if(this.trades.dealError.hasOwnProperty(deal.id)){
                            delete this.trades.dealError[deal.id]
                            await files.writeFile(this.trades.bot.handler.getPaths.files.dealError, this.trades.dealError,true)
                        }else{
                            logger.warn(`Deal error dict does not has deal id #${deal.id}`)
                        }
                      });
                  //..............
                    
                } catch (e) {
                    if(e instanceof Error && e.message.includes('Timeout')){
                        logger.warn(`No ack from server for deal error: ${deal.id}`);
                    //TODO BETTER. LIKE data.offer()
                    //this.trades.bot.handler.onDepositError(offerError)
                    }
                    else{
                        logger.error(`Error while emitting offer creation error: ${e}`)
                    }
                }
            } else {
                logger.error(`Offer creation failed for deal ${deal.id} without an error object.`);
            }
        });
        
        //TRADE MANAGER EVENTS
        this.trades.bot.tradeManager.on("newOffer", (offer)=>{
            logger.info(`New offer #${offer.id} from ${offer.partner.getSteamID64()}`)
            logger.info(`Declining offer #${offer.id}...`)
            this.trades.declineOffer(offer)
        })

        
        this.trades.bot.tradeManager.on("sentOfferChanged",async (offer,oldState)=>{
            logger.info(`Sent offer #${offer.id} state changed: ${oldState} -> ${offer.state}`)
            const state = getState(offer.state)
            const pollData = this.trades.bot.tradeManager.pollData as PollData
            if(offer.id!==undefined){
                if(!pollData.offerData[offer.id!].creationAck){
                    try{
                        offer.data("creationAck", false)
                    await this.emitOfferCreation({
                        status: "active",
                        trade_offer_created_at: pollData.offerData[offer.id].trade_offer_created_at!,
                        trade_offer_expiry_at: pollData.offerData[offer.id].trade_offer_created_at!,
                        error:null,
                        deal:{
                            offerId: offer.id,
                            status:"active",
                            id: pollData.offerData[offer.id].dealId!
                        }
                    },(response)=>{
                        offer.data("creationAck", true)
                    })
                }
                catch(e){
                    if(e instanceof Error && e.message.includes('Timeout')){
                        logger.warn(`No ack from server for offer: ${offer.id}`);
                        offer.data("creationAck", false);
                    }
                }
                }
                
              
            
                let payload:OfferChangeStatePayload = {
                    state:state,
                    offerId:offer.id,
                    trade_offer_finished_at: ['accepted','declined','cancelled','failed'].includes(state) 
                    ? Math.floor(Date.now() / 1000)
                    : null
                }
                offer.data("trade_offer_finished_at", payload.trade_offer_finished_at)
                
                if(offer.state === 3){
                        const value = await this.getExchangeDetails(offer)
                        logger.info(`Offer #${offer.id} status is: ${value.status}`)
                        if(value.error){
                            logger.warn(`Error ocurred when requesting offer[#${offer.id}] exchange details: ${value.error}`)
                        }
                        else{
                            console.log('da')
                            payload.received = value.received
                            payload.sent = value.sent
                        }
                    
                }
                console.log(payload)
                offer.data('finalStateAck',false)
                this.clientSocket.emitWithTimeout(config.socket.ackTTL,'offerChangedState',payload)
                    .then(response=>{
                       
                        offer.data('finalStateAck',true)
                        
                    })
                    .catch(err=>{
                        
                        
                        logger.error(`Error ocurred at sentOfferChange for offer ${payload.offerId}`, err)
                        if(err instanceof Error){
                            if(err.message === 'Timeout'){
                                offer.data('finalStateAck',false)
                            }
                        }
                    })
             
                }
                
        })
      
    }

    private async emitOfflineData(){
        const keysToDelete: string[] = [];
        const promises: Promise<void>[] = []; // Array to hold promises for each emitOfferCreation
    
        for (const dealId in this.trades.dealError) {
            if (this.trades.dealError.hasOwnProperty(dealId)) {
                // Create a promise for emitOfferCreation
                const promise = new Promise<void>((resolve) => {
                    try{
                    this.emitOfferCreation({
                        deal: {
                            id: Number(dealId),
                            status: undefined,
                        },
                        status: undefined,
                        error: this.trades.dealError[dealId].error,
                        trade_offer_created_at: null,
                        trade_offer_expiry_at: null,
                    }, async (response) => {
                        keysToDelete.push(dealId);
                        const filteredDepositsError = Object.fromEntries(
                            Object.entries(this.trades.dealError).filter(([key]) => key !== dealId)
                        );
                        await files.writeFile(this.trades.bot.handler.getPaths.files.dealError, filteredDepositsError, true);
                        logger.debug(`Offline deal #${dealId} error sent`)
                        resolve(); // Resolve the promise when the write operation is complete
                    });
                }
                catch (e) {
                    if(e instanceof Error && e.message.includes('Timeout')){
                    logger.warn(`No ack from server for deal error: ${dealId}`);
                    }
                }
                });
    
                promises.push(promise); // Add the promise to the array
            }
        }
    
        // Wait for all promises to resolve
        await Promise.all(promises);
    
        // Delete keys from dealsError after all emitOfferCreation calls are completed
        keysToDelete.forEach(k => {
            delete this.trades.dealError[Number(k)];
        });
        const offOffers = await this.trades.getOfflineOffers()
        const pollData = this.trades.bot.tradeManager.pollData as PollData
        offOffers.forEach(async (off)=>{
            const poll = pollData.offerData[off.id!]
            if(poll.creationAck && poll.finalStateAck === false){
                const payload: OfferChangeStatePayload = {
                    state: getState(pollData.sent[off.id!]),
                    trade_offer_finished_at: poll.trade_offer_finished_at!,
                    offerId: off.id!
                }
                off.data('finalStateAck',false)
                if(off.state === 3){
                    const value = await this.getExchangeDetails(off)
                    // logger.info(`Offer #${off.id} status is: ${value.status}`)
                    if(value.error){
                        logger.warn(`Error ocurred when requesting offer[#${off.id}] exchange details: ${value.error}`)
                    }
                    else{
                        payload.received = value.received
                        payload.sent = value.sent
                    }
                
            }
                this.clientSocket.emitWithTimeout(config.socket.ackTTL,"offerChangedState",payload)
                    .then(response=>{
                        off.data("finalStateAck", true)
                        logger.debug(`Offline deal #${poll.dealId} finalStateAck sent`)
                    })
                    .catch(error=>{
                        if(error.message.includes('Timeout')){
                            off.data("finalStateAck", false)
                            logger.debug(`Offline deal #${poll.dealId} finalStateAck failed to send`)
                        }
                    })
                // this.clientSocket.emit("offerChangedState",{
                //     state: getState(pollData.sent[off.id!]),
                //     trade_offer_finished_at: poll.trade_offer_finished_at!,
                //     offerId: off.id!
                // }, (response)=>{
                //     off.data("finalStateAck", true)
                // })
            }
            if(!poll.creationAck){
                const data:OfferCreationPayload = {
                    error: null,
                    status: "active",
                    deal: {
                        id:poll.dealId!,
                        status: "active",
                    },
                    trade_offer_created_at: poll.trade_offer_created_at!,
                    trade_offer_expiry_at: poll.trade_offer_expiry_at!
                }
                try{
                    off.data("creationAck", false);
                    await this.emitOfferCreation(data,(response)=>{
                        logger.debug(`Offline deal #${poll.dealId} creationAck sent`)
                        off.data("creationAck", true)
                    })
                }
                catch(e){
                    if(e instanceof Error && e.message.includes('Timeout')){
                        logger.warn(`No ack from server for offer: ${off.id}`);
                        off.data("creationAck", false);
                    }
                }
               
            }
        })
    }
    private emitOfferCreation(
        data:OfferCreationPayload,
        callback: (response: any) => void
      ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Timeout'));
          }, config.socket.ackTTL);
    
          this.clientSocket.emit('offerCreation', data, (response: any) => {
            clearTimeout(timeoutId);
            callback(response);
            resolve();
          });
        });
      }
    
    getExchangeDetails = (offer: TradeOffer)=>{
        return new Promise<{
            error: Error | null,
            status: TradeOfferManager.ETradeStatus,
            tradeInitTime: Date,
            received : ExtendedMEconItemExchange[],
            sent: MEconItemExchange[]
        }>((resolve)=>{
            offer.getExchangeDetails((err,status,tradeInitTime,received,sent)=>{
                const extendedReceived = received as ExtendedMEconItemExchange[]
                if(received.length > 0){
                    const gameInventory = this.trades.bot.csClient.inventory
                    extendedReceived.forEach(i=>{
                        gameInventory?.forEach(g=>{
                            if(i.new_assetid?.toString() === g.id){
                                i.tradable_after = g.tradable_after,
                                i.paint_index = g.paint_index,
                                i.paint_seed = g.paint_seed,
                                i.paint_wear = g.paint_wear
                            }
                        })
                    })
                }
                resolve({
                    error: err,
                    status, 
                    tradeInitTime,
                    received: extendedReceived,
                    sent
                })
            })
        })
    }
}