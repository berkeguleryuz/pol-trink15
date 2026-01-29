/**
 * WHALE TRACKER
 *
 * Tracks whale activity in real-time:
 * - Recent trades per whale
 * - Position accumulation
 * - Trade patterns
 */

import { EventEmitter } from 'events';
import { getWebSocketManager, WSMessage } from '../data/websocket-manager';
import { WhaleTrade, WhalePosition, WhaleFill, WhaleConfig } from '../strategies/types';
import { getPriceCache } from '../data/price-cache';

// Default whale configurations
export const DEFAULT_WHALES: Record<string, WhaleConfig> = {
  '0xe00740bce98a594e26861838885ab310ec3b548c': {
    address: '0xe00740bce98a594e26861838885ab310ec3b548c',
    name: 'Whale-A',
    reliability: 0.65
  },
  '0x336848a1a1cb00348020c9457676f34d882f21cd': {
    address: '0x336848a1a1cb00348020c9457676f34d882f21cd',
    name: 'Whale-B',
    reliability: 0.70
  }
};

// Time window for "recent" trades (60 seconds)
const RECENT_WINDOW_MS = 60 * 1000;

// Max trades to keep in history
const MAX_TRADE_HISTORY = 500;

export class WhaleTracker extends EventEmitter {
  // Whale configurations
  private whales: Map<string, WhaleConfig> = new Map();

  // All whale trades
  private allTrades: WhaleTrade[] = [];

  // Active positions per whale
  private positions: Map<string, WhalePosition> = new Map();

  // Recent trades per whale (last 60s)
  private recentByWhale: Map<string, WhaleTrade[]> = new Map();

  // Recent trades per coin (last 60s)
  private recentByCoin: Map<string, WhaleTrade[]> = new Map();

  constructor(whales: Record<string, WhaleConfig> = DEFAULT_WHALES) {
    super();

    // Initialize whales
    Object.entries(whales).forEach(([addr, config]) => {
      this.whales.set(addr.toLowerCase(), config);
    });

    // Subscribe to activity
    const ws = getWebSocketManager();
    ws.subscribeActivity((msg) => this.handleActivity(msg));
  }

  /**
   * Get recent trades for a whale (last 60 seconds)
   */
  getRecentTrades(whaleName: string, seconds: number = 60): WhaleTrade[] {
    const trades = this.recentByWhale.get(whaleName) || [];
    const cutoff = Date.now() - (seconds * 1000);
    return trades.filter(t => t.timestamp > cutoff);
  }

  /**
   * Get recent trades for a coin (last 60 seconds)
   */
  getRecentTradesByCoin(coin: string, seconds: number = 60): WhaleTrade[] {
    const trades = this.recentByCoin.get(coin.toUpperCase()) || [];
    const cutoff = Date.now() - (seconds * 1000);
    return trades.filter(t => t.timestamp > cutoff);
  }

  /**
   * Check if both whales agree on direction
   */
  bothWhalesAgree(coin: string, outcome: 'Up' | 'Down', seconds: number = 60): boolean {
    const trades = this.getRecentTradesByCoin(coin, seconds);
    const whaleOutcomes = new Map<string, 'Up' | 'Down'>();

    trades.forEach(t => {
      if (t.side === 'BUY') {
        whaleOutcomes.set(t.whale, t.outcome);
      }
    });

    if (whaleOutcomes.size < 2) return false;

    // Check if all whales have the same outcome
    const outcomes = Array.from(whaleOutcomes.values());
    return outcomes.every(o => o === outcome);
  }

  /**
   * Get whale confirmation score (0-25)
   */
  getWhaleConfirmationScore(coin: string, outcome: 'Up' | 'Down', seconds: number = 60): number {
    const trades = this.getRecentTradesByCoin(coin, seconds).filter(t => t.side === 'BUY');
    let score = 0;

    // Check Whale-A
    const whaleATrades = trades.filter(t => t.whale === 'Whale-A' && t.outcome === outcome);
    if (whaleATrades.length > 0) score += 12;

    // Check Whale-B
    const whaleBTrades = trades.filter(t => t.whale === 'Whale-B' && t.outcome === outcome);
    if (whaleBTrades.length > 0) score += 13;

    // Bonus if both whales agree
    if (whaleATrades.length > 0 && whaleBTrades.length > 0) score += 10;

    return Math.min(score, 25);
  }

  /**
   * Get position for a whale in a market
   */
  getPosition(whaleName: string, coin: string, outcome: 'Up' | 'Down'): WhalePosition | undefined {
    const key = `${whaleName}-${coin}-${outcome}`;
    return this.positions.get(key);
  }

