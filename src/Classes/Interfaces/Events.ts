import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import  { DealCreationStatus} from "../Deal";
import CEconItem from "steamcommunity/classes/CEconItem";
import { StatusType } from "./SocketEvents";
import Deal from "../Deal";

export interface TradeEvents {
    offerCreation:[error:Error | null, status: DealCreationStatus, deal:Deal,offer?:TradeOffer];
    offerStateChange:[status:StatusType, offerId:string, offer?: TradeOffer]
    // Add more events as needed
}
export interface InventoryEvents{
    inventoryFetch:[error:any|null, inventory:CEconItem[]]
}
export interface BotEvents{
    ready:[ready:boolean]
}
