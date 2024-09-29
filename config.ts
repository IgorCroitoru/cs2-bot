
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
        delayBetweenInventoryFetch: 4000,
        delayBetweenOfferDecline: 2000,
        cancelTime: 10 * 60 * 1000
    },
    inventory:{
        delayBetweenReq: 2500
    },
    rates:{
        limitExceeded: 60 * 60 * 1000
    },
    bot: {
        pollInterval: 20 * 1000
    }

}