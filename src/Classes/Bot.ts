import { EventEmitter } from 'events';
import SteamUser from 'steam-user';
import SteamCommunity from 'steamcommunity';
import TradeOfferManager, { EResult } from 'steam-tradeoffer-manager';
import SteamTotp from 'steam-totp';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';
import dayjs, {Dayjs} from 'dayjs';
import IOptions from './Interfaces/IOptions'
import * as timersPromises from 'timers/promises';
import * as files from '../lib/files'
import jwt from 'jsonwebtoken'
import {Handler, OnRun} from '../Handler/Handler';
import async, { reject } from 'async'
import botManager from './BotManager';
import { PollData } from './Interfaces/PollData';
import { BotEvents } from './Interfaces/Events';
import config from '../../config';
import Trades from './Trades';
import Queue from './Queue';
import GlobalOffensive from 'globaloffensive';
export class Bot extends EventEmitter {
    public steamClient: SteamUser;
    public tradeManager: TradeOfferManager;
    public csClient: GlobalOffensive
    public community: SteamCommunity;
    readonly handler:Handler
    public ready:boolean = false;
    private readonly maxLoginAttemptsWithinPeriod: number = 3;
    private readonly loginPeriodTime: number = 60 * 1000;

    private loginAttempts: Dayjs[] = [];
    private auth: string = "";
    private cookies: string[] = [];
    //private storageDir: string;
    private consecutiveSteamGuardCodesWrong: number = 0;
    private sessionReplaceCount: number = 0;
    private readonly maxLoginAttempts: number = 2;
    private readonly loginRetryDelay: number = 5000;
    private timeOffset?: number = undefined;
    public options:IOptions;
    public botManager: botManager
    private relogin = false
    // public trades?: Trades
    constructor(options:IOptions, botManager:botManager) {
        super();
        
        this.options = options
        this.steamClient = new SteamUser({ 
            autoRelogin: true ,
            enablePicsCache: true,

        });
        this.community = new SteamCommunity();
        this.tradeManager = new TradeOfferManager({
            steam: this.steamClient,
            language: 'en',
            domain: 'localhost',
            community: this.community,
            pollInterval: -1,
            useAccessToken:true,
            cancelTime: config.offer.cancelTime
        });
        this.csClient = new GlobalOffensive(this.steamClient)
        this.handler = new Handler(this)
        this.botManager = botManager

        //this.storageDir = path.join('data', botId);
        
        
    }
   
    async start(): Promise<void> {
        this.bindEventHandlers();
        return new Promise((resolve, reject) => {
            async.eachSeries([
                async (callback: (err?: any) => void) => {
                    try {
                        const data: OnRun = await this.handler.onRun();
                        if (data.loginAttempts) {
                            logger.info('Setting login attempts for: ' + this.options.accountName);
                            this.setLoginAttempts = data.loginAttempts;
                        }
                        if (data.pollData) {
                            logger.info('Setting poll data')
                            this.tradeManager.pollData = data.pollData;
                        }
                        
                        // if(data.depositQueue && this.trades){
                        //     data.depositQueue.forEach(d=>{
                        //         if(this.trades){
                        //             this.trades.enqueue(d)
                        //         }
                        //     })
                            
                        // }
                        callback();
                    } catch (error) {
                        callback(error);
                    }
                },
                // async (callback: (err?: any) => void) => {
                    
                // },
                async (callback: (err?: any) => void): Promise<void> => {
                    try {
                        //CHANGE TRUE TO FALSE
                        await this.login(await this.getRefreshToken());
                        const variance = Math.random() * 4 * 60 * 1000

                        // As of 7/10/2020, GC inspect calls can timeout repeatedly for whatever reason
                        setInterval(() => {
                            if (this.csClient.haveGCSession) {
                                this.relogin = true;
                                this.steamClient.relog();
                            }
                        }, 30 * 60 * 1000 + variance);
                        callback();
                    } catch (error) {
                        callback(error);
                    }
                }
            ],
            (item, callback) => {
                if(this.botManager.isStopping){
                    //TODO
                    // return this.stop()
                }
                item(callback);
            },
            async (err) => {
                if (err) {
                    return reject(err);
                }
                this.tradeManager.pollInterval = config.bot.pollInterval;
                this.tradeManager.doPoll();
                this.setReady = true
                // await this.trades?.startProcessingQueue()
                resolve();
            });
        });
    }
    set setReady(isReady: boolean) {
        this.ready = isReady;
        logger.info(`Bot is ${isReady ? 'ready' : 'not ready'}`)
        this.emit('ready', this.ready)
    }

