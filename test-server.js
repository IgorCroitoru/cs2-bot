const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:5051",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
app.use((req, res, next) => {
    // Allow requests from any origin
    res.header('Access-Control-Allow-Origin', '*');
    
    // Allow specific headers
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Allow specific methods
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});
// Serve static files (including the HTML tester)
app.use(express.static(__dirname));

// Store connected bots
const connectedBots = new Map();

// Log function with timestamp
function log(level, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// Simulate delay for realistic responses
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Simulate random errors for testing
function shouldSimulateError(chance = 0.1) {
    return Math.random() < chance;
}

io.on('connection', (socket) => {
    log('info', `New socket connection: ${socket.id}`);

    // Store bot info when it connects
    let botInfo = null;
    const botId = socket.handshake.query.id64;
    if (botId) {
        botInfo = { id64: botId, socketId: socket.id };
        connectedBots.set(botId, botInfo);
    }
    // ============================================================================
    // INVENTORY EVENTS
    // ============================================================================

    socket.on('inventoryFetch', async (steamId, callback) => {
        log('info', 'Received inventoryFetch request', { steamId, socketId: socket.id });

        try {
            // Simulate processing delay
            await delay(Math.random() * 2000 + 500); // 500-2500ms delay

            // Simulate random errors occasionally
            if (shouldSimulateError(0.15)) {
                const error = 'Steam API temporarily unavailable';
                log('warn', 'Simulating inventory fetch error', { error, steamId });
                
                if (callback) {
                    callback({
                        status: 'error',
                        error: { message: error },
                        data: null
                    });
                }
                
                // Emit the event for listeners
                socket.emit('inventoryFetched', steamId, error, 'error', []);
                return;
            }

            // Return mock inventory
            const status = 'success';
            log('success', 'Inventory fetch successful', { steamId, itemCount: mockInventory.length });
            
            if (callback) {
                callback({
                    status: 'ok',
                    data: {
                        inventory: mockInventory,
                        status: status
                    }
                });
            }

            // Emit the event for listeners
            socket.emit('inventoryFetched', steamId, null, status, mockInventory);

        } catch (error) {
            log('error', 'Error in inventoryFetch handler', { error: error.message, steamId });
            
            if (callback) {
                callback({
                    status: 'error',
                    error: { message: error.message }
                });
            }
            
            socket.emit('inventoryFetched', steamId, error.message, 'error', []);
        }
    });

    socket.on('pauseInventory', async (paused, cause, pauseEnd, callback) => {
        log('info', 'Received pauseInventory request', { paused, cause, pauseEnd, socketId: socket.id });

        try {
            await delay(100); // Small delay

            if (callback) {
                callback({
                    status: 'ok',
                    data: { paused, cause, pauseEnd }
                });
            }

            // Emit pause event
            socket.emit('inventoryPaused', paused, cause, pauseEnd);
            log('success', `Inventory ${paused ? 'paused' : 'resumed'}`, { cause, pauseEnd });

        } catch (error) {
            log('error', 'Error in pauseInventory handler', { error: error.message });
            
            if (callback) {
                callback({
                    status: 'error',
                    error: { message: error.message }
                });
            }
        }
    });

    // ============================================================================
    // TRADE EVENTS
    // ============================================================================

    socket.on('newDeal', async (payload, callback) => {
        log('info', 'Received newDeal request', { payload, socketId: socket.id });

        try {
            // Simulate processing delay
            await delay(Math.random() * 1000 + 200); // 200-1200ms delay

            // Validate payload
            if (!payload.userId64 || !payload.items_to_receive) {
                const error = 'Invalid trade payload: missing required fields';
                log('error', error, payload);
                
                if (callback) {
                    callback({
                        status: 'error',
                        error: { message: error }
                    });
                }
                return;
            }

         

            // Success response
            const tradeOfferId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const response = {
                status: 'queued',
                message: 'Trade queued for processing',
                queue_position: Math.floor(Math.random() * 5) + 1,
                estimated_wait: Math.floor(Math.random() * 30000) + 5000,
                taskId: payload.id
            };

            log('success', 'Trade queued successfully', { tradeId: payload.id, offerId: tradeOfferId });

            if (callback) {
                callback(response);
            }

            // Simulate offer creation process
            setTimeout(async () => {
                // Emit offer creation success
                socket.emit('offerCreation', {
                    offerId: tradeOfferId,
                    state: 2, // ETradeOfferState.Active
                    trade_offer_created_at: Date.now(),
                    trade_offer_expiry_at: Date.now() + (15 * 24 * 60 * 60 * 1000), // 15 days
                    metadata: { dealId: payload.id }
                });

                // Simulate offer state changes
                setTimeout(() => {
                    // Simulate random offer outcomes
                    const outcomes = [3, 7]; // Accepted or Declined
                    const finalState = outcomes[Math.floor(Math.random() * outcomes.length)];
                    
                    socket.emit('offerChangedState', {
                        state: finalState,
                        trade_offer_finished_at: Date.now(),
                        offerId: tradeOfferId,
                        sent: [],
                        received: payload.items_to_receive,
                        metadata: { dealId: payload.id }
                    });

                    log('info', `Trade offer ${tradeOfferId} finished`, { 
                        state: finalState === 3 ? 'Accepted' : 'Declined',
                        dealId: payload.id 
                    });
                }, Math.random() * 10000 + 2000); // 2-12 seconds later

            }, Math.random() * 3000 + 1000); // 1-4 seconds for offer creation

        } catch (error) {
            log('error', 'Error in newDeal handler', { error: error.message, payload });
            
            if (callback) {
                callback({
                    status: 'error',
                    error: { message: error.message }
                });
            }
        }
    });

    socket.on('pauseTrade', async (paused, cause, pauseEnd, callback) => {
        log('info', 'Received pauseTrade request', { paused, cause, pauseEnd, socketId: socket.id });

        try {
            await delay(100);

            if (callback) {
                callback({
                    status: 'ok',
                    data: { paused, cause, pauseEnd }
                });
            }

            // Emit trades paused event
            socket.emit('tradesPaused', paused, cause, pauseEnd);
            log('success', `Trades ${paused ? 'paused' : 'resumed'}`, { cause, pauseEnd });

        } catch (error) {
            log('error', 'Error in pauseTrade handler', { error: error.message });
            
            if (callback) {
                callback({
                    status: 'error',
                    error: { message: error.message }
                });
            }
        }
    });

    // ============================================================================
    // BOT EVENTS
    // ============================================================================

    socket.on('pauseBot', async (paused, pauseEnd, cause, callback) => {
        log('info', 'Received pauseBot request', { paused, pauseEnd, cause, socketId: socket.id });

        try {
            await delay(100);

            if (callback) {
                callback({
                    status: 'ok',
                    data: { paused, cause, pauseEnd }
                });
            }

            // Emit bot paused event
            socket.emit('botPaused', paused, cause, pauseEnd);
            log('success', `Bot ${paused ? 'paused' : 'resumed'}`, { cause, pauseEnd });

        } catch (error) {
            log('error', 'Error in pauseBot handler', { error: error.message });
            
            if (callback) {
                callback({
                    status: 'error',
                    error: { message: error.message }
                });
            }
        }
    });

    // Listen for bot ready state
    socket.on('ready', (ready) => {
        log('info', 'Bot ready state changed', { ready, socketId: socket.id });
        if (botInfo) {
            botInfo.ready = ready;
        }
    });

    // ============================================================================
    // CONNECTION MANAGEMENT
    // ============================================================================

    socket.on('disconnect', (reason) => {
        log('warn', `Socket disconnected: ${socket.id}`, { reason });
        if (botInfo) {
            connectedBots.delete(socket.id);
        }
    });

    // Store bot information (if provided)
    socket.on('botInfo', (info) => {
        botInfo = { ...info, socketId: socket.id, connectedAt: Date.now() };
        connectedBots.set(socket.id, botInfo);
        log('info', 'Bot info registered', botInfo);
    });

    // ============================================================================
    // ADMIN/TESTING COMMANDS
    // ============================================================================

    socket.on('getConnectedBots', (callback) => {
        const bots = Array.from(connectedBots.values());
        log('info', 'Sending connected bots list', { count: bots.length });
        if (callback) {
            callback({
                status: 'ok',
                data: { bots, count: bots.length }
            });
        }
    });

    socket.on('testEvent', (eventType, payload) => {
        log('info', 'Received test event', { eventType, payload, socketId: socket.id });
        
        // Echo back the test event
        socket.emit('testEventResponse', {
            eventType,
            payload,
            timestamp: Date.now(),
            socketId: socket.id
        });
    });
    socket.on('offerCreation', (payload, callback) => {
        log('info', 'offerCreation (from bot)', { socketId: socket.id, payload });
        // Optional: broadcast to observers (not back to the same bot)
        socket.broadcast.emit('offerCreation', payload);
        if (typeof callback === 'function') {
        callback({ status: 'ok' });
        }
    });

    // Bot -> Server: offerChangedState
    socket.on('offerChangedState', (payload, callback) => {
        log('info', 'offerChangedState (from bot)', { socketId: socket.id, payload });
        socket.broadcast.emit('offerChangedState', payload);
        if (typeof callback === 'function') {
        callback({ status: 'ok' });
        }
    });

    // Bot -> Server: tradesPaused
    socket.on('tradesPaused', (paused, cause, pauseEnd, callback) => {
        log('info', 'tradesPaused (from bot)', { socketId: socket.id, paused, cause, pauseEnd });
        socket.broadcast.emit('tradesPaused', paused, cause, pauseEnd);
        if (typeof callback === 'function') {
        callback({ status: 'ok' });
        }
    });
});

// ============================================================================
// SERVER ADMIN ROUTES
// ============================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'api-test.html'));
});

