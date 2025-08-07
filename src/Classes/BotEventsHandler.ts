import { Socket } from "socket.io-client";
import { Bot } from "./Bot";
import { BotSocketEventsIngoing, BotSocketEventsOutgoing } from "./Interfaces/SocketEvents";

export class BotEvents{

    constructor(private readonly bot:Bot,readonly socket: Socket<BotSocketEventsIngoing, BotSocketEventsOutgoing>){
        this.bindEventHandlers();

    }
    bindEventHandlers(){
        //outgoing events
        this.bot.on('ready',(ready:boolean)=>{
            if(this.socket.connected){
                this.socket.emit("ready",ready)
            }
           
        })
        this.bot.on('paused', (paused, cause, pauseEnd) => {
            if (this.socket.connected) {
                this.socket.emit('botPaused', paused, cause, pauseEnd);
            }
        });

        //incoming events
        this.socket.on("pauseBot", (paused, pauseEnd, cause, callback) => {
            this.bot.pause(paused, pauseEnd, cause);     
            callback?.({
                status:"ok"
            })   
            // callback({ status: 'ok' });
        });
    }
}