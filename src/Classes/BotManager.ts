import { EPersonaState } from 'steam-user';
import { logger } from '../../logger';
import {Bot} from './Bot'
import IOptions from './Interfaces/IOptions'
import { waitForWriting } from '../lib/files';
import async from 'async'
export default class BotManager{

    private stopRequested = false;
    private stopping = false;
    public bot:Bot|null = null
    private exiting = false;
    constructor(){
        
    }
    get isStopping(): boolean {
        return this.stopping || this.stopRequested;
    }

    get isBotReady(): boolean {
        return this.bot!==null && this.bot.isReady;
    }
   
    start(options: IOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            async.eachSeries(
                [
                    async (callback: (err?: any) => void) => {
                        try {
                            this.bot = new Bot(options, this);
                            await this.bot.start();
                            callback(); // Notify async.eachSeries that this task is done
                        } catch (e) {
                            callback(e); // Notify async.eachSeries that this task failed
                        }
                    }
                ],
                (task, callback) => {
                    if (this.stopping) {
                        return this.stop(null);
                    }
                    task(callback);
                },
                (err) => {
                    if (err) {
                        return reject(err); // Reject the outer promise if any task failed
                    }
                    if (this.stopping) {
                        return this.stop(null);
                    }
                    resolve(); // Resolve the outer promise if all tasks succeeded
                }
            );
        });
    }
    stop(err:Error|null){
        if(this.bot){
            this.bot.setReady = false
        }
        logger.warn('Shutdown has been initialized, stopping...', err ? { err: err.message } : undefined)
        if (this.bot === null) {
            logger.debug('Bot instance was not yet created');
            //TODO
            return this.exit(err);
        }
        this.cleanup();
        //TODO
        // this.bot.handler.onShutdown().finally(() => {
        //     log.debug('Handler finished cleaning up');
        //     this.exit(err);
        // });
        this.exit(err)
    }
    private cleanup(){
        if(this.bot!==null){
            this.bot.steamClient.setPersona(EPersonaState.Snooze)
            this.bot.steamClient.options.autoRelogin = false
            this.bot.tradeManager.pollInterval = -1;
        }
    }
    private exit(err: Error|null){
        if (this.exiting) {
            return;
        }

        this.exiting = true;

        if (this.bot !== null) {
            this.bot.tradeManager.shutdown();
            this.bot.steamClient.logOff();
        }
        logger.info('Waiting for files to be saved');
        void waitForWriting().then(() => {
            logger.info('Done waiting for files');

            logger.on('finish', () => {
                // Logger has finished, exit the process
                process.exit(err ? 1 : 0);
            });

            logger.warn('Exiting...');

            // Stop the logger
            logger.end();
        });
    }
    
}