app.get('/api/inventory/:steamId', (req, res) => {
    const steamId = req.params.steamId;
    
    // Fix: Get bot IDs properly from Map
    const botIds = Array.from(connectedBots.keys());
    
    if (botIds.length === 0) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'No connected bots available' 
        });
    }
    
    // Get random bot
    const randomIndex = Math.floor(Math.random() * botIds.length);
    const randomBotId = botIds[randomIndex];
    const bot = connectedBots.get(randomBotId);
    
    if (!bot) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'Bot not found' 
        });
    }

    const REQUEST_TIMEOUT = 15000; // 15 seconds
    let isResponseSent = false;
    let timeoutId;

    // Set up request timeout
    const sendTimeoutResponse = () => {
        if (!isResponseSent) {
            isResponseSent = true;
            res.status(408).json({
                status: "timeout",
                error: "Request timed out after 15 seconds",
                message: "The inventory request is taking longer than expected. Please try again later.",
            });
        }
    };

    timeoutId = setTimeout(sendTimeoutResponse, REQUEST_TIMEOUT);

    try {
        // Get the actual socket instance
        const targetSocket = io.sockets.sockets.get(bot.socketId);
        
        if (!targetSocket) {
            clearTimeout(timeoutId);
            return res.status(404).json({ 
                status: 'error', 
                message: 'Socket connection not found' 
            });
        }

        // Emit inventory fetch request and check estimated time
        targetSocket.emit('inventoryFetch', steamId, (response) => {
            log('info', 'Inventory fetch response received', response);
            
            if (!response) {
                clearTimeout(timeoutId);
                if (!isResponseSent) {
                    isResponseSent = true;
                    res.status(500).json({
                        status: 'error',
                        message: 'No response from bot'
                    });
                }
                return;
            }

            // Check if estimated wait time is reasonable
            if (response.estimated_wait && response.estimated_wait > REQUEST_TIMEOUT) {
                clearTimeout(timeoutId);
                if (!isResponseSent) {
                    isResponseSent = true;
                    return res.status(202).json({
                        status: "queued_for_later",
                        message: "Request queued but will take longer than 15 seconds",
                        estimated_wait_ms: response.estimated_wait,
                        estimated_wait_human: Math.ceil(response.estimated_wait / 1000) + " seconds",
                        queue_position: response.queue_position || 0,
                    });
                }
                return;
            }

            // If estimated time is reasonable, listen for the inventory result
            const handleInventoryResult = (steamIdResult, error, status, inventory) => {
                if (steamIdResult === steamId && !isResponseSent) {
                    clearTimeout(timeoutId);
                    isResponseSent = true;

                    if (status === "success" || (status === "ok" && !error)) {
                        res.json({
                            status: "success",
                            steamId: steamIdResult,
                            inventory: inventory || [],
                            count: inventory ? inventory.length : 0,
                        });
                    } else {
                        res.status(500).json({
                            status: "error",
                            steamId: steamIdResult,
                            error: error || "Unknown error occurred",
                            taskId: taskId || response.taskId,
                        });
                    }

                    // Remove the listener to prevent memory leaks
                    targetSocket.off('inventoryFetched', handleInventoryResult);
                }
            };

            // Listen for the inventory result
            targetSocket.on('inventoryFetched', handleInventoryResult);

            // If response indicates immediate error
            if (response.status === 'error') {
                clearTimeout(timeoutId);
                if (!isResponseSent) {
                    isResponseSent = true;
                    res.status(500).json({
                        status: 'error',
                        error: response.error || 'Unknown error',
                        message: response.message || 'Failed to queue inventory request'
                    });
                }
            }
        });

    } catch (error) {
        clearTimeout(timeoutId);
        if (!isResponseSent) {
            isResponseSent = true;
            res.status(500).json({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                message: "Failed to queue inventory request",
            });
        }
        log('error', 'Error in inventory API route', { error: error.message, steamId });
    }
})

