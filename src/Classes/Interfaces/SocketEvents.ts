import { DealCreationStatus } from "../Deal";
import { MEconItemExchange } from "steam-tradeoffer-manager";
import { OfflineData } from "./PollData";
import DealDto from "../Dtos/DealDto";
import CEconItem from "steamcommunity/classes/CEconItem";
import { ExtendedMEconItemExchange } from "./ExtendedItem";

export type StatusType = 'needsConf' | 'pending' | 'assigned' | 'active' | 'accepted' | 'cancelled' | 'declined' | 'failed';

export type InitQuery = {
    username?: string
    id64?:string
    ready?:boolean
}

export default interface IDealCreation{
  id: number
  offerId?: string
  status: DealCreationStatus
  //error: Error | null
}
export type NewDealPayload =  DealDto| DealDto[];

export interface ResponseCallback {
    (response?: ResponseCallbackData): void;
}

// Define callback data type
export interface ResponseCallbackData {
    status: 'ok' | 'error';
    error?: any
}
export interface ResponseCallbackInventory {
    (info: ResponseCallbackData, inventory: CEconItem[]): void;
}

export interface OfferChangeStatePayload {
  state: StatusType,
  trade_offer_finished_at: number | null
  offerId: string,
  sent?: MEconItemExchange[]
  received ?: ExtendedMEconItemExchange[]
}
export interface OfferCreationPayload {
  error: any,
  status: DealCreationStatus,
  deal: IDealCreation,
  trade_offer_created_at:number | null
  trade_offer_expiry_at:number | null

}
export interface ResponseCallbackOfflineData{
  (info: ResponseCallbackData, data: OfflineData): void
}
export interface DealCreationPayload {
  deal: DealDto,
  callback?: ResponseCallback
}

export interface SocketEvents{
    offlineData:[callback:ResponseCallbackOfflineData]
    newDeal:[NewDealPayload, callback:ResponseCallback]
    offerCreation:[OfferCreationPayload, callback:ResponseCallback]
    offerChangedState:[OfferChangeStatePayload, callback?:ResponseCallback]
    inventoryFetch:[steamId: string,callback:ResponseCallbackInventory]
    offerError:[dealId: number,error:any]
    ready:[ready:boolean]
}
