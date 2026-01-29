/**
 * WEBSOCKET MANAGER
 *
 * Unified WebSocket connection management for:
 * - Chainlink price feeds
 * - Activity (trades, orders)
 *
 * Single connection with multiple subscribers
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

const WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL = 30000;
const RECONNECT_DELAY = 3000;

export interface WSMessage {
  topic: string;
  type: string;
  payload: any;
}

export type MessageHandler = (msg: WSMessage) => void;

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private shouldReconnect: boolean = true;
  private subscriptions: Array<{ topic: string; type: string }> = [];

  constructor() {
    super();
  }

  /**
   * Start WebSocket connection
   */
  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      this.isConnected = true;
      console.log('[WS] Connected to Polymarket');

      // Re-subscribe to all topics
      this.resubscribeAll();

      // Start ping
      this.startPing();

      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore parse errors
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.stopPing();
      console.log('[WS] Disconnected');
      this.emit('disconnected');

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      this.emit('error', err);
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string, type: string, handler: MessageHandler): void {
    const key = `${topic}:${type}`;

    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }

    this.subscribers.get(key)!.add(handler);

    // Track subscription for reconnect
    const subExists = this.subscriptions.some(s => s.topic === topic && s.type === type);
    if (!subExists) {
      this.subscriptions.push({ topic, type });
    }

    // Send subscription if connected
    if (this.isConnected && this.ws) {
      this.sendSubscription(topic, type);
    }
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string, type: string, handler: MessageHandler): void {
    const key = `${topic}:${type}`;
    const handlers = this.subscribers.get(key);

    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(key);
        // Remove from subscriptions list
        this.subscriptions = this.subscriptions.filter(
          s => !(s.topic === topic && s.type === type)
        );
      }
    }
  }

  /**
   * Subscribe to Chainlink prices
   */
  subscribeChainlink(handler: MessageHandler): void {
    this.subscribe('crypto_prices_chainlink', 'update', handler);
  }

  /**
   * Subscribe to activity (trades)
   */
  subscribeActivity(handler: MessageHandler): void {
    this.subscribe('activity', 'trades', handler);
    this.subscribe('activity', '*', handler);
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private handleMessage(msg: WSMessage): void {
    // Emit raw message
    this.emit('message', msg);

    // Find specific handlers
    const key = `${msg.topic}:${msg.type}`;
    const handlers = this.subscribers.get(key);
    if (handlers) {
      handlers.forEach(h => h(msg));
    }

    // Also check wildcard handlers
    const wildcardKey = `${msg.topic}:*`;
    const wildcardHandlers = this.subscribers.get(wildcardKey);
    if (wildcardHandlers) {
      wildcardHandlers.forEach(h => h(msg));
    }
  }

  private sendSubscription(topic: string, type: string): void {
    if (!this.ws || !this.isConnected) return;

    const msg = {
      action: 'subscribe',
      subscriptions: [{ topic, type }]
    };

    this.ws.send(JSON.stringify(msg));
  }

  private resubscribeAll(): void {
    if (!this.ws || !this.isConnected) return;

    const msg = {
      action: 'subscribe',
      subscriptions: this.subscriptions
    };

    this.ws.send(JSON.stringify(msg));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping();
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(`[WS] Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }
}

// Singleton instance
let instance: WebSocketManager | null = null;

export function getWebSocketManager(): WebSocketManager {
  if (!instance) {
    instance = new WebSocketManager();
  }
  return instance;
}

export default WebSocketManager;