// Request inventory item info API endpoint
app.post('/api/socket/requestInventoryItemInfo', express.json(), (req, res) => {
    console.log(req.body)
    const { assetId } = req.body;
    
    if (!assetId) {
        return res.status(400).json({
            status: 'error',
            message: 'Asset ID is required'
        });
    }

    log('info', 'Request inventory item info API called', { assetId });

    const botIds = Array.from(connectedBots.keys());
    if (botIds.length === 0) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'No connected bots available' 
        });
    }
    
    // Get random bot
    const randomIndex = Math.floor(Math.random() * botIds.length);
    const randomBotId = botIds[randomIndex];
    const bot = connectedBots.get(randomBotId);
    
    if (!bot) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'Bot not found' 
        });
    }

    try {
        // Get the actual socket instance
        const targetSocket = io.sockets.sockets.get(bot.socketId);
        
        if (!targetSocket) {
            return res.status(404).json({ 
                status: 'error', 
                message: 'Socket connection not found' 
            });
        }

        // Emit requestInventoryItemInfo event
        targetSocket.emit('requestInventoryItemInfo', assetId, (response) => {
            log('info', 'Inventory item info response received', { assetId, response });
            
            if (!response) {
                return res.status(500).json({
                    status: 'error',
                    message: 'No response from bot'
                });
            }

            // Return the response from the bot
            res.json(response);
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            message: 'Failed to request inventory item info'
        });
        log('error', 'Error in requestInventoryItemInfo API route', { error: error.message, assetId });
    }
});

