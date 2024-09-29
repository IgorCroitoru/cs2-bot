import { SocketClient } from "../socket";
import { Bot } from "./Bot";

export class BotEvents{

    constructor(private readonly bot:Bot,readonly socket: SocketClient){

    }
    bindEventHandlers(){
        this.bot.on('ready',(ready:boolean)=>{
            if(this.socket.isConnected()){
                this.socket.emit("ready",ready)
            }
           
        })
    }
}