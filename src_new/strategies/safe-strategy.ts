/**
 * SAFE STRATEGY
 *
 * Conservative strategy that only trades on high-confidence patterns:
 * - Both whales agreeing (87% win rate)
 * - High conviction entries (85% win rate)
 * - Momentum aligned (80% win rate)
 * - Late surge with confirmation (75% win rate)
 *
 * Avoids contrarian patterns (45% win rate)
 */

import {
  StrategyConfig,
  TradeSignal,
  WhaleTrade,
  PatternMatch,
} from './types';
import { BaseStrategy } from './base-strategy';
import { getPriceCache } from '../data/price-cache';
import {
  detectPatterns,
  getBestPattern,
  getPatternWinRate,
  PatternContext
} from '../analysis/pattern-detector';
import { quickKelly } from '../utils/kelly-calculator';

// Safe Strategy Default Configuration
export const SAFE_DEFAULT_CONFIG: StrategyConfig = {
  name: 'Safe',
  type: 'safe',
  enabled: true,

  // Position sizing - Very conservative
  baseAmount: 2,              // $2 base
  maxPerTrade: 3,             // $3 max per trade
  maxPerMarket: 6,            // $6 max per market
  maxDailyLoss: 5,            // $5 daily max loss (strict)
  kellyFraction: 0.20,        // 20% Kelly (conservative)

  // Timing - Avoid too early or too late
  minTimeRemaining: 20,       // At least 20 seconds
  maxTimeRemaining: 90,       // Not more than 90 seconds (wait for clarity)

  // Entry conditions - Strict
  minWhaleSize: 15,           // Whale trades $15+
  maxEntryPrice: 0.82,        // Don't overpay (82¢ max)
  minSpread: 0.15,            // 15¢ minimum spread

  // Risk management - Conservative
  stopLossPrice: 0.55,        // Exit at 55¢ (not 50¢)
  cooldownAfterLoss: 300000,  // 5 minute cooldown after loss
};

// Minimum confidence for safe entry
const MIN_PATTERN_CONFIDENCE = 75;

// Patterns to avoid
const AVOID_PATTERNS = ['contrarian'];

export class SafeStrategy extends BaseStrategy {
  // Per-market spend tracking
  private marketSpend: Map<string, number> = new Map();

  // Detected patterns for logging
  private lastPatterns: Map<string, PatternMatch[]> = new Map();

  // Consecutive pattern tracking (for validation)
  private patternHistory: Map<string, PatternMatch[]> = new Map();

  constructor(config: Partial<StrategyConfig> = {}) {
    super({ ...SAFE_DEFAULT_CONFIG, ...config });
  }

  /**
   * Handle whale trade - Only act on high-confidence patterns
   */
  protected onWhaleTrade(trade: WhaleTrade): void {
    if (!this.isRunning) return;

    // Only consider BUY trades
    if (trade.side !== 'BUY') return;

    // Check minimum whale size
    if (trade.usdcValue < this.config.minWhaleSize) {
      return;
    }

    // Async evaluation
    this.evaluateAsync(trade.coin, trade.outcome, trade);
  }

  /**
   * Async evaluation with pattern detection
   */
  private async evaluateAsync(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): Promise<void> {
    const signal = this.evaluateWithPatterns(coin, outcome, whaleTrade);
    if (signal) {
      await this.executeSignal(signal);
    }
  }