app.post('/api/trade', express.json(), (req, res) => {
    const { userId64, items_to_receive, tradeUrl } = req.body;
    
    // Validate required fields
    if (!userId64 || !items_to_receive || !Array.isArray(items_to_receive)) {
        return res.status(400).json({
            status: 'error',
            message: 'Missing required fields: userId64, items_to_receive'
        });
    }

    if (items_to_receive.length === 0) {
        return res.status(400).json({
            status: 'error',
            message: 'At least one item must be selected'
        });
    }
    
    // Get available bots
    const botIds = Array.from(connectedBots.keys());
    
    if (botIds.length === 0) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'No connected bots available' 
        });
    }
    
    // Get random bot
    const randomIndex = Math.floor(Math.random() * botIds.length);
    const randomBotId = botIds[randomIndex];
    const bot = connectedBots.get(randomBotId);
    
    if (!bot) {
        return res.status(404).json({ 
            status: 'error', 
            message: 'Bot not found' 
        });
    }

    const REQUEST_TIMEOUT = 30000; // 30 seconds for trades
    let isResponseSent = false;
    let timeoutId;

    // Set up request timeout
    const sendTimeoutResponse = () => {
        if (!isResponseSent) {
            isResponseSent = true;
            res.status(408).json({
                status: "timeout",
                error: "Trade request timed out after 30 seconds",
                message: "The trade request is taking longer than expected. Please try again later.",
            });
        }
    };

    timeoutId = setTimeout(sendTimeoutResponse, REQUEST_TIMEOUT);

    try {
        // Get the actual socket instance
        const targetSocket = io.sockets.sockets.get(bot.socketId);
        
        if (!targetSocket) {
            clearTimeout(timeoutId);
            return res.status(404).json({ 
                status: 'error', 
                message: 'Socket connection not found' 
            });
        }

        // Create trade payload
        const tradePayload = {
            id: Math.floor(Math.random() * 900000000 + 1000000000), // Random trade ID
            userId64: userId64,
            items_to_receive: items_to_receive,
            tradeUrl: tradeUrl || null,
            timestamp: Date.now()
        };

        // Emit newDeal request
        targetSocket.emit('newDeal', tradePayload, (response) => {
            log('info', 'Trade creation response received', response);
            
            if (!response) {
                clearTimeout(timeoutId);
                if (!isResponseSent) {
                    isResponseSent = true;
                    res.status(500).json({
                        status: 'error',
                        message: 'No response from bot'
                    });
                }
                return;
            }

            clearTimeout(timeoutId);
            if (!isResponseSent) {
                isResponseSent = true;
                
                if (response.status === 'error') {
                    res.status(500).json({
                        status: 'error',
                        error: response.error || 'Unknown error',
                        message: response.message || 'Trade creation failed'
                    });
                } else {
                    res.json({
                        status: response.status || 'success',
                        message: response.message || 'Trade queued successfully',
                        tradeId: tradePayload.id,
                        queue_position: response.queue_position,
                        estimated_wait: response.estimated_wait,
                        bot_id: randomBotId
                    });
                }
            }
        });

    } catch (error) {
        clearTimeout(timeoutId);
        if (!isResponseSent) {
            isResponseSent = true;
            res.status(500).json({
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                message: "Failed to queue trade request",
            });
        }
        log('error', 'Error in trade API route', { error: error.message, userId64 });
    }
});

