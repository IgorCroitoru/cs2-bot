
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
    ItemServerUnavailable = 10
    
    // Add other EResult values as needed
}

export const EResultStatusCodes: { [key in ERR]: number } = {
    [ERR.PrivateProfile]: 403,
    [ERR.BadTradeUrl]: 400,
    [ERR.GeneralError]: 500,
    [ERR.InvalidItems]: 400,
    [ERR.Escrow]: 500,
    [ERR.AccessDenied]: 500,
    [ERR.NotReady]: 500,
    [ERR.RateLimitExceeded]: 429,
    [ERR.TargetCannotTrade] : 400,
    [ERR.TradeBan] : 400,
    [ERR.ItemServerUnavailable] : 500
    // Add other mappings as needed
};
export class CustomError extends Error {
    eresult?: ERR;
    statusCode: number;

    constructor(message: string, eresult?: ERR) {
        const statusCode = eresult !== undefined ? EResultStatusCodes[eresult] : 500;
        super(message);
        this.message = message
        this.statusCode = statusCode;
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
            statusCode:this.statusCode
        }
    }
    
}
