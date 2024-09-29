interface UnknownKeys<T> {
    [key: string]: T;
}
export type PollData = {
    sent: UnknownKeys<number>;
    received: UnknownKeys<number>;
    timestamps: UnknownKeys<number>;
    offersSince: number;
    offerData: { [offerID: string]: OfferData };
};

export interface OfferData{
    dealId?: number
    type?: 'deposit' | 'sale'
    creationAck?:boolean
    finalStateAck?:boolean
    errorLogs?: string
    trade_offer_expiry_at?: number;
    trade_offer_created_at?: number;
    trade_offer_finished_at?: number;
}

export interface DealErrorData {
    dealId: number;
    type?: 'deposit' | 'sale'; // Type of transaction
    error: any;
    timestamp: number;
}
export interface OfflineData {
    dealErrors: {[transactionId: number]: DealErrorData}
    offerData: {[offerId:string]:OfferData}
  }

// export type mainServerAck = {
//     creation:boolean
//     finalState:boolean
// }