    get isReady(): boolean {
        return this.ready;
    }

  
    private async onDisconnected(eresult:SteamUser.EResult, msg?:string):Promise<void>{
        logger.warn(`User disconnected with EResult: ${eresult}, msg: ${msg}`)
        logger.warn("Re-login...")
        this.setReady = false
        // this.login(await this.getRefreshToken()).catch((err)=>{
        //     logger.log(err)
        // })
    }
    on<K extends keyof BotEvents>(event: K, listener: (...args: BotEvents[K]) => void): this {
        return super.on(event, listener);
    }
    emit<K extends keyof BotEvents>(event: K, ...args: BotEvents[K]): boolean {
        return super.emit(event, ...args);
    }
    private bindEventHandlers() {
        
        this.steamClient.on('disconnected',this.onDisconnected.bind(this))
        this.steamClient.on('error', this.onError.bind(this));
        
        this.steamClient.on('webSession',this.onWebSession.bind(this));
        this.steamClient.on('steamGuard', this.onSteamGuard.bind(this));
        this.community.on('sessionExpired', this.onSessionExpired.bind(this));
        // this.tradeManager.on('realTimeTradeCompleted')
        this.tradeManager.on("pollData", async (data:PollData)=> {
           
            this.handler.onPollData(data).catch(err => {
                logger.warn('Failed to save pollData: ', err);
            })
           
        })
        this.steamClient.on('loggedOn', (details) => {
            logger.info(`Logged on as ${this.options.accountName}`);
            this.steamClient.setPersona(SteamUser.EPersonaState.Online)
            this.steamClient.gamesPlayed([], true);

            if (this.relogin) {
                
                // Don't check ownership cache since the event isn't always emitted on relogin
                logger.info(`${this.options.accountName} Initiating GC Connection, Relogin`);
                this.steamClient.gamesPlayed([730], true);
                this.setReady = true
                return;
            }
            this.steamClient.once('ownershipCached', () => {
                if (!this.steamClient.ownsApp(730)) {
                    logger.info(`${this.options.accountName} doesn't own CS:GO, retrieving free license`);
                }
                else {
                    logger.info(`${this.options.accountName} Initiating GC Connection`);
                    this.steamClient.gamesPlayed([730], true);
                }
            })
            
            // this.loginAttempts = 0;  // Reset login attempts on successful login
        });
        
        this.steamClient.on('refreshToken', this.handler.onRefreshToken.bind(this.handler));

        this.csClient.on('connectedToGC', () => {
            logger.info(`CSGO Client Ready!`);
            fs.writeFileSync('data.json',JSON.stringify(this.csClient.inventory,null, 4))
            // this.ready = true;
        });
    }
    

    setCookies(cookies: string[]): Promise<void> {
        this.community.setCookies(cookies);
        // if (this.options.steamApiKey) {
        //     this.manager.apiKey = this.options.steamApiKey;
        // }
        return new Promise((resolve, reject) => {
            this.tradeManager.setCookies(cookies, err => {
                if (err) {
                    return reject(err);
                }
                logger.info(`Cookies set for ${this.options.accountName}`)
                this.handler.onCookies(cookies)
                resolve();
            });
        });
    }
    private onWebSession(sessionID: string, cookies: string[]): void {
        logger.info(`WebSession initialized for ${this.options.accountName}`)

        void this.setCookies(cookies)
    }

    private onSessionExpired(): void {
        logger.warn(`Session expired for ${this.options.accountName}. Attempting re-login...`);
        if (this.steamClient.steamID) this.steamClient.webLogOn();
    }

