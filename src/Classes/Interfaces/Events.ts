import TradeOffer from "steam-tradeoffer-manager/lib/classes/TradeOffer";
import CEconItem from "steamcommunity/classes/CEconItem";
import Deal from "../Deal";
import { InventoryStatus } from "../Inventory";

export type TradeEvents = {
    offerCreation:[error:Error | null, deal:Deal, offer?:TradeOffer];
}
export type InventoryEvents = {
    inventoryFetched:[steamId: string,  error:any, status: InventoryStatus, inventory: CEconItem[], requestId?: string]
}
export type BotEvents = {
    ready:[ready:boolean]
    paused:[paused:boolean, cause: string | null, pauseEnd: number]
}
