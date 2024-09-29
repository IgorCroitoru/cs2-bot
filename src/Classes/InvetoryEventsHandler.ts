import { Socket } from "socket.io-client";
import Inventory from "./Inventory";
import { SocketClient } from "../socket";
import { ResponseCallbackInventory } from "./Interfaces/SocketEvents";
import { logger } from "../../logger";

export default class InventoryProcessor{
    constructor(readonly inventory:Inventory, readonly socket: SocketClient){
        
    }
    async start(){
        this.bindEvents()
    }
    private bindEvents(){
      
        this.socket.on("inventoryFetch",async (steamId,callback)=>{
              this.inventory.enqueue(async(taskCallback)=>{
                try{
                    logger.info(`Inventory request for ${steamId}`)
                    const inv = await this.inventory.getInventory(steamId)
                    callback({status:'ok'}, inv)
                    taskCallback()
                }catch(err){
                    callback({status:"error", error: err}, [])
                    taskCallback(err)
                }
            })
        })
    }
}