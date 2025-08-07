
export enum ERR {
    GeneralError= 0,
    PrivateProfile = 1,
    BadTradeUrl = 2,
    InvalidItems = 3,
    Escrow = 4,
    AccessDenied= 5,
    NotReady = 6,
    RateLimitExceeded = 7,
    TargetCannotTrade = 8,
    TradeBan = 9,
    ItemServerUnavailable = 10,
    DailyOfferLimitExceeded = 11,
    UserOfferLimitExceeded = 12,
    TotalOfferLimitExceeded = 13,
    // Add other EResult values as needed
}


export class CustomError extends Error {
    eresult?: ERR;
    constructor(message: string, eresult?: ERR) {
        super(message);
        this.message = message
        this.eresult = eresult;

        // Ensure the name of this error is the same as the class name
        Object.setPrototypeOf(this, new.target.prototype);

        // Capturing stack trace, excluding constructor call from it
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    toJSON(){
        return{
            message:this.message,
            eresult: this.eresult,
        }
    }
    
}
