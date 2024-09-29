import GlobalOffensive from "globaloffensive";
import { MEconItemExchange } from "steam-tradeoffer-manager";
import CEconItem from "steamcommunity/classes/CEconItem";

export interface ExtendedMEconItemExchange extends MEconItemExchange {
    paint_wear?: number
    paint_index?: number
    paint_seed?: number
    stickers?: GlobalOffensive.Sticker[]
    tradable_after? : Date
}

export interface ExtendedEconItem extends CEconItem{
    paint_wear?: number
    paint_index?: number
    paint_seed?: number
    stickers?: GlobalOffensive.Sticker[]
    tradable_after? : Date
}