  /**
   * Evaluate using pattern detection
   */
  private evaluateWithPatterns(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): TradeSignal | null {
    // Check risk management
    if (!this.canTrade()) {
      return null;
    }

    const market = this.getMarket(coin);
    if (!market) {
      return null;
    }

    const remainingSec = this.getRemainingSeconds(coin);

    // Safe strategy has strict timing windows
    if (remainingSec < this.config.minTimeRemaining || remainingSec > this.config.maxTimeRemaining) {
      return null;
    }

    const priceCache = getPriceCache();
    const prices = priceCache.getPrices(coin);
    const tokenPrice = outcome === 'Up' ? prices.up : prices.down;

    // Strict price check
    if (!this.isPriceAcceptable(tokenPrice)) {
      this.log(`Price ${(tokenPrice * 100).toFixed(0)}¢ > max ${(this.config.maxEntryPrice * 100).toFixed(0)}¢`);
      return null;
    }

    // Check spread requirement
    if (prices.spread < this.config.minSpread) {
      this.log(`Spread ${(prices.spread * 100).toFixed(0)}¢ < min ${(this.config.minSpread * 100).toFixed(0)}¢`);
      return null;
    }

    // Build pattern context
    const context: PatternContext = {
      coin,
      outcome,
      chainlinkPrice: prices.chainlink,
      priceToBeat: market.priceToBeat,
      tokenPriceUp: prices.up,
      tokenPriceDown: prices.down,
      remainingSec,
      latestWhaleTrade: whaleTrade
    };

    // Detect patterns
    const patterns = detectPatterns(context);
    this.lastPatterns.set(coin, patterns);

    // Log detected patterns
    if (patterns.length > 0) {
      this.log(`${coin} ${outcome} patterns: ${patterns.map(p => `${p.type}(${p.confidence})`).join(', ')}`);
    }

    // Find best profitable pattern
    const profitablePatterns = patterns.filter(p =>
      !AVOID_PATTERNS.includes(p.type) &&
      p.confidence >= MIN_PATTERN_CONFIDENCE
    );

    if (profitablePatterns.length === 0) {
      return null;
    }

    const bestPattern = profitablePatterns[0]; // Already sorted by confidence

    // Additional validation for safe strategy
    if (!this.validatePattern(bestPattern, context)) {
      return null;
    }

    // Check per-market limit
    const currentSpend = this.marketSpend.get(market.slug) || 0;
    if (currentSpend >= this.config.maxPerMarket) {
      this.log(`Market limit reached: $${currentSpend.toFixed(2)}`);
      return null;
    }

    // Calculate amount based on pattern
    const amount = this.calculateAmount(bestPattern, tokenPrice, market.slug);
    if (amount <= 0) {
      return null;
    }

    // Create signal
    const signal: TradeSignal = {
      timestamp: Date.now(),
      strategy: 'safe',
      coin,
      slug: market.slug,
      outcome,
      side: 'BUY',
      price: tokenPrice,
      amount,
      confidence: bestPattern.confidence,
      reason: `Safe ${bestPattern.type}: ${bestPattern.confidence}% confidence`,
      metadata: {
        pattern: bestPattern,
        allPatterns: patterns.map(p => ({ type: p.type, confidence: p.confidence })),
        chainlinkPrice: prices.chainlink,
        priceToBeat: market.priceToBeat,
        spread: prices.spread,
        remainingSec,
        whaleTrade: whaleTrade ? {
          whale: whaleTrade.whale,
          size: whaleTrade.size,
          price: whaleTrade.price,
          value: whaleTrade.usdcValue
        } : null
      }
    };

    // Update market spend
    this.marketSpend.set(market.slug, currentSpend + amount);

    return signal;
  }

  /**
   * Required abstract method - delegates to sync evaluation
   */
  protected evaluate(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): TradeSignal | null {
    return this.evaluateWithPatterns(coin, outcome, whaleTrade);
  }

  /**
   * Additional pattern validation for safe strategy
   */
  private validatePattern(pattern: PatternMatch, context: PatternContext): boolean {
    // Both whales pattern - always valid if detected
    if (pattern.type === 'both_whales') {
      return true;
    }

    // High conviction - require sufficient time
    if (pattern.type === 'high_conviction') {
      return context.remainingSec >= 30;
    }

    // Momentum aligned - require whale confirmation
    if (pattern.type === 'momentum_aligned') {
      return context.latestWhaleTrade !== undefined;
    }

    // Late surge - validate timing window
    if (pattern.type === 'late_surge') {
      return context.remainingSec >= 15 && context.remainingSec <= 45;
    }

    return true;
  }

  /**
   * Calculate amount based on pattern confidence and win rate
   */
  private calculateAmount(
    pattern: PatternMatch,
    tokenPrice: number,
    slug: string
  ): number {
    const winRate = getPatternWinRate(pattern.type);

    // Kelly calculation with pattern-specific win rate
    const kelly = quickKelly(
      winRate,
      tokenPrice,
      this.config.kellyFraction,
      50, // Conservative bankroll assumption
      this.config.maxPerTrade,
      this.config.baseAmount
    );

    // Apply confidence scaling
    const confidenceMultiplier = pattern.confidence / 100;
    let amount = kelly.betSize * confidenceMultiplier;

    // Apply limits
    amount = Math.max(amount, this.config.baseAmount);
    amount = Math.min(amount, this.config.maxPerTrade);

    // Check remaining market budget
    const currentSpend = this.marketSpend.get(slug) || 0;
    const remainingBudget = this.config.maxPerMarket - currentSpend;
    amount = Math.min(amount, remainingBudget);

    return Math.round(amount * 100) / 100;
  }

  /**
   * Get last detected patterns
   */
  public getLastPatterns(coin: string): PatternMatch[] {
    return this.lastPatterns.get(coin) || [];
  }

  /**
   * Reset market spend
   */
  public resetMarketSpend(slug?: string): void {
    if (slug) {
      this.marketSpend.delete(slug);
    } else {
      this.marketSpend.clear();
    }
  }

  /**
   * Override canTrade with additional safe checks
   */
  protected canTrade(): boolean {
    // Base checks
    if (!super.canTrade()) {
      return false;
    }

    // Additional safe strategy check: stop trading after 2 consecutive losses
    if (this.risk.consecutiveLosses >= 2) {
      const cooldownRemaining = this.risk.lastLossTime + this.config.cooldownAfterLoss - Date.now();
      if (cooldownRemaining > 0) {
        return false;
      }
    }

    return true;
  }
}

export default SafeStrategy;
