/**
 * BASE STRATEGY
 *
 * Abstract base class for all trading strategies
 * Provides common functionality:
 * - Market state management
 * - Risk management
 * - Position tracking
 * - Logging
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import {
  StrategyConfig,
  TradeSignal,
  TradeExecution,
  MarketState,
  RiskState,
  PositionState,
  WhaleTrade,
  StrategyType
} from './types';
import { getPriceCache } from '../data/price-cache';
import { getWhaleTracker } from '../analysis/whale-tracker';
import { getWebSocketManager } from '../data/websocket-manager';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const SUPPORTED_COINS = ['BTC', 'ETH', 'SOL', 'XRP'];

export abstract class BaseStrategy extends EventEmitter {
  protected config: StrategyConfig;
  protected markets: Map<string, MarketState> = new Map();
  protected positions: Map<string, PositionState> = new Map();
  protected risk: RiskState;
  protected isRunning: boolean = false;

  // Timers
  protected marketDiscoveryTimer: NodeJS.Timeout | null = null;
  protected marketDiscoveryInterval: number = 30000; // 30s

  constructor(config: StrategyConfig) {
    super();
    this.config = config;

    // Initialize risk state
    this.risk = {
      dailyPnL: 0,
      dailyTrades: 0,
      dailyWins: 0,
      dailyLosses: 0,
      consecutiveLosses: 0,
      lastLossTime: 0,
      isPaused: false
    };
  }

  /**
   * Start the strategy
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log(`[${this.config.name}] Starting strategy...`);

    // Connect WebSocket
    const ws = getWebSocketManager();
    if (!ws.connected) {
      ws.connect();
    }

    // Start price cache polling
    const priceCache = getPriceCache();
    priceCache.startPolling();

    // Initial market discovery
    await this.discoverMarkets();

    // Start periodic market discovery
    this.marketDiscoveryTimer = setInterval(() => {
      this.discoverMarkets();
    }, this.marketDiscoveryInterval);

    // Subscribe to whale trades
    const whaleTracker = getWhaleTracker();
    whaleTracker.on('trade', (trade: WhaleTrade) => this.onWhaleTrade(trade));

    this.isRunning = true;
    this.emit('started');

    console.log(`[${this.config.name}] Strategy started`);
  }

  /**
   * Stop the strategy
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log(`[${this.config.name}] Stopping strategy...`);

    if (this.marketDiscoveryTimer) {
      clearInterval(this.marketDiscoveryTimer);
      this.marketDiscoveryTimer = null;
    }

    this.isRunning = false;
    this.emit('stopped');

    console.log(`[${this.config.name}] Strategy stopped`);
  }

  /**
   * Get strategy type
   */
  get type(): StrategyType {
    return this.config.type;
  }

  /**
   * Get current config
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Get risk state
   */
  getRiskState(): RiskState {
    return { ...this.risk };
  }

  /**
   * Get all markets
   */
  getMarkets(): Map<string, MarketState> {
    return new Map(this.markets);
  }

  /**
   * Get market by coin
   */
  getMarket(coin: string): MarketState | undefined {
    return this.markets.get(coin.toUpperCase());
  }

  // ============================================================================
  // ABSTRACT METHODS - Must be implemented by subclasses
  // ============================================================================

  /**
   * Called when a whale trade is detected
   * Subclasses should implement their strategy logic here
   */
  protected abstract onWhaleTrade(trade: WhaleTrade): void;

  /**
   * Evaluate whether to enter a trade
   * Returns a TradeSignal if conditions are met, null otherwise
   */
  protected abstract evaluate(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): TradeSignal | null;

  // ============================================================================
  // PROTECTED METHODS - Available to subclasses
  // ============================================================================

  /**
   * Check if we can trade (risk management)
   */
  protected canTrade(): boolean {
    // Check if paused
    if (this.risk.isPaused) {
      return false;
    }

    // Check daily loss limit
    if (Math.abs(this.risk.dailyPnL) >= this.config.maxDailyLoss) {
      this.pauseTrading('Daily loss limit reached');
      return false;
    }

    // Check consecutive losses
    if (this.risk.consecutiveLosses >= 3) {
      const cooldownRemaining = this.risk.lastLossTime + this.config.cooldownAfterLoss - Date.now();
      if (cooldownRemaining > 0) {
        return false;
      }
      // Reset consecutive losses after cooldown
      this.risk.consecutiveLosses = 0;
    }

    return true;
  }

  /**
   * Check if timing is right for entry
   */
  protected isTimingValid(coin: string): boolean {
    const market = this.markets.get(coin);
    if (!market) return false;

    const now = Date.now();
    const remainingSec = Math.floor((market.endTime - now) / 1000);

    return remainingSec >= this.config.minTimeRemaining &&
           remainingSec <= this.config.maxTimeRemaining;
  }

  /**
   * Get remaining seconds for a market
   */
  protected getRemainingSeconds(coin: string): number {
    const market = this.markets.get(coin);
    if (!market) return 0;
    return Math.max(0, Math.floor((market.endTime - Date.now()) / 1000));
  }

  /**
   * Check if price is acceptable for entry
   */
  protected isPriceAcceptable(tokenPrice: number): boolean {
    return tokenPrice <= this.config.maxEntryPrice && tokenPrice >= 0.01;
  }

  /**
   * Pause trading
   */
  protected pauseTrading(reason: string): void {
    this.risk.isPaused = true;
    this.risk.pauseReason = reason;
    console.log(`[${this.config.name}] Trading paused: ${reason}`);
    this.emit('paused', reason);
  }

  /**
   * Resume trading
   */
  protected resumeTrading(): void {
    this.risk.isPaused = false;
    this.risk.pauseReason = undefined;
    console.log(`[${this.config.name}] Trading resumed`);
    this.emit('resumed');
  }

  /**
   * Record a trade result
   */
  protected recordTradeResult(won: boolean, profit: number): void {
    this.risk.dailyTrades++;
    this.risk.dailyPnL += profit;

    if (won) {
      this.risk.dailyWins++;
      this.risk.consecutiveLosses = 0;
    } else {
      this.risk.dailyLosses++;
      this.risk.consecutiveLosses++;
      this.risk.lastLossTime = Date.now();
    }

    this.emit('tradeResult', { won, profit });
  }

  /**
   * Execute a trade signal
   */
  protected async executeSignal(signal: TradeSignal): Promise<TradeExecution> {
    const execution: TradeExecution = {
      signal,
      status: 'pending',
      executionTime: Date.now()
    };

    // Emit signal for external execution
    this.emit('signal', signal);

    // In dry run mode, just log
    if (true) { // TODO: Check dry run config
      console.log(`[${this.config.name}] SIGNAL: ${signal.side} ${signal.outcome} ${signal.coin} @ ${(signal.price * 100).toFixed(0)}¢ ($${signal.amount.toFixed(2)}) [${signal.confidence}% confidence]`);
      execution.status = 'filled';
      execution.executedPrice = signal.price;
      execution.executedSize = signal.amount / signal.price;
    }

    return execution;
  }

  /**
   * Discover active markets
   */
  protected async discoverMarkets(): Promise<void> {
    const now = Date.now();
    const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    const timestamps = [
      Math.floor(currentInterval / 1000),
      Math.floor((currentInterval + 15 * 60 * 1000) / 1000)
    ];

    const priceCache = getPriceCache();

    for (const crypto of SUPPORTED_COINS) {
      // Skip if already have active market
      const existing = this.markets.get(crypto);
      if (existing && existing.endTime > now) continue;

      for (const ts of timestamps) {
        const slug = `${crypto.toLowerCase()}-updown-15m-${ts}`;

        try {
          const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
          if (!res.data?.[0] || res.data[0].closed) continue;

          const market = res.data[0];
          const endTime = new Date(market.endDate || market.endDateIso).getTime();
          if (endTime < now || endTime > now + 20 * 60 * 1000) continue;

          const tokenIds = JSON.parse(market.clobTokenIds || '[]');
          const outcomes = JSON.parse(market.outcomes || '[]');

          let upTokenId = '', downTokenId = '';
          for (let i = 0; i < outcomes.length; i++) {
            if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
            if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
          }

          if (!upTokenId || !downTokenId) continue;

          const priceToBeat = await this.fetchPriceToBeat(slug, crypto);

          const marketState: MarketState = {
            slug,
            coin: crypto,
            upTokenId,
            downTokenId,
            endTime,
            priceToBeat,
            eventStartTime: market.eventStartTime || '',
            lastUpdate: now
          };

          this.markets.set(crypto, marketState);

          // Register with price cache
          priceCache.registerMarket(crypto, upTokenId, downTokenId);

          console.log(`[${this.config.name}] Market: ${crypto} Target=$${priceToBeat.toFixed(2)} Remaining=${Math.floor((endTime - now) / 1000)}s`);
          break;
        } catch {
          // Ignore errors, continue to next timestamp
        }
      }
    }

    // Cleanup expired markets
    const expiredCoins: string[] = [];
    this.markets.forEach((market, coin) => {
      if (market.endTime < now - 5000) {
        expiredCoins.push(coin);
      }
    });
    expiredCoins.forEach(coin => {
      this.markets.delete(coin);
      priceCache.unregisterMarket(coin);
    });
  }

  /**
   * Fetch price to beat from Polymarket
   */
  protected async fetchPriceToBeat(slug: string, coin: string, retries: number = 3): Promise<number> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 2000));
        }

        const url = `https://polymarket.com/event/${slug}`;
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        const html = response.data;
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
        if (!match) continue;

        const nextData = JSON.parse(match[1]);
        const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];

        for (const query of queries) {
          const queryKey = query.queryKey || [];
          if (queryKey[0] === 'crypto-prices' && queryKey[1] === 'price') {
            const data = query.state?.data;
            if (data && typeof data.openPrice === 'number' && data.openPrice > 0) {
              return data.openPrice;
            }
          }
        }
      } catch {
        // Continue to next retry
      }
    }
    return 0;
  }

  /**
   * Log a message with strategy prefix
   */
  protected log(message: string): void {
    console.log(`[${this.config.name}] ${message}`);
  }
}

export default BaseStrategy;
