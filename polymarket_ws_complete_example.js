/**
 * Polymarket WebSocket Complete Example
 * 
 * WebSocket URL: wss://ws-live-data.polymarket.com
 * 
 * WORKING MESSAGE FORMAT:
 * {
 *   "action": "subscribe",
 *   "subscriptions": [
 *     {
 *       "topic": "<topic_name>",
 *       "type": "<message_type>",
 *       "filters": "<optional_json_string>"  // e.g., '{"symbol":"btcusdt"}'
 *     }
 *   ]
 * }
 * 
 * AVAILABLE TOPICS:
 * - crypto_prices (type: "update") - BTC, ETH, SOL, XRP prices
 * - crypto_prices_chainlink (type: "update") - Chainlink oracle prices  
 * - equity_prices (type: "update") - Stock prices
 * - activity (type: "trades", "orders_matched", or "*") - Trade activity
 * 
 * AVAILABLE CRYPTO SYMBOLS (lowercase):
 * - btcusdt
 * - ethusdt
 * - solusdt
 * - xrpusdt
 * 
 * NON-WORKING FORMATS:
 * - { "type": "subscribe", ... }
 * - { "event": "subscribe", ... }
 * - { "subscriptions": [...] } (without action field)
 */

const WebSocket = require('ws');

const WS_URL = 'wss://ws-live-data.polymarket.com';

class PolymarketWebSocket {
    constructor() {
        this.ws = null;
        this.pingInterval = null;
    }
    
    connect() {
        var self = this;
        console.log('Connecting to Polymarket WebSocket...');
        this.ws = new WebSocket(WS_URL);
        
        this.ws.on('open', function() {
            console.log('Connected!\n');
            
            // Start ping interval to keep connection alive
            self.pingInterval = setInterval(function() {
                if (self.ws.readyState === WebSocket.OPEN) {
                    self.ws.ping();
                }
            }, 5000);
            
            // Subscribe to crypto prices
            self.subscribeCryptoPrices();
        });
        
        this.ws.on('message', function(data) {
            var msg = data.toString();
            if (msg.length > 0) {
                self.handleMessage(msg);
            }
        });
        
        this.ws.on('pong', function() {
            // Connection is alive
        });
        
        this.ws.on('close', function() {
            console.log('Connection closed');
            if (self.pingInterval) {
                clearInterval(self.pingInterval);
            }
        });
        
        this.ws.on('error', function(err) {
            console.error('WebSocket error:', err.message);
        });
    }
    
    subscribeCryptoPrices(symbol) {
        var subscription = {
            topic: "crypto_prices",
            type: "update"
        };
        
        // Optional: filter by symbol
        if (symbol) {
            subscription.filters = JSON.stringify({ symbol: symbol.toLowerCase() });
        }
        
        var message = {
            action: "subscribe",
            subscriptions: [subscription]
        };
        
        console.log('Subscribing to crypto_prices' + (symbol ? ' (' + symbol + ')' : ' (all)'));
        console.log('Message:', JSON.stringify(message, null, 2));
        this.ws.send(JSON.stringify(message));
    }
    
    unsubscribe(topic, type) {
        var message = {
            action: "unsubscribe",
            subscriptions: [{ topic: topic, type: type }]
        };
        
        console.log('Unsubscribing from:', topic);
        this.ws.send(JSON.stringify(message));
    }
    
    handleMessage(rawMessage) {
        try {
            var msg = JSON.parse(rawMessage);
            
            if (msg.topic === 'crypto_prices' && msg.payload) {
                var p = msg.payload;
                console.log('[' + p.symbol.toUpperCase() + '] $' + p.value + ' (timestamp: ' + msg.timestamp + ')');
            } else {
                console.log('Received:', msg.topic, msg.type);
            }
        } catch(e) {
            console.log('Raw message:', rawMessage);
        }
    }
    
    close() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Run example
var client = new PolymarketWebSocket();
client.connect();

// Close after 15 seconds
setTimeout(function() {
    console.log('\nClosing connection...');
    client.close();
    process.exit(0);
}, 15000);
