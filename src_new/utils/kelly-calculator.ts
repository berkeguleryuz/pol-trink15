/**
 * KELLY CALCULATOR
 *
 * Implements Kelly Criterion for optimal position sizing
 *
 * Full Kelly Formula: f* = (p * b - q) / b
 * Where:
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 *   b = odds received on the bet (payout ratio)
 *
 * Fractional Kelly is recommended (20-30%) to reduce volatility
 */

export interface KellyParams {
  winProbability: number;    // 0-1, estimated win probability
  odds: number;              // Decimal odds (e.g., 1.5 means 50% profit)
  kellyFraction: number;     // 0-1, fraction of Kelly to use (0.2-0.3 recommended)
  bankroll: number;          // Current bankroll
  maxBetSize: number;        // Maximum allowed bet
  minBetSize: number;        // Minimum bet (to avoid dust)
}

export interface KellyResult {
  fullKelly: number;         // Full Kelly percentage
  fractionalKelly: number;   // Adjusted Kelly percentage
  betSize: number;           // Actual bet size in dollars
  expectedValue: number;     // Expected value of the bet
  edge: number;              // Your edge (how much you expect to win per dollar)
  shouldBet: boolean;        // Whether the bet has positive EV
}

/**
 * Calculate Kelly Criterion bet size
 */
export function calculateKelly(params: KellyParams): KellyResult {
  const { winProbability, odds, kellyFraction, bankroll, maxBetSize, minBetSize } = params;

  // Validate inputs
  if (winProbability <= 0 || winProbability >= 1) {
    return noBet(bankroll);
  }

  if (odds <= 1) {
    return noBet(bankroll);
  }

  const p = winProbability;
  const q = 1 - p;
  const b = odds - 1; // Convert decimal odds to profit ratio

  // Full Kelly formula: f* = (p * b - q) / b
  const fullKelly = (p * b - q) / b;

  // If full Kelly is negative, don't bet
  if (fullKelly <= 0) {
    return noBet(bankroll);
  }

  // Apply fraction
  const fractionalKelly = fullKelly * kellyFraction;

  // Calculate bet size
  let betSize = bankroll * fractionalKelly;

  // Apply limits
  betSize = Math.max(betSize, minBetSize);
  betSize = Math.min(betSize, maxBetSize);
  betSize = Math.min(betSize, bankroll);

  // Calculate expected value
  const ev = (p * (odds - 1)) - q;
  const edge = ev; // Edge per dollar bet

  return {
    fullKelly: fullKelly * 100,          // As percentage
    fractionalKelly: fractionalKelly * 100, // As percentage
    betSize: Math.round(betSize * 100) / 100, // Round to cents
    expectedValue: ev,
    edge,
    shouldBet: true
  };
}

/**
 * Convert token price to probability
 * Token price directly represents market's implied probability
 */
export function tokenPriceToProb(tokenPrice: number): number {
  // Price of 0.80 means 80% implied probability
  return Math.max(0.01, Math.min(0.99, tokenPrice));
}

/**
 * Convert token price to decimal odds
 * If price is 0.80, odds are 1/0.80 = 1.25 (25% profit)
 */
export function tokenPriceToOdds(tokenPrice: number): number {
  if (tokenPrice <= 0) return 1;
  return 1 / tokenPrice;
}

/**
 * Quick Kelly calculation from token price and estimated win rate
 */
export function quickKelly(
  estimatedWinRate: number,
  tokenPrice: number,
  kellyFraction: number,
  bankroll: number,
  maxBet: number = 5,
  minBet: number = 1
): KellyResult {
  const odds = tokenPriceToOdds(tokenPrice);

  return calculateKelly({
    winProbability: estimatedWinRate,
    odds,
    kellyFraction,
    bankroll,
    maxBetSize: maxBet,
    minBetSize: minBet
  });
}

/**
 * Calculate bet size based on confidence score (0-100)
 * Maps confidence to estimated win probability
 */
export function confidenceToKelly(
  confidenceScore: number,
  tokenPrice: number,
  kellyFraction: number,
  bankroll: number,
  maxBet: number = 5,
  minBet: number = 1
): KellyResult {
  // Map confidence score to win probability
  // 50 = coin flip (50%), 100 = very confident (90%), 70 = moderate (70%)
  const baseProb = 0.50;
  const maxBonus = 0.40; // Max additional probability from confidence
  const normalizedConfidence = Math.max(0, Math.min(100, confidenceScore)) / 100;
  const estimatedWinRate = baseProb + (normalizedConfidence * maxBonus);

  return quickKelly(estimatedWinRate, tokenPrice, kellyFraction, bankroll, maxBet, minBet);
}

/**
 * Helper: return a "no bet" result
 */
function noBet(bankroll: number): KellyResult {
  return {
    fullKelly: 0,
    fractionalKelly: 0,
    betSize: 0,
    expectedValue: 0,
    edge: 0,
    shouldBet: false
  };
}

/**
 * Strategy-specific Kelly configurations
 */
export const KELLY_CONFIGS = {
  // Mirror: Aggressive, higher fraction
  mirror: {
    kellyFraction: 0.25,
    maxBet: 5,
    minBet: 1
  },

  // Smart: Moderate
  smart: {
    kellyFraction: 0.30,
    maxBet: 10,
    minBet: 2
  },

  // Safe: Conservative
  safe: {
    kellyFraction: 0.20,
    maxBet: 3,
    minBet: 1
  }
};

export default calculateKelly;
