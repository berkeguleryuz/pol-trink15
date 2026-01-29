/**
 * MIRROR STRATEGY
 *
 * Copies whale trades instantly with minimal decision time.
 * Goal: Execute faster than the market can react to whale movement.
 *
 * Key Features:
 * - Instant trade copy on whale detection
 * - Pre-signed order templates (future enhancement)
 * - Minimal latency pipeline
 * - 10% of whale size (mirror ratio)
 */

import {
  StrategyConfig,
  TradeSignal,
  WhaleTrade,
} from './types';
import { BaseStrategy } from './base-strategy';
import { getPriceCache } from '../data/price-cache';
import { quickKelly, KELLY_CONFIGS } from '../utils/kelly-calculator';

// Mirror Strategy Default Configuration
export const MIRROR_DEFAULT_CONFIG: StrategyConfig = {
  name: 'Mirror',
  type: 'mirror',
  enabled: true,

  // Position sizing
  baseAmount: 1,              // $1 base
  maxPerTrade: 5,             // $5 max per trade
  maxPerMarket: 15,           // $15 max per market
  maxDailyLoss: 10,           // $10 daily max loss
  kellyFraction: 0.25,        // 25% Kelly

  // Timing
  minTimeRemaining: 30,       // At least 30 seconds
  maxTimeRemaining: 600,      // Up to 10 minutes

  // Entry conditions
  minWhaleSize: 10,           // Whale trades $10+
  maxEntryPrice: 0.85,        // Don't buy above 85¢
  minSpread: 0.10,            // 10¢ minimum spread

  // Risk management
  stopLossPrice: 0.50,        // Exit at 50¢
  cooldownAfterLoss: 60000,   // 1 minute cooldown
};

// Mirror ratio - copy 10% of whale size
const MIRROR_RATIO = 0.10;

export class MirrorStrategy extends BaseStrategy {
  // Track recent copies to avoid duplicates
  private recentCopies: Map<string, number> = new Map();
  private copyDedupeWindow: number = 5000; // 5 seconds

  // Per-market spend tracking
  private marketSpend: Map<string, number> = new Map();

  constructor(config: Partial<StrategyConfig> = {}) {
    super({ ...MIRROR_DEFAULT_CONFIG, ...config });
  }

  /**
   * Handle whale trade - INSTANT COPY
   */
  protected onWhaleTrade(trade: WhaleTrade): void {
    if (!this.isRunning) return;

    // Only copy BUY trades
    if (trade.side !== 'BUY') {
      this.log(`Skip SELL: ${trade.whale} ${trade.coin} ${trade.outcome}`);
      return;
    }

    // Check minimum whale size
    if (trade.usdcValue < this.config.minWhaleSize) {
      this.log(`Skip small trade: $${trade.usdcValue.toFixed(2)} < $${this.config.minWhaleSize}`);
      return;
    }

    // Check for duplicate
    const copyKey = `${trade.whale}-${trade.coin}-${trade.outcome}`;
    const lastCopy = this.recentCopies.get(copyKey);
    if (lastCopy && Date.now() - lastCopy < this.copyDedupeWindow) {
      this.log(`Skip duplicate: ${copyKey}`);
      return;
    }

    // Evaluate and potentially execute
    const signal = this.evaluate(trade.coin, trade.outcome, trade);
    if (signal) {
      this.recentCopies.set(copyKey, Date.now());
      this.executeSignal(signal);
    }
  }

