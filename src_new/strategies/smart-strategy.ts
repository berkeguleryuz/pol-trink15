/**
 * SMART STRATEGY
 *
 * Makes intelligent trading decisions based on multiple factors:
 * - Price momentum (Chainlink movement)
 * - Order book imbalance
 * - Whale confirmation signals
 * - Token odds quality
 *
 * Entry requires minimum score of 70/100
 */

import {
  StrategyConfig,
  TradeSignal,
  WhaleTrade,
  ScoreFactors,
} from './types';
import { BaseStrategy } from './base-strategy';
import { getPriceCache } from '../data/price-cache';
import { calculateScore, interpretScore, ScoringContext } from '../analysis/multi-factor-scorer';
import { quickKelly } from '../utils/kelly-calculator';

// Smart Strategy Default Configuration
export const SMART_DEFAULT_CONFIG: StrategyConfig = {
  name: 'Smart',
  type: 'smart',
  enabled: true,

  // Position sizing
  baseAmount: 2,              // $2 base
  maxPerTrade: 10,            // $10 max per trade
  maxPerMarket: 25,           // $25 max per market
  maxDailyLoss: 15,           // $15 daily max loss
  kellyFraction: 0.30,        // 30% Kelly

  // Timing - Phase based
  minTimeRemaining: 15,       // At least 15 seconds (for final phase)
  maxTimeRemaining: 300,      // Up to 5 minutes

  // Entry conditions
  minWhaleSize: 5,            // Lower threshold - we use our own scoring
  maxEntryPrice: 0.88,        // Don't buy above 88¢
  minSpread: 0.05,            // 5¢ minimum spread

  // Risk management
  stopLossPrice: 0.50,        // Exit at 50¢
  cooldownAfterLoss: 120000,  // 2 minute cooldown
};

// Phase type for type safety
interface TradingPhase {
  start: number;
  end: number;
  minScore: number;
  requireMomentum?: boolean;
}

// Timing phases with different score thresholds
const SMART_PHASES: Record<string, TradingPhase> = {
  observation: { start: 181, end: 120, minScore: 90 },   // 181-120s: Only highest conviction
  earlyEntry: { start: 120, end: 60, minScore: 75 },     // 120-60s: Good opportunities
  active: { start: 60, end: 30, minScore: 65 },          // 60-30s: Aggressive
  final: { start: 30, end: 0, minScore: 70, requireMomentum: true }  // 30-0s: Momentum required
};

export class SmartStrategy extends BaseStrategy {
  // Per-market spend tracking
  private marketSpend: Map<string, number> = new Map();

  // Cooldown per coin (avoid over-trading same market)
  private coinCooldown: Map<string, number> = new Map();
  private cooldownDuration: number = 10000; // 10 seconds between trades on same coin

  // Last scores for logging
  private lastScores: Map<string, ScoreFactors> = new Map();

  constructor(config: Partial<StrategyConfig> = {}) {
    super({ ...SMART_DEFAULT_CONFIG, ...config });
  }

  /**
   * Handle whale trade - Trigger evaluation
   */
  protected onWhaleTrade(trade: WhaleTrade): void {
    if (!this.isRunning) return;

    // Only consider BUY trades
    if (trade.side !== 'BUY') return;

    // Check cooldown
    const lastTrade = this.coinCooldown.get(trade.coin);
    if (lastTrade && Date.now() - lastTrade < this.cooldownDuration) {
      return;
    }

    // Async evaluation
    this.evaluateAsync(trade.coin, trade.outcome, trade);
  }

  /**
   * Async evaluation with scoring
   */
  private async evaluateAsync(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): Promise<void> {
    const signal = await this.evaluateWithScore(coin, outcome, whaleTrade);
    if (signal) {
      this.coinCooldown.set(coin, Date.now());
      await this.executeSignal(signal);
    }
  }

