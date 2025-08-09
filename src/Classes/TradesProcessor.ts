import {
  IngoingEvents,
  OfferChangeStatePayload,
  OfferCreationPayload,
  OfferMetadata,
  OutgoingEvents,
  ResponseCallbackData,
} from "./Interfaces/SocketEvents";
import { logger } from "../../logger";
import {  PollData } from "./Interfaces/PollData";
// import { mainServerAck } from "./Interfaces/PollData";
import { CustomError } from "./CustomError";
import { delay, ensureArray } from "../utils";
import config from "../../config";
import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import { ExtendedMEconItemExchange } from "./Interfaces/ExtendedItem";
import TradeOfferManager, { MEconItemExchange } from "steam-tradeoffer-manager";
import { NewTrades } from "./NewTrades";
import { Socket } from "socket.io-client";
import { OutboxQueue } from "./OutboxQueue";
import { TaskQueueResponse } from "./AbstractTaskQueue";
export default class TradesProcessor {
  constructor(
    private readonly trades: NewTrades,
    private readonly socket: Socket<IngoingEvents,OutgoingEvents>,
    private readonly outbox: OutboxQueue
  ) {}

  async start() {
    this.bindEvents();
    this.setupHandlers();
    //loading queued trades from file
    await this.trades.loadQueueState();
    
    this.trades.bindEvents();
    
  }
  private setupHandlers() {
      // Register multiple handlers at once
    
      this.outbox.registerHandlers({
      
        offerCreation: async (payload) => {
          try {
            const response = await new Promise<ResponseCallbackData>((resolve, reject) => {
              this.socket.volatile.timeout(config.socket.ackTTL).emit("offerCreation", payload, (err, response) => {
                if (err) {
                  reject(err); 
                } else if (response) {
                  resolve(response); 
                } else {
                  reject(new Error("Unexpected response format"));
                }
              });
            });
          return response;
        } catch (error) {
          throw error;
        }
        },
  
        offerChangedState: async (payload) => {
          try {
            const response = await new Promise<ResponseCallbackData>((resolve, reject) => {
              this.socket.volatile.timeout(config.socket.ackTTL).emit("offerChangedState", payload, (err, response) => {
                if (err) {
                  reject(err); 
                } else if (response) {
                  resolve(response); 
                } else {
                  reject(new Error("Unexpected response format"));
                }
              });
            });
          return response;
        } catch (error) {
          throw error;
        }
        },
      });
    }
  bindEvents() {
    //bot events
    this.trades.bot.on("paused", (paused, cause, pauseEnd) => {
      if(!paused && !this.trades.isPaused){
        this.trades.resume();
      }
    })
    this.trades.bot.on("ready", (ready) => {
      if(ready && !this.trades.bot.isPaused && !this.trades.isPaused){
        this.trades.resume();
      }
    })
    //SOCKETS EVENTS BINDING
    this.socket.on("connect", async () => {
      this.outbox.resume();
      this.outbox.retryAllTimedOutEvents();
      logger.info("Socket connected")
      logger.debug("Outbox resumed due to socket connect");
      
    });
    this.socket.on("disconnect", (reason, description)=>{
      logger.info(`Socket disconnected: ${reason} - ${description}`);
      this.outbox.pause();
      logger.info("Outbox paused due to socket disconnect");
    })
    
    this.socket.on("pauseTrade", (paused, cause, pauseEnd) => {
      logger.info(`Pausing trades processor: ${paused} - ${cause}`);
      if (paused) {
        this.trades.pause(pauseEnd - Date.now(), cause);
      }
      else{
        this.trades.resume();
      }
    });
    this.socket.on("newDeal", async (deal, callback) => {
      try {
       deal.items_to_give = deal.items_to_give ? ensureArray(deal.items_to_give) : [];
       deal.items_to_receive = deal.items_to_receive ? ensureArray(deal.items_to_receive) : [];
       const result = await new Promise<TaskQueueResponse>((resolve) => {
        this.trades.enqueue(deal, (response) => {
          resolve(response);
        });
      });
      if(result.status === "queued"){
        callback({
          status: "ok",
          data: result
        })
      }
      else {
        callback({
          status: "error",
          error: result.error,
          data: result
        });
      }
      } catch (e) {
        logger.error(`Error processing new deal ${deal.id}:`, e);
         if (e instanceof CustomError) {
          callback({
            status: "error",
            error: {
              eresult: e.eresult,
              message: e.message,
              cause: e.cause,
            },
          });
        } else {
          callback({ 
            status: "error", 
            error: {
              message: e instanceof Error ? e.message : String(e),
            }
          });
        }
      }
    });

    //TRADES EVENTS BINDING
    this.trades.on("offerCreation", async (error, deal, offer) => {
      if (offer) {
        const created_at = Math.floor(Date.now() / 1000);
        const expiry_at =
          Math.floor(Date.now() / 1000) + config.offer.cancelTime;
        logger.info(
          `Offer #${offer.id} was sent to ${offer.partner.getSteamID64()}`
        );
        offer.data("trade_offer_created_at", created_at);
        offer.data("trade_offer_expiry_at", expiry_at);
        try {
          const data: OfferCreationPayload<OfferMetadata> = {
            metadata:{
              dealId: deal.id
            },
            offerId: offer.id,
            error: error,
            state: offer.state,
            trade_offer_created_at: created_at,
            trade_offer_expiry_at: expiry_at,
          };
          this.outbox.addEvent("offerCreation", data)
        } catch (e) {
          logger.error(`Unexpected error while emitting offer creation event for deal ${deal.id}:`, e);
        }
      } else if (error) {
        logger.error(
          `Error while creating offer for deal ${deal.id}: ${error.message}`
        );
        try {
          //emitting error
          const data: OfferCreationPayload<OfferMetadata> = {
            metadata: {
              dealId: deal.id
            },
            error: error,
            trade_offer_expiry_at: null,
            trade_offer_created_at: null,
          };
          this.outbox.addEvent("offerCreation", data)
          //..............
        } catch (e) {
           logger.error(`Unexpected error while emitting offer [deal id: ${deal.id}] creation error:`, e);
        }
      } else {
        logger.error(
          `Offer creation failed for deal ${deal.id} without an error object.`
        );
      }
    });

    //TRADE MANAGER EVENTS
    this.trades.bot.tradeManager.on("newOffer", (offer) => {
      logger.info(
        `New offer #${offer.id} from ${offer.partner.getSteamID64()}`
      );
      logger.info(`Declining offer #${offer.id}...`);
      this.trades.queueOfferDecline(offer);
    });

    this.trades.bot.tradeManager.on(
      "sentOfferChanged",
      async (offer, oldState) => {
        logger.info(
          `Sent offer #${offer.id} state changed: ${oldState} -> ${offer.state}`
        );
        const pollData = this.trades.bot.tradeManager.pollData as PollData;
        if (offer.id !== undefined) {
          const offerData = pollData.offerData[offer.id];
          

          let payload: OfferChangeStatePayload<OfferMetadata> = {
            metadata:{ dealId: offerData.dealId },
            state: offer.state,
            offerId: offer.id,
            trade_offer_finished_at: this.trades.isOfferFinished(offer.state)
              ? Math.floor(Date.now() / 1000)
              : null,
          };
          offer.data(
            "trade_offer_finished_at",
            payload.trade_offer_finished_at
          );

          if (offer.state === 3) {
            const value = await this.getExchangeDetails(offer);
            logger.info(`Offer #${offer.id} status is: ${value.status}`);
            if (value.error) {
              logger.warn(
                `Error occurred when requesting offer[#${offer.id}] exchange details: ${value.error}`
              );
            } else {
              payload.received = value.received;
              payload.sent = value.sent;
            }
          }
          this.outbox.addEvent("offerChangedState", payload)
         
        }
      }
    );
  }

  getExchangeDetails = (offer: TradeOffer) => {
    return new Promise<{
      error: Error | null;
      status: TradeOfferManager.ETradeStatus;
      tradeInitTime: Date;
      received: ExtendedMEconItemExchange[];
      sent: MEconItemExchange[];
    }>((resolve) => {
      offer.getExchangeDetails((err, status, tradeInitTime, received, sent) => {
        const extendedReceived = received as ExtendedMEconItemExchange[];
        if (received.length > 0) {
          const gameInventory = this.trades.bot.csClient.inventory;
          extendedReceived.forEach((i) => {
            gameInventory?.forEach((g) => {
              if (i.new_assetid?.toString() === g.id) {
                (i.tradable_after = g.tradable_after),
                  (i.paint_index = g.paint_index),
                  (i.paint_seed = g.paint_seed),
                  (i.paint_wear = g.paint_wear);
              }
            });
          });
        }
        resolve({
          error: err,
          status,
          tradeInitTime,
          received: extendedReceived,
          sent,
        });
      });
    });
  };
}
