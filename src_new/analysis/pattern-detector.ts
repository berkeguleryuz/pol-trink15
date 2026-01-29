/**
 * PATTERN DETECTOR
 *
 * Detects profitable whale trading patterns:
 * 1. High-Conviction Entry: Whale buys at 90¢+
 * 2. Momentum Aligned: All signals point same direction
 * 3. Late Surge: Big whale entry in last 45 seconds
 * 4. Both Whales: Both whales buying same direction
 * 5. Contrarian: Against momentum (usually avoid)
 */

import { PatternMatch, PatternType, WhaleTrade } from '../strategies/types';
import { getWhaleTracker } from './whale-tracker';
import { getPriceCache } from '../data/price-cache';

export interface PatternContext {
  coin: string;
  outcome: 'Up' | 'Down';
  chainlinkPrice: number;
  priceToBeat: number;
  tokenPriceUp: number;
  tokenPriceDown: number;
  remainingSec: number;
  latestWhaleTrade?: WhaleTrade;
}

/**
 * Detect all matching patterns
 */
export function detectPatterns(context: PatternContext): PatternMatch[] {
  const patterns: PatternMatch[] = [];

  // Check each pattern type
  const highConviction = detectHighConviction(context);
  if (highConviction) patterns.push(highConviction);

  const momentumAligned = detectMomentumAligned(context);
  if (momentumAligned) patterns.push(momentumAligned);

  const lateSurge = detectLateSurge(context);
  if (lateSurge) patterns.push(lateSurge);

  const bothWhales = detectBothWhales(context);
  if (bothWhales) patterns.push(bothWhales);

  const contrarian = detectContrarian(context);
  if (contrarian) patterns.push(contrarian);

  // Sort by confidence (highest first)
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the best (highest confidence) pattern
 */
export function getBestPattern(context: PatternContext): PatternMatch | null {
  const patterns = detectPatterns(context);
  return patterns.length > 0 ? patterns[0] : null;
}

/**
 * Check if any profitable pattern exists
 */
export function hasProfitablePattern(context: PatternContext): boolean {
  const patterns = detectPatterns(context);
  // Exclude contrarian as it's typically not profitable
  return patterns.some(p => p.type !== 'contrarian' && p.confidence >= 70);
}

// ============================================================================
// PATTERN DETECTORS
// ============================================================================

/**
 * Pattern 1: High-Conviction Entry
 * Whale buys at 88¢+ = Very confident
 * Historical win rate: ~85%+
 */
function detectHighConviction(context: PatternContext): PatternMatch | null {
  const { latestWhaleTrade, outcome, tokenPriceUp, tokenPriceDown, remainingSec } = context;

  if (!latestWhaleTrade) return null;
  if (latestWhaleTrade.side !== 'BUY') return null;
  if (latestWhaleTrade.outcome !== outcome) return null;

  const whalePrice = latestWhaleTrade.price;
  const tokenPrice = outcome === 'Up' ? tokenPriceUp : tokenPriceDown;
  const spread = Math.abs(tokenPriceUp - tokenPriceDown);

  // High conviction criteria
  const isHighPrice = whalePrice >= 0.88;
  const isHighSpread = spread >= 0.25;
  const isLateTiming = remainingSec <= 120;

  if (!isHighPrice) return null;

  let confidence = 70; // Base for high price

  if (isHighSpread) confidence += 10;
  if (isLateTiming) confidence += 5;
  if (whalePrice >= 0.92) confidence += 5;
  if (latestWhaleTrade.usdcValue >= 20) confidence += 5;

  return {
    type: 'high_conviction',
    confidence: Math.min(95, confidence),
    details: {
      whalePrice,
      tokenPrice,
      spread,
      remainingSec,
      whaleValue: latestWhaleTrade.usdcValue
    }
  };
}

/**
 * Pattern 2: Momentum Aligned
 * Real price momentum + Whale trade + Token odds all aligned
 * Historical win rate: ~80%+
 */
function detectMomentumAligned(context: PatternContext): PatternMatch | null {
  const { coin, outcome, chainlinkPrice, priceToBeat, tokenPriceUp, tokenPriceDown, latestWhaleTrade } = context;

  if (priceToBeat <= 0) return null;

  // Calculate price momentum
  const priceDiff = chainlinkPrice - priceToBeat;
  const priceDiffPct = Math.abs(priceDiff / priceToBeat);
  const priceDirection = priceDiff >= 0 ? 'Up' : 'Down';

  // Check alignment
  const priceAligned = priceDirection === outcome;
  const oddsAligned = (outcome === 'Up' ? tokenPriceUp : tokenPriceDown) >= 0.55;
  const whaleAligned = latestWhaleTrade?.outcome === outcome && latestWhaleTrade?.side === 'BUY';

  // Need at least price + odds aligned
  if (!priceAligned || !oddsAligned) return null;

  // Check momentum strength
  const hasMomentum = priceDiffPct >= 0.002; // 0.2%+
  if (!hasMomentum) return null;

  let confidence = 65; // Base for aligned momentum

  if (whaleAligned) confidence += 15;
  if (priceDiffPct >= 0.005) confidence += 5; // Strong momentum
  if (priceDiffPct >= 0.01) confidence += 5;  // Very strong momentum

  // Check if both whales agree
  const whaleTracker = getWhaleTracker();
  if (whaleTracker.bothWhalesAgree(coin, outcome, 60)) {
    confidence += 10;
  }

  return {
    type: 'momentum_aligned',
    confidence: Math.min(95, confidence),
    details: {
      priceDirection,
      priceDiffPct: priceDiffPct * 100,
      oddsAligned,
      whaleAligned,
      chainlinkPrice,
      priceToBeat
    }
  };
}

/**
 * Pattern 3: Late Surge
 * Whale enters big in last 45 seconds with high conviction
 * Historical win rate: ~75%+ (but higher profit per trade)
 */
function detectLateSurge(context: PatternContext): PatternMatch | null {
  const { coin, outcome, remainingSec, latestWhaleTrade, tokenPriceUp, tokenPriceDown } = context;

  // Must be in late window
  if (remainingSec > 45 || remainingSec < 15) return null;

  if (!latestWhaleTrade) return null;
  if (latestWhaleTrade.side !== 'BUY') return null;
  if (latestWhaleTrade.outcome !== outcome) return null;

  // Must be a big trade
  const isBigTrade = latestWhaleTrade.usdcValue >= 30;
  if (!isBigTrade) return null;

  const tokenPrice = outcome === 'Up' ? tokenPriceUp : tokenPriceDown;

  // Must be high conviction price
  if (tokenPrice < 0.80) return null;

  let confidence = 70; // Base for late surge

  if (latestWhaleTrade.usdcValue >= 50) confidence += 5;
  if (latestWhaleTrade.usdcValue >= 100) confidence += 5;
  if (tokenPrice >= 0.90) confidence += 5;

  // Check momentum
  const priceCache = getPriceCache();
  const prices = priceCache.getPrices(coin);
  const market = context.priceToBeat;
  if (market > 0) {
    const priceDiff = prices.chainlink - market;
    const isAligned = (outcome === 'Up' && priceDiff >= 0) || (outcome === 'Down' && priceDiff < 0);
    if (isAligned) confidence += 5;
  }

  return {
    type: 'late_surge',
    confidence: Math.min(90, confidence),
    details: {
      remainingSec,
      whaleValue: latestWhaleTrade.usdcValue,
      tokenPrice,
      whale: latestWhaleTrade.whale
    }
  };
}

/**
 * Pattern 4: Both Whales
 * Both tracked whales buying same direction
 * Historical win rate: ~87%
 */
function detectBothWhales(context: PatternContext): PatternMatch | null {
  const { coin, outcome } = context;

  const whaleTracker = getWhaleTracker();
  if (!whaleTracker.bothWhalesAgree(coin, outcome, 60)) {
    return null;
  }

  // Get recent trades from both whales
  const recentTrades = whaleTracker.getRecentTradesByCoin(coin, 60);
  const whaleATrades = recentTrades.filter(t => t.whale === 'Whale-A' && t.side === 'BUY' && t.outcome === outcome);
  const whaleBTrades = recentTrades.filter(t => t.whale === 'Whale-B' && t.side === 'BUY' && t.outcome === outcome);

  const whaleAValue = whaleATrades.reduce((sum, t) => sum + t.usdcValue, 0);
  const whaleBValue = whaleBTrades.reduce((sum, t) => sum + t.usdcValue, 0);
  const totalValue = whaleAValue + whaleBValue;

  let confidence = 80; // High base for dual whale confirmation

  if (totalValue >= 50) confidence += 5;
  if (totalValue >= 100) confidence += 5;
  if (totalValue >= 200) confidence += 5;

  return {
    type: 'both_whales',
    confidence: Math.min(95, confidence),
    details: {
      whaleAValue,
      whaleBValue,
      totalValue,
      whaleATradeCount: whaleATrades.length,
      whaleBTradeCount: whaleBTrades.length
    }
  };
}

/**
 * Pattern 5: Contrarian
 * Whale trading against momentum - usually avoid
 * Historical win rate: ~45%
 */
function detectContrarian(context: PatternContext): PatternMatch | null {
  const { outcome, chainlinkPrice, priceToBeat, latestWhaleTrade } = context;

  if (!latestWhaleTrade) return null;
  if (priceToBeat <= 0) return null;

  const priceDiff = chainlinkPrice - priceToBeat;
  const priceDirection = priceDiff >= 0 ? 'Up' : 'Down';

  // Check if whale is trading against momentum
  const isContrarian = priceDirection !== outcome && latestWhaleTrade.outcome === outcome;

  if (!isContrarian) return null;

  // This is a warning pattern - low confidence by default
  let confidence = 35;

  // Some scenarios where contrarian might work
  const priceDiffPct = Math.abs(priceDiff / priceToBeat);
  if (priceDiffPct < 0.001) confidence += 10; // Very small momentum - might reverse

  if (latestWhaleTrade.usdcValue >= 100) confidence += 10; // Big whale might know something

  return {
    type: 'contrarian',
    confidence: Math.min(55, confidence), // Cap at 55 - still risky
    details: {
      priceDirection,
      whaleDirection: outcome,
      priceDiffPct: priceDiffPct * 100,
      warning: 'Trading against momentum - higher risk'
    }
  };
}

/**
 * Get pattern win rate estimates (based on historical data)
 */
export function getPatternWinRate(type: PatternType): number {
  const rates: Record<PatternType, number> = {
    'both_whales': 0.87,
    'high_conviction': 0.85,
    'momentum_aligned': 0.80,
    'late_surge': 0.75,
    'contrarian': 0.45
  };
  return rates[type] || 0.50;
}

export default detectPatterns;