  /**
   * Evaluate whether to mirror this trade
   */
  protected evaluate(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): TradeSignal | null {
    // Must have whale trade for mirror strategy
    if (!whaleTrade) return null;

    // Check risk management
    if (!this.canTrade()) {
      this.log(`Risk check failed`);
      return null;
    }

    // Check timing
    if (!this.isTimingValid(coin)) {
      this.log(`Timing invalid for ${coin}`);
      return null;
    }

    const market = this.getMarket(coin);
    if (!market) {
      this.log(`No market for ${coin}`);
      return null;
    }

    const priceCache = getPriceCache();
    const prices = priceCache.getPrices(coin);
    const tokenPrice = outcome === 'Up' ? prices.up : prices.down;

    // Check price conditions
    if (!this.isPriceAcceptable(tokenPrice)) {
      this.log(`Price ${(tokenPrice * 100).toFixed(0)}¢ > max ${(this.config.maxEntryPrice * 100).toFixed(0)}¢`);
      return null;
    }

    // Check spread
    if (prices.spread < this.config.minSpread) {
      this.log(`Spread ${(prices.spread * 100).toFixed(0)}¢ < min ${(this.config.minSpread * 100).toFixed(0)}¢`);
      return null;
    }

    // Check per-market limit
    const currentSpend = this.marketSpend.get(market.slug) || 0;
    if (currentSpend >= this.config.maxPerMarket) {
      this.log(`Market limit reached: $${currentSpend.toFixed(2)}`);
      return null;
    }

    // Calculate position size
    const amount = this.calculateAmount(whaleTrade, tokenPrice, market.slug);
    if (amount <= 0) {
      return null;
    }

    // Calculate confidence (mirror is relatively simple - base on price and alignment)
    const confidence = this.calculateConfidence(whaleTrade, prices, market);

    // Create signal
    const signal: TradeSignal = {
      timestamp: Date.now(),
      strategy: 'mirror',
      coin,
      slug: market.slug,
      outcome,
      side: 'BUY',
      price: tokenPrice,
      amount,
      confidence,
      reason: `Mirror ${whaleTrade.whale} BUY ${outcome} @ ${(whaleTrade.price * 100).toFixed(0)}¢`,
      metadata: {
        whaleWallet: whaleTrade.walletAddr,
        whaleName: whaleTrade.whale,
        whaleSize: whaleTrade.size,
        whaleValue: whaleTrade.usdcValue,
        whalePrice: whaleTrade.price,
        chainlinkPrice: prices.chainlink,
        priceToBeat: market.priceToBeat,
        remainingSec: this.getRemainingSeconds(coin)
      }
    };

    // Update market spend
    this.marketSpend.set(market.slug, currentSpend + amount);

    return signal;
  }

  /**
   * Calculate trade amount based on whale trade
   */
  private calculateAmount(
    whaleTrade: WhaleTrade,
    tokenPrice: number,
    slug: string
  ): number {
    // Base calculation: mirror ratio of whale trade
    let amount = whaleTrade.usdcValue * MIRROR_RATIO;

    // Apply Kelly sizing
    const kelly = quickKelly(
      0.65, // Estimated 65% win rate for mirror
      tokenPrice,
      this.config.kellyFraction,
      100, // Assume $100 bankroll for now
      this.config.maxPerTrade,
      this.config.baseAmount
    );

    // Use the smaller of mirror amount and Kelly amount
    amount = Math.min(amount, kelly.betSize);

    // Apply limits
    amount = Math.max(amount, this.config.baseAmount);
    amount = Math.min(amount, this.config.maxPerTrade);

    // Check remaining market budget
    const currentSpend = this.marketSpend.get(slug) || 0;
    const remainingBudget = this.config.maxPerMarket - currentSpend;
    amount = Math.min(amount, remainingBudget);

    return Math.round(amount * 100) / 100; // Round to cents
  }

  /**
   * Calculate confidence score for mirror trade
   */
  private calculateConfidence(
    whaleTrade: WhaleTrade,
    prices: { chainlink: number; up: number; down: number; spread: number },
    market: any
  ): number {
    let score = 50; // Base confidence

    // Whale reliability bonus
    if (whaleTrade.whale === 'Whale-B') {
      score += 5; // Whale-B is slightly more reliable
    }

    // Price alignment bonus
    const priceDiff = prices.chainlink - market.priceToBeat;
    const isAligned = (whaleTrade.outcome === 'Up' && priceDiff >= 0) ||
                      (whaleTrade.outcome === 'Down' && priceDiff < 0);
    if (isAligned) {
      score += 15;
    }

    // Good odds bonus (cheaper entry = higher confidence)
    const entryPrice = whaleTrade.outcome === 'Up' ? prices.up : prices.down;
    if (entryPrice < 0.60) score += 10;
    else if (entryPrice < 0.70) score += 5;
    else if (entryPrice > 0.85) score -= 10;

    // Spread bonus (higher spread = clearer direction)
    if (prices.spread > 0.30) score += 10;
    else if (prices.spread > 0.20) score += 5;

    // Whale trade size bonus
    if (whaleTrade.usdcValue >= 50) score += 5;
    else if (whaleTrade.usdcValue >= 20) score += 3;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Reset market spend at period boundaries
   */
  public resetMarketSpend(slug?: string): void {
    if (slug) {
      this.marketSpend.delete(slug);
    } else {
      this.marketSpend.clear();
    }
  }
}

export default MirrorStrategy;