    // private onConfKeyNeeded(tag: string, callback: (err: Error | null, time: number, confKey: string) => void): void {
    //     logger.debug('Conf key needed');

    //     void this.getTimeOffset.asCallback((err, offset) => {
    //         const time = SteamTotp.time(offset);
    //         const confKey = SteamTotp.getConfirmationKey(this.options.steamIdentitySecret, time, tag);

    //         return callback(null, time, confKey);
    //     });
    // }

    private onSteamGuard(domain: string|null, callback: (authCode: string) => void, lastCodeWrong: boolean): void {
        logger.info(`Steam guard code requested for ${this.options.accountName} from domain: ${domain}`);

        if (lastCodeWrong === false) {
            this.consecutiveSteamGuardCodesWrong = 0;
        } else {
            this.consecutiveSteamGuardCodesWrong++;
        }

        if (this.consecutiveSteamGuardCodesWrong > 1) {
            // Too many logins will trigger this error because steam returns TwoFactorCodeMismatch
            throw new Error('Too many wrong Steam Guard codes');
        }

        const wait = this.loginWait()
        if (wait !== 0) {
            //this.handler.onLoginThrottle(wait);
        }

        void timersPromises
            .setTimeout(wait)
            .then(this.generateAuthCode.bind(this))
            .then(authCode => {
                this.newLoginAttempt();

                callback(authCode);
            });
    }

    public async login(refreshToken?: string, keepSession: boolean = false): Promise<void> {
        logger.debug('Starting login attempt');
       
        const wait = this.loginWait();
        if (wait !== 0) {
        }
        if (this.steamClient) this.steamClient.logOff();
        if(keepSession){
            const cookies = await this.getCookies()
            if(cookies) {
                logger.info("Using saved cookies")
                this.setCookies(cookies)
            }
                else keepSession = false
        }
        if(!keepSession) return new Promise((resolve, reject) => {
            setTimeout(() => {
                const listeners = this.steamClient.listeners('error');

                this.steamClient.removeAllListeners('error');

                const gotEvent = (): void => {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    listeners.forEach(listener => this.steamClient.on('error', listener));
                };

                const loggedOnEvent = (): void => {
                    gotEvent();

                    this.steamClient.removeListener('error', errorEvent);
                    clearTimeout(timeout);

                    resolve();
                };

                const errorEvent = (err: Error & { eresult: SteamUser.EResult }): void => {
                    gotEvent();
                    
                    this.steamClient.removeListener('loggedOn', loggedOnEvent);
                    clearTimeout(timeout);
                    logger.error('Failed to sign in to Steam: ', err);

                    reject(err);
                };

                const timeout = setTimeout(() => {
                    gotEvent();

                    this.steamClient.removeListener('loggedOn', loggedOnEvent);
                    this.steamClient.removeListener('error', errorEvent);

                    logger.debug('Did not get login response from Steam');
                    this.steamClient.logOff();

                    reject(new Error('Did not get login response (Steam might be down)'));
                }, 60 * 1000);

                this.steamClient.once('loggedOn', loggedOnEvent);
                this.steamClient.once('error', errorEvent);

                let loginDetails: { refreshToken: string } | { accountName: string; password: string };
                if (refreshToken) {
                    logger.info('Attempting to login to Steam with refresh token...');
                    loginDetails = { refreshToken };
                } else {
                    logger.info('Attempting to login to Steam...');
                    loginDetails = {
                        accountName: this.options.accountName,
                        password: this.options.password
                    };
                }

                this.newLoginAttempt();
                this.steamClient.logOn(loginDetails);
            }, wait);
        });
    }

   

