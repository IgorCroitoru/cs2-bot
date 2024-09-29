import CEconItem from "steamcommunity/classes/CEconItem";
import { getInspectUrl,getNameTag, getStickers } from "../../utils";
export class ItemInv{
    ceconitem: CEconItem
    name: string
    market_hash_name: string
    rarity: string
    type: string
    inspect_url: string | null
    icon_url:string | null
    name_tag:string | null
    stickers:Sticker[]| null
    color: string
    assetid: string
    exterior: string | null
    st: boolean = false
    souvenir: boolean = false
    constructor(item:CEconItem, owner?:string){
        this.ceconitem = item
        this.name = item.name
        this.market_hash_name = item.market_hash_name
        this.assetid = item.assetid.toString()
        this.rarity = item.getTag("Rarity").name,
        this.color = item.getTag("Rarity").color
        this.exterior = item.getTag('Exterior').name
        this.type = item.getTag("Type") === null ? item.getTag("Type").name : null
        this.inspect_url = owner? getInspectUrl(item.actions,owner, Number(item.assetid)): null
        this.st = this.market_hash_name.includes('StatTrak™') ? true : false
        this.souvenir = this.market_hash_name.includes('Souvenir') ? true : false
        this.name_tag = getNameTag(item.fraudwarnings)
        this.icon_url = item.getImageURL()
        this.stickers = getStickers(item.descriptions)
    }
   
}
export class Sticker{
    name:string
    icon_url: string
    constructor(name: string, icon_url: string){
        this.name = name
        this.icon_url = icon_url
    }
}
export type ItemAsset = {
    assetid: number | string
}