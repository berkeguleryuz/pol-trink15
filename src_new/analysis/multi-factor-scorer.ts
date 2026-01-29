/**
 * MULTI-FACTOR SCORER
 *
 * Scores trading opportunities based on multiple factors:
 * 1. Price Momentum (0-30 points)
 * 2. Order Book Imbalance (0-25 points)
 * 3. Whale Confirmation (0-25 points)
 * 4. Token Odds Quality (0-20 points)
 *
 * Total: 0-100 points
 */

import { ScoreFactors, OrderBookData } from '../strategies/types';
import { getWhaleTracker } from './whale-tracker';
import axios from 'axios';

const CLOB_API = 'https://clob.polymarket.com';

export interface ScoringContext {
  coin: string;
  outcome: 'Up' | 'Down';
  chainlinkPrice: number;
  priceToBeat: number;
  tokenPriceUp: number;
  tokenPriceDown: number;
  upTokenId: string;
  downTokenId: string;
  remainingSec: number;
}

/**
 * Calculate all scoring factors
 */
export async function calculateScore(context: ScoringContext): Promise<ScoreFactors> {
  const [momentum, orderBook, whaleConfirm, oddsQuality] = await Promise.all([
    calculateMomentumScore(context),
    calculateOrderBookScore(context),
    calculateWhaleConfirmationScore(context),
    calculateOddsQualityScore(context)
  ]);

  return {
    momentum,
    orderBookImbalance: orderBook,
    whaleConfirmation: whaleConfirm,
    tokenOddsQuality: oddsQuality,
    total: momentum + orderBook + whaleConfirm + oddsQuality
  };
}

/**
 * Factor 1: Price Momentum (0-30 points)
 *
 * Measures Chainlink price movement relative to price to beat
 * Higher movement in trade direction = higher score
 */
export function calculateMomentumScore(context: ScoringContext): number {
  const { chainlinkPrice, priceToBeat, outcome } = context;

  if (priceToBeat <= 0) return 0;

  const priceDiff = chainlinkPrice - priceToBeat;
  const priceDiffPct = Math.abs(priceDiff / priceToBeat);

  // Direction check - must match intended outcome
  const priceDirection = priceDiff >= 0 ? 'Up' : 'Down';
  if (priceDirection !== outcome) {
    // Counter-momentum trade - penalty but not zero (whales sometimes know better)
    return 5;
  }

  // Score based on momentum strength
  let score = 0;

  if (priceDiffPct > 0.001) score += 10;  // 0.1%+ movement
  if (priceDiffPct > 0.003) score += 10;  // 0.3%+ movement
  if (priceDiffPct > 0.005) score += 10;  // 0.5%+ movement

  return Math.min(30, score);
}

/**
 * Factor 2: Order Book Imbalance (0-25 points)
 *
 * Analyzes orderbook depth to detect buying/selling pressure
 */
export async function calculateOrderBookScore(context: ScoringContext): Promise<number> {
  try {
    const tokenId = context.outcome === 'Up' ? context.upTokenId : context.downTokenId;
    const orderBook = await fetchOrderBook(tokenId);

    if (!orderBook) return 10; // Neutral if unavailable

    const { imbalance } = orderBook;

    // For BUY Up: positive imbalance is good (more bids)
    // For BUY Down: negative imbalance is good (more asks on Up = bullish for Down)
    const favorableImbalance = context.outcome === 'Up' ? imbalance : -imbalance;

    let score = 0;

    if (favorableImbalance > 0.2) score += 15;
    if (favorableImbalance > 0.4) score += 10;

    // Penalty for unfavorable imbalance
    if (favorableImbalance < -0.2) score -= 5;

    return Math.max(0, Math.min(25, score));
  } catch {
    return 10; // Neutral on error
  }
}

/**
 * Factor 3: Whale Confirmation (0-25 points)
 *
 * Check if whales are trading in the same direction
 */
export function calculateWhaleConfirmationScore(context: ScoringContext): number {
  const whaleTracker = getWhaleTracker();
  return whaleTracker.getWhaleConfirmationScore(context.coin, context.outcome, 60);
}

/**
 * Factor 4: Token Odds Quality (0-20 points)
 *
 * Evaluates the quality of the betting odds
 */
export function calculateOddsQualityScore(context: ScoringContext): number {
  const { tokenPriceUp, tokenPriceDown, outcome } = context;

  const winnerPrice = Math.max(tokenPriceUp, tokenPriceDown);
  const spread = Math.abs(tokenPriceUp - tokenPriceDown);
  const entryPrice = outcome === 'Up' ? tokenPriceUp : tokenPriceDown;

  let score = 0;

  // Clear direction (high spread)
  if (spread > 0.10) score += 5;
  if (spread > 0.20) score += 5;
  if (spread > 0.30) score += 5;

  // Room to profit (not too expensive)
  if (entryPrice < 0.80) score += 5;
  else if (entryPrice > 0.90) score -= 5; // Penalty for expensive entries

  return Math.max(0, Math.min(20, score));
}

/**
 * Fetch order book from CLOB API
 */
async function fetchOrderBook(tokenId: string): Promise<OrderBookData | null> {
  try {
    const res = await axios.get(`${CLOB_API}/book?token_id=${tokenId}`, {
      timeout: 2000
    });

    const data = res.data;
    if (!data) return null;

    // Parse bids and asks
    const bids = (data.bids || []).slice(0, 5).map((b: any) => ({
      price: parseFloat(b.price),
      size: parseFloat(b.size)
    }));

    const asks = (data.asks || []).slice(0, 5).map((a: any) => ({
      price: parseFloat(a.price),
      size: parseFloat(a.size)
    }));

    // Calculate depths
    const bidDepth = bids.reduce((sum: number, b: { size: number }) => sum + b.size, 0);
    const askDepth = asks.reduce((sum: number, a: { size: number }) => sum + a.size, 0);

    // Calculate imbalance: -1 (all asks) to +1 (all bids)
    const totalDepth = bidDepth + askDepth;
    const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    // Calculate midpoint and spread
    const bestBid = bids.length > 0 ? bids[0].price : 0.5;
    const bestAsk = asks.length > 0 ? asks[0].price : 0.5;
    const midpoint = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    return { bids, asks, midpoint, spread, imbalance };
  } catch {
    return null;
  }
}

/**
 * Get score interpretation
 */
export function interpretScore(score: number): {
  level: 'strong_buy' | 'buy' | 'cautious_buy' | 'skip' | 'no_trade';
  kellySizeMultiplier: number;
} {
  if (score >= 90) {
    return { level: 'strong_buy', kellySizeMultiplier: 1.0 };
  } else if (score >= 80) {
    return { level: 'buy', kellySizeMultiplier: 0.75 };
  } else if (score >= 70) {
    return { level: 'cautious_buy', kellySizeMultiplier: 0.5 };
  } else if (score >= 60) {
    return { level: 'skip', kellySizeMultiplier: 0 };
  } else {
    return { level: 'no_trade', kellySizeMultiplier: 0 };
  }
}

export default calculateScore;
