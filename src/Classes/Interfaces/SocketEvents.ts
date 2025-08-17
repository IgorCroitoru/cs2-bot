import TradeOfferManager, { MEconItemExchange } from "steam-tradeoffer-manager";
import DealDto from "../Dtos/DealDto";
import CEconItem from "steamcommunity/classes/CEconItem";
import { ExtendedMEconItemExchange } from "./ExtendedItem";
import { TaskQueueResponse } from "../AbstractTaskQueue";
import { InventoryItemInfo } from "../Inspect/GameData";
import { BotStatsDelta, BotStatsSnapshot } from "./StatsSnapshot";
export interface InventoryQueueResponse {
    status: InventoryStatus;
    error?: {
        message: string,
        retry_after?: number,
    };
    message?: string;
    queue_position?: number;
    estimated_wait?: number;
    inventory?: CEconItem[];
}
export type InventoryStatus = 'ok' | 'error';

export interface OutgoingActiveOffersPollData{
  offers: {[offerId: string]: {
    steamId64?: string
  }};
}
// export type StatusType = 'needsConf' | 'pending' | 'assigned' | 'active' | 'accepted' | 'cancelled' | 'declined' | 'failed';

export type InitQuery = {
    username?: string
    id64?:string
    ready?:boolean
}

export type OfferMetadata = {
  dealId?: number
}
export type NewDealPayload =  DealDto

export interface ResponseCallback<T = any> {
    (response?: ResponseCallbackData<T>): void;
}

// Define callback data type
export interface ResponseCallbackData<Data = any> {
    status: 'ok' | 'error';
    error?: any
    data?: Data
}

export interface ResponseInventoryCallbackData extends InventoryQueueResponse {}
export interface ResponseCallbackInventory {
    (response: ResponseInventoryCallbackData): void;
}

export interface OfferChangeStatePayload<Metadata = any> {
  /**
   * A value from the {@link TradeOfferManager.ETradeOfferState} enum
  */
  state: number,
  trade_offer_finished_at: number | null
  offerId: string,
  sent?: MEconItemExchange[]
  received ?: ExtendedMEconItemExchange[]
  metadata?: Metadata
}
export interface OfferCreationPayload<Metadata = any> {
  error?: any,
  offerId?: string,
  /**
  * A value from the {@link TradeOfferManager.ETradeOfferState} enum
  */
  state?: number,
  trade_offer_created_at:number | null
  trade_offer_expiry_at:number | null
  metadata?: Metadata

}
// export interface ResponseCallbackOfflineData{
//   (info: ResponseCallbackData, data: OfflineData): void
// }
// export interface DealCreationPayload {
//   deal: DealDto,
//   callback?: ResponseCallback
// }

// Inventory Events
export interface InventorySocketEventsIngoing {
  "inventoryFetch": (steamId: string, callback: ResponseCallback<TaskQueueResponse>) => void;
  "pauseInventory": (paused: boolean, cause: string | null, pauseEnd: number, callback?: ResponseCallback) => void;
  [key: string]: (...args:any[]) => void;
}

export interface InventorySocketEventsOutgoing {
  "inventoryFetched": (steamId: string, error: any, status: InventoryStatus, inventory: CEconItem[]) => void;
  "inventoryPaused": (paused: boolean, cause: string | null, pauseEnd: number) => void;
   [key: string]: (...args:any[]) => void;
}

// Trade Events
export interface TradeSocketEventsIngoing {
  "newDeal": (payload: NewDealPayload, callback: ResponseCallback<TaskQueueResponse>) => void;
  "pauseTrade": (paused: boolean, cause: string | null, pauseEnd: number, callback?: ResponseCallback) => void;
  "requestInventoryItemInfo": (assetId: string, callback: ResponseCallback<InventoryItemInfo>) => void;
  [key: string]: (...args:any[]) => void;
}

export interface TradeSocketEventsOutgoing {
  // offerError: (dealId: number, error: any) => void;
  "offerCreation": (payload: OfferCreationPayload, callback: ResponseCallback) => void;
  "offerChangedState": (payload: OfferChangeStatePayload, callback: ResponseCallback) => void;
  "tradesPaused": (paused: boolean, cause: string | null, pauseEnd: number) => void;
  "inventoryItemInfo": (item: InventoryItemInfo, callback: ResponseCallback) => void;
   [key: string]: (...args:any[]) => void;
}

// Bot Events
export interface BotSocketEventsIngoing {
  "pauseBot": (paused: boolean, pauseEnd: number, cause: string | null, callback?: ResponseCallback) => void;
   [key: string]: (...args:any[]) => void;
}

export interface BotSocketEventsOutgoing {
  // offlineData: (callback: ResponseCallbackOfflineData) => void;
  "ready": (ready: boolean) => void;
  "botPaused": (paused: boolean, cause: string | null, pauseEnd: number) => void;
  "activeOffersPollData": (payload: OutgoingActiveOffersPollData, callback?: ResponseCallback) => void;
   [key: string]: (...args:any[]) => void;
}

export interface StatEventsOutgoing {
  "botStats": (snapshot: BotStatsSnapshot) => void;
  "botStatsDelta": (delta: BotStatsDelta) => void;
  [key: string]: (...args:any[]) => void;
}
export interface SocketEvents extends 
  InventorySocketEventsIngoing,
  InventorySocketEventsOutgoing,
  TradeSocketEventsIngoing,
  TradeSocketEventsOutgoing,
  BotSocketEventsIngoing,
  StatEventsOutgoing,
  BotSocketEventsOutgoing {
     [key: string]: (...args:any[]) => void;
  }

export interface IngoingEvents extends 
  InventorySocketEventsIngoing,
  TradeSocketEventsIngoing,
  BotSocketEventsIngoing {
     [key: string]: (...args:any[]) => void;
  }

export interface OutgoingEvents extends 
  InventorySocketEventsOutgoing,
  TradeSocketEventsOutgoing,
  StatEventsOutgoing,
  BotSocketEventsOutgoing {
     [key: string]: (...args:any[]) => void;
  }