  /**
   * Evaluate with full scoring
   */
  private async evaluateWithScore(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): Promise<TradeSignal | null> {
    // Check risk management
    if (!this.canTrade()) {
      return null;
    }

    const market = this.getMarket(coin);
    if (!market) {
      return null;
    }

    const remainingSec = this.getRemainingSeconds(coin);
    const phase = this.getCurrentPhase(remainingSec);
    if (!phase) {
      return null;
    }

    const priceCache = getPriceCache();
    const prices = priceCache.getPrices(coin);
    const tokenPrice = outcome === 'Up' ? prices.up : prices.down;

    // Check price conditions
    if (!this.isPriceAcceptable(tokenPrice)) {
      return null;
    }

    // Build scoring context
    const context: ScoringContext = {
      coin,
      outcome,
      chainlinkPrice: prices.chainlink,
      priceToBeat: market.priceToBeat,
      tokenPriceUp: prices.up,
      tokenPriceDown: prices.down,
      upTokenId: market.upTokenId,
      downTokenId: market.downTokenId,
      remainingSec
    };

    // Calculate score
    const scores = await calculateScore(context);
    this.lastScores.set(coin, scores);

    // Log score details
    this.log(`${coin} ${outcome}: Momentum=${scores.momentum} OBI=${scores.orderBookImbalance} Whale=${scores.whaleConfirmation} Odds=${scores.tokenOddsQuality} TOTAL=${scores.total}`);

    // Check phase-specific requirements
    if (scores.total < phase.minScore) {
      this.log(`Score ${scores.total} < phase min ${phase.minScore}`);
      return null;
    }

    // Final phase requires momentum
    if (phase.requireMomentum && scores.momentum < 10) {
      this.log(`Final phase requires momentum, got ${scores.momentum}`);
      return null;
    }

    // Check per-market limit
    const currentSpend = this.marketSpend.get(market.slug) || 0;
    if (currentSpend >= this.config.maxPerMarket) {
      this.log(`Market limit reached: $${currentSpend.toFixed(2)}`);
      return null;
    }

    // Calculate position size
    const interpretation = interpretScore(scores.total);
    const amount = this.calculateAmount(scores.total, tokenPrice, market.slug, interpretation.kellySizeMultiplier);
    if (amount <= 0) {
      return null;
    }

    // Create signal
    const signal: TradeSignal = {
      timestamp: Date.now(),
      strategy: 'smart',
      coin,
      slug: market.slug,
      outcome,
      side: 'BUY',
      price: tokenPrice,
      amount,
      confidence: scores.total,
      reason: `Smart ${interpretation.level}: Score ${scores.total} (M:${scores.momentum} O:${scores.orderBookImbalance} W:${scores.whaleConfirmation} Q:${scores.tokenOddsQuality})`,
      metadata: {
        scores,
        phase: this.getPhaseName(remainingSec),
        chainlinkPrice: prices.chainlink,
        priceToBeat: market.priceToBeat,
        remainingSec,
        whaleTrade: whaleTrade ? {
          whale: whaleTrade.whale,
          size: whaleTrade.size,
          price: whaleTrade.price
        } : null
      }
    };

    // Update market spend
    this.marketSpend.set(market.slug, currentSpend + amount);

    return signal;
  }

  /**
   * Required abstract method - delegates to async version
   */
  protected evaluate(
    coin: string,
    outcome: 'Up' | 'Down',
    whaleTrade?: WhaleTrade
  ): TradeSignal | null {
    // Trigger async evaluation
    this.evaluateAsync(coin, outcome, whaleTrade);
    return null; // Actual signal handled in async
  }

  /**
   * Get current trading phase based on remaining time
   */
  private getCurrentPhase(remainingSec: number): TradingPhase | null {
    if (remainingSec >= SMART_PHASES.observation.start) {
      return null; // Too early
    }
    if (remainingSec > SMART_PHASES.observation.end) {
      return SMART_PHASES.observation;
    }
    if (remainingSec > SMART_PHASES.earlyEntry.end) {
      return SMART_PHASES.earlyEntry;
    }
    if (remainingSec > SMART_PHASES.active.end) {
      return SMART_PHASES.active;
    }
    if (remainingSec >= SMART_PHASES.final.end) {
      return SMART_PHASES.final;
    }
    return null; // Expired
  }

  /**
   * Get phase name for logging
   */
  private getPhaseName(remainingSec: number): string {
    if (remainingSec > SMART_PHASES.observation.end) return 'observation';
    if (remainingSec > SMART_PHASES.earlyEntry.end) return 'earlyEntry';
    if (remainingSec > SMART_PHASES.active.end) return 'active';
    if (remainingSec >= SMART_PHASES.final.end) return 'final';
    return 'expired';
  }

  /**
   * Calculate trade amount based on score
   */
  private calculateAmount(
    score: number,
    tokenPrice: number,
    slug: string,
    kellySizeMultiplier: number
  ): number {
    // Base Kelly calculation
    const estimatedWinRate = 0.50 + ((score - 50) / 100); // Score 70 = 70% win rate estimate
    const kelly = quickKelly(
      estimatedWinRate,
      tokenPrice,
      this.config.kellyFraction,
      100, // Assume $100 bankroll
      this.config.maxPerTrade,
      this.config.baseAmount
    );

    // Apply score-based multiplier
    let amount = kelly.betSize * kellySizeMultiplier;

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
   * Get last calculated scores
   */
  public getLastScores(coin: string): ScoreFactors | undefined {
    return this.lastScores.get(coin);
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
   * Manually trigger evaluation (for testing)
   */
  public async manualEvaluate(
    coin: string,
    outcome: 'Up' | 'Down'
  ): Promise<TradeSignal | null> {
    return this.evaluateWithScore(coin, outcome);
  }
}

export default SmartStrategy;
