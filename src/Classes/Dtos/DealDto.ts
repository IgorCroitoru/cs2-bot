import CEconItem from "steamcommunity/classes/CEconItem"
import SteamID from "steamid"
export default class DealDto{
    public id:number
    public tradeUrl: string
    public userId64: string
    public items_to_give?: CEconItem[]
    public items_to_receive?: CEconItem[]
    constructor(id:number, tradeUrl:string, userID64: string, items_to_receive?:CEconItem[], items_to_give?:CEconItem[]){
        this.id = id
        this.tradeUrl = tradeUrl
        this.userId64 = userID64
        this.items_to_receive = items_to_receive
        this.items_to_give = items_to_give
    }
}
