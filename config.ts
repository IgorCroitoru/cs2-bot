export default  {
    http: {
        port: 3001
    },
    socket:{
        reconnectAttempts: Infinity,
        reconnectDelay: 2000,
        ackTTL: 20000
    },
    offer:{
        delayBetweenOffers: 4000,
        maxRetries: 3,
        delayBetweenInventoryFetch: 4000,
        delayBetweenOfferDecline: 2000,
        cancelTime: 10 * 60 * 1000,
        rejectEscrow: true,
    },
    inventory:{
        delayBetweenReq: 2500,
        maxRetries: 3,
    },
    rates:{
        limitExceeded: 60 * 60 * 1000
    },
    bot: {
        pollInterval: 20 * 1000
    }

}