  /**
   * Get all active positions for a coin
   */
  getPositionsByCoin(coin: string): WhalePosition[] {
    const result: WhalePosition[] = [];
    this.positions.forEach((pos, key) => {
      if (pos.coin === coin.toUpperCase()) {
        result.push(pos);
      }
    });
    return result;
  }

  /**
   * Get whale config by address
   */
  getWhaleConfig(address: string): WhaleConfig | undefined {
    return this.whales.get(address.toLowerCase());
  }

  /**
   * Check if address is a tracked whale
   */
  isWhale(address: string): boolean {
    return this.whales.has(address.toLowerCase());
  }

  /**
   * Get all trade history
   */
  getAllTrades(limit: number = 100): WhaleTrade[] {
    return this.allTrades.slice(-limit);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private handleActivity(msg: WSMessage): void {
    if (msg.topic !== 'activity') return;

    const walletAddr = msg.payload?.proxyWallet?.toLowerCase();
    if (!walletAddr || !this.whales.has(walletAddr)) return;

    if (msg.type === 'trades') {
      this.processTrade(msg.payload, walletAddr);
    }
  }

  private processTrade(payload: any, walletAddr: string): void {
    const whaleConfig = this.whales.get(walletAddr)!;
    const priceCache = getPriceCache();

    // Parse trade data
    const slug = payload.slug || payload.eventSlug || '';
    const coinMatch = slug.match(/^(btc|eth|sol|xrp)-updown/i);
    const coin = coinMatch ? coinMatch[1].toUpperCase() : '';

    if (!coin) return;

    const trade: WhaleTrade = {
      timestamp: Date.now(),
      whale: whaleConfig.name,
      walletAddr,
      coin,
      slug,
      side: payload.side as 'BUY' | 'SELL',
      outcome: payload.outcome as 'Up' | 'Down',
      size: payload.size || 0,
      price: payload.price || 0,
      usdcValue: (payload.size || 0) * (payload.price || 0),
      txHash: payload.transactionHash || '',
      remainingSec: 0, // Will be calculated by consumer
      chainlinkPrice: priceCache.getChainlinkPrice(coin),
      priceToBeat: 0, // Will be filled by consumer
      tokenUp: priceCache.getTokenPrices(coin).up,
      tokenDown: priceCache.getTokenPrices(coin).down,
      isAligned: false, // Will be calculated
      priceDiffPct: 0 // Will be calculated
    };

    // Store trade
    this.allTrades.push(trade);
    if (this.allTrades.length > MAX_TRADE_HISTORY) {
      this.allTrades.shift();
    }

    // Update recent trades by whale
    if (!this.recentByWhale.has(whaleConfig.name)) {
      this.recentByWhale.set(whaleConfig.name, []);
    }
    this.recentByWhale.get(whaleConfig.name)!.push(trade);
    this.cleanupRecentTrades(this.recentByWhale.get(whaleConfig.name)!);

    // Update recent trades by coin
    if (!this.recentByCoin.has(coin)) {
      this.recentByCoin.set(coin, []);
    }
    this.recentByCoin.get(coin)!.push(trade);
    this.cleanupRecentTrades(this.recentByCoin.get(coin)!);

    // Update position tracking
    if (trade.side === 'BUY') {
      this.updatePosition(trade);
    }

    // Emit trade event
    this.emit('trade', trade);
    this.emit(`trade:${coin}`, trade);
    this.emit(`trade:${whaleConfig.name}`, trade);
  }

  private updatePosition(trade: WhaleTrade): void {
    const key = `${trade.whale}-${trade.coin}-${trade.outcome}`;

    let position = this.positions.get(key);

    if (!position) {
      position = {
        whale: trade.whale,
        coin: trade.coin,
        outcome: trade.outcome,
        totalSize: 0,
        totalValue: 0,
        avgPrice: 0,
        fills: [],
        firstSeen: trade.timestamp,
        lastUpdate: trade.timestamp
      };
      this.positions.set(key, position);
    }

    // Add fill
    const fill: WhaleFill = {
      size: trade.size,
      price: trade.price,
      timestamp: trade.timestamp
    };
    position.fills.push(fill);

    // Update totals
    position.totalSize += trade.size;
    position.totalValue += trade.usdcValue;
    position.avgPrice = position.totalValue / position.totalSize;
    position.lastUpdate = trade.timestamp;
  }

  private cleanupRecentTrades(trades: WhaleTrade[]): void {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    while (trades.length > 0 && trades[0].timestamp < cutoff) {
      trades.shift();
    }
  }
}

// Singleton
let instance: WhaleTracker | null = null;

export function getWhaleTracker(): WhaleTracker {
  if (!instance) {
    instance = new WhaleTracker();
  }
  return instance;
}

export default WhaleTracker;