    private async getCookies(): Promise<string[] | undefined>{
        const cookiesPath = this.handler.getPaths.files.cookies
        const cookies = (await files.readFile(cookiesPath,true).catch(err=>null) as string[])
        if(!cookies) return undefined
        const token = cookies[0].split("%7C")[2]
        const decoded = jwt.decode(token, {complete:true})
        if(!decoded) return undefined
        const { exp } = decoded.payload as { exp: number };

        if (exp < Date.now() / 1000) {
            // Refresh token expired
            return undefined;
        }

        return cookies;
    }
    private async getRefreshToken(): Promise<string | undefined> {
        const tokenPath = this.handler.getPaths.files.refreshToken;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const refreshToken = (await files.readFile(tokenPath, false).catch(err => null)) as string;

        if (!refreshToken) {
            return undefined;
        }

        const decoded = jwt.decode(refreshToken, {
            complete: true
        });

        if (!decoded) {
            // Invalid token
            return undefined;
        }

        const { exp } = decoded.payload as { exp: number };

        if (exp < Date.now() / 1000) {
            // Refresh token expired
            return undefined;
        }

        return refreshToken;
    }

    private async deleteRefreshToken(): Promise<void> {
        const tokenPath = this.handler.getPaths.files.refreshToken;

        await files.writeFile(tokenPath, '', false).catch(() => {
            // Ignore error
        });
    }

    private async onError(err: Error & { eresult: SteamUser.EResult } ): Promise<void> {
        if (err.eresult === EResult.LoggedInElsewhere) {
            logger.warn('Signed in elsewhere, stopping the bot...');
            this.botManager.stop(err);
        } else if (err.eresult === EResult.AccessDenied) {
            // Access denied during login
            await this.deleteRefreshToken();
        } else if (err.eresult === EResult.LogonSessionReplaced) {
            this.sessionReplaceCount++;

            if (this.sessionReplaceCount > 0) {
                logger.warn('Detected login session replace loop, stopping bot...');
                this.botManager.stop(err);
                return;
            }

            logger.warn('Login session replaced, relogging...');

            await this.deleteRefreshToken();

            this.login(await this.getRefreshToken()).catch(err => {
                if (err) {
                    throw err;
                }
            });
            
        } else if(err.eresult === EResult.RateLimitExceeded){
            //Relogin after 60.5 mins
            logger.error(`RateLimit for ${this.options.accountName}, re-login after 1 hour`)
            setTimeout(async() => this.login(await this.getRefreshToken()).catch(err=>{
                if(err){
                    throw err
                }
            })
            
            , 60 * 60 * 1000 + 500);
        }
        
        else {
            throw err;
            
        }
    }

    private generateAuthCode(): string {
        let off: number|undefined;
        try {
            SteamTotp.getTimeOffset((err, offset)=>{
                if(err){
                    throw err
                }
                off = offset
            })
        } catch (err) {
            // ignore error
        }

        return SteamTotp.generateAuthCode(this.options.authCode, off);
    }

    

    private loginWait(): number {
        const attemptsWithinPeriod = this.getLoginAttemptsWithinPeriod;

        let wait = 0;
        if (attemptsWithinPeriod.length >= this.maxLoginAttemptsWithinPeriod) {
            const oldest = attemptsWithinPeriod[0];

            // Time when we can make login attempt
            const timeCanAttempt = dayjs().add(this.loginPeriodTime, 'millisecond');

            // Get milliseconds till oldest till timeCanAttempt
            wait = timeCanAttempt.diff(oldest, 'millisecond');
        }
        if (wait === 0 && this.consecutiveSteamGuardCodesWrong > 1) {
            // 30000 ms wait for TwoFactorCodeMismatch is enough to not get ratelimited
            return 30000 * this.consecutiveSteamGuardCodesWrong;
        }

        return wait;
    }

    private set setLoginAttempts(attempts: number[]) {
        
        this.loginAttempts = attempts.map(time => dayjs.unix(time));
    }

    private get getLoginAttemptsWithinPeriod(): dayjs.Dayjs[] {
        const now = dayjs();

        const filtered = this.loginAttempts.filter(attempt => now.diff(attempt, 'millisecond') < this.loginPeriodTime);
        return filtered;
    }

    private newLoginAttempt(): void {
        const now = dayjs();

        // Clean up old login attempts
        this.loginAttempts = this.loginAttempts.filter(
            attempt => now.diff(attempt, 'millisecond') < this.loginPeriodTime
        );

        this.loginAttempts.push(now);

        this.handler.onLoginAttempts(this.loginAttempts.map(attempt => attempt.unix()));
    }
   
}

