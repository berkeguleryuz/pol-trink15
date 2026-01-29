/**
 * PRICE CACHE
 *
 * Real-time price caching for:
 * - Chainlink prices (via WebSocket)
 * - CLOB midpoint prices (via polling)
 *
 * Includes last known price fallback for reconnection scenarios
 */

import axios from 'axios';
import { getWebSocketManager, WSMessage } from './websocket-manager';
import { TokenPrices } from '../strategies/types';

const CLOB_API = 'https://clob.polymarket.com';
const POLL_INTERVAL = 500; // 500ms
const SUPPORTED_COINS = ['BTC', 'ETH', 'SOL', 'XRP'];

export class PriceCache {
  // Current Chainlink prices
  private chainlinkPrices: Map<string, number> = new Map();

  // Last known Chainlink prices (backup)
  private lastKnownChainlink: Map<string, number> = new Map();

  // Token prices (CLOB midpoint)
  private tokenPrices: Map<string, TokenPrices> = new Map();

  // Token IDs for polling
  private tokenIds: Map<string, { up: string; down: string }> = new Map();

  // Polling timer
  private pollTimer: NodeJS.Timeout | null = null;

  // Event listeners
  private listeners: Map<string, Set<(price: number) => void>> = new Map();

  constructor() {
    // Connect to WebSocket for Chainlink prices
    const ws = getWebSocketManager();
    ws.subscribeChainlink((msg) => this.handleChainlinkUpdate(msg));
  }

  /**
   * Start polling token prices
   */
  startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      this.pollTokenPrices();
    }, POLL_INTERVAL);

    // Initial poll
    this.pollTokenPrices();
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Register token IDs for a market
   */
  registerMarket(coin: string, upTokenId: string, downTokenId: string): void {
    this.tokenIds.set(coin.toUpperCase(), { up: upTokenId, down: downTokenId });
  }

  /**
   * Unregister a market
   */
  unregisterMarket(coin: string): void {
    this.tokenIds.delete(coin.toUpperCase());
    this.tokenPrices.delete(coin.toUpperCase());
  }

  /**
   * Get Chainlink price for a coin
   * Falls back to last known price if current is unavailable
   */
  getChainlinkPrice(coin: string): number {
    const upperCoin = coin.toUpperCase();
    return this.chainlinkPrices.get(upperCoin)
      || this.lastKnownChainlink.get(upperCoin)
      || 0;
  }

  /**
   * Get token prices for a coin
   */
  getTokenPrices(coin: string): TokenPrices {
    return this.tokenPrices.get(coin.toUpperCase()) || { up: 0.5, down: 0.5 };
  }

  /**
   * Get all current prices for a coin
   */
  getPrices(coin: string): {
    chainlink: number;
    up: number;
    down: number;
    spread: number;
    winner: 'Up' | 'Down';
  } {
    const chainlink = this.getChainlinkPrice(coin);
    const tokens = this.getTokenPrices(coin);
    const spread = Math.abs(tokens.up - tokens.down);
    const winner = tokens.up >= tokens.down ? 'Up' : 'Down';

    return { chainlink, up: tokens.up, down: tokens.down, spread, winner };
  }

  /**
   * Listen for price updates
   */
  onPriceUpdate(coin: string, callback: (price: number) => void): void {
    const key = coin.toUpperCase();
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);
  }

  /**
   * Remove price listener
   */
  offPriceUpdate(coin: string, callback: (price: number) => void): void {
    const key = coin.toUpperCase();
    this.listeners.get(key)?.delete(callback);
  }

  /**
   * Check if we have prices for a coin
   */
  hasPrices(coin: string): boolean {
    const upperCoin = coin.toUpperCase();
    return this.chainlinkPrices.has(upperCoin) || this.lastKnownChainlink.has(upperCoin);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private handleChainlinkUpdate(msg: WSMessage): void {
    if (msg.topic !== 'crypto_prices_chainlink' || !msg.payload) return;

    const symbol = msg.payload.symbol?.split('/')[0]?.toUpperCase() || '';
    const price = msg.payload.value;

    if (!SUPPORTED_COINS.includes(symbol) || !price || price <= 0) return;

    // Update current and last known
    this.chainlinkPrices.set(symbol, price);
    this.lastKnownChainlink.set(symbol, price);

    // Notify listeners
    this.notifyListeners(symbol, price);
  }

  private async pollTokenPrices(): Promise<void> {
    const polls = Array.from(this.tokenIds.entries()).map(async ([coin, ids]) => {
      try {
        const [upRes, downRes] = await Promise.all([
          axios.get(`${CLOB_API}/midpoint?token_id=${ids.up}`, { timeout: 2000 }),
          axios.get(`${CLOB_API}/midpoint?token_id=${ids.down}`, { timeout: 2000 })
        ]);

        const upPrice = parseFloat(upRes.data.mid || '0.5');
        const downPrice = parseFloat(downRes.data.mid || '0.5');

        this.tokenPrices.set(coin, { up: upPrice, down: downPrice });
      } catch {
        // Ignore poll errors, keep last known prices
      }
    });

    await Promise.allSettled(polls);
  }

  private notifyListeners(coin: string, price: number): void {
    const listeners = this.listeners.get(coin);
    if (listeners) {
      listeners.forEach(cb => cb(price));
    }
  }
}

// Singleton
let instance: PriceCache | null = null;

export function getPriceCache(): PriceCache {
  if (!instance) {
    instance = new PriceCache();
  }
  return instance;
}

export default PriceCache;