app.get('/api/status', (req, res) => {
    const bots = Array.from(connectedBots.values());
    res.json({
        status: 'running',
        uptime: process.uptime(),
        connectedBots: bots.length,
        bots: bots,
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/bots', (req, res) => {
    const bots = Array.from(connectedBots.values());
    res.json({
        count: bots.length,
        bots: bots
    });
});

// Simulate server-side events (for testing)
app.post('/api/simulate/:eventType', express.json(), (req, res) => {
    const { eventType } = req.params;
    const { payload, socketId } = req.body;

    log('info', `Simulating event: ${eventType}`, { payload, socketId });

    if (socketId && connectedBots.has(socketId)) {
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
            targetSocket.emit(eventType, payload);
            res.json({ status: 'ok', message: `Event ${eventType} sent to bot ${socketId}` });
        } else {
            res.status(404).json({ status: 'error', message: 'Socket not found' });
        }
    } else {
        // Broadcast to all connected bots
        io.emit(eventType, payload);
        res.json({ 
            status: 'ok', 
            message: `Event ${eventType} broadcasted to ${connectedBots.size} bots` 
        });
    }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

server.listen(PORT, () => {
    log('info', `🚀 Test Socket Server running on port ${PORT}`);
    log('info', `📱 Open http://localhost:${PORT} to access the HTML tester`);
    log('info', `🔗 Bot should connect to: http://localhost:${PORT}`);
    log('info', '='.repeat(50));
});



// Error handling
process.on('uncaughtException', (error) => {
    log('error', 'Uncaught Exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled Rejection', { reason, promise });
});
