/**
 * WHALE TRADING STRATEGIES - Type Definitions
 *
 * Core types for whale-based trading strategies
 */

// ============================================================================
// MARKET & PRICE TYPES
// ============================================================================

export interface MarketState {
  slug: string;
  coin: string;
  upTokenId: string;
  downTokenId: string;
  endTime: number;
  priceToBeat: number;
  eventStartTime: string;
  lastUpdate: number;
}

export interface PriceState {
  chainlink: number;
  upToken: number;
  downToken: number;
  lastUpdate: number;
}

export interface TokenPrices {
  up: number;
  down: number;
}

// ============================================================================
// WHALE TYPES
// ============================================================================

export interface WhaleConfig {
  address: string;
  name: string;
  color?: string;
  reliability?: number;  // 0-1 historical win rate
}

export interface WhaleTrade {
  timestamp: number;
  whale: string;
  walletAddr: string;
  coin: string;
  slug: string;
  side: 'BUY' | 'SELL';
  outcome: 'Up' | 'Down';
  size: number;
  price: number;
  usdcValue: number;
  txHash: string;
  remainingSec: number;
  chainlinkPrice: number;
  priceToBeat: number;
  tokenUp: number;
  tokenDown: number;
  isAligned: boolean;
  priceDiffPct: number;
}

export interface WhalePosition {
  whale: string;
  coin: string;
  outcome: 'Up' | 'Down';
  totalSize: number;
  totalValue: number;
  avgPrice: number;
  fills: WhaleFill[];
  firstSeen: number;
  lastUpdate: number;
}

export interface WhaleFill {
  size: number;
  price: number;
  timestamp: number;
}

// ============================================================================
// STRATEGY TYPES
// ============================================================================

export type StrategyType = 'mirror' | 'smart' | 'safe';

export interface StrategyConfig {
  name: string;
  type: StrategyType;
  enabled: boolean;

  // Position sizing
  baseAmount: number;           // Base trade amount
  maxPerTrade: number;          // Max per single trade
  maxPerMarket: number;         // Max per market/period
  maxDailyLoss: number;         // Daily loss limit
  kellyFraction: number;        // Kelly multiplier (0.2-0.3 recommended)

  // Timing
  minTimeRemaining: number;     // Minimum seconds before expiry
  maxTimeRemaining: number;     // Maximum seconds (don't enter too early)

  // Entry conditions
  minWhaleSize: number;         // Minimum whale trade size to copy
  maxEntryPrice: number;        // Don't buy above this price
  minSpread: number;            // Minimum spread between Up/Down

  // Risk management
  stopLossPrice: number;        // Exit if price drops to this
  cooldownAfterLoss: number;    // Cooldown in ms after loss
}

export interface TradeSignal {
  timestamp: number;
  strategy: StrategyType;
  coin: string;
  slug: string;
  outcome: 'Up' | 'Down';
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  confidence: number;           // 0-100 score
  reason: string;
  metadata: Record<string, any>;
}

export interface TradeExecution {
  signal: TradeSignal;
  orderId?: string;
  executedPrice?: number;
  executedSize?: number;
  status: 'pending' | 'filled' | 'partial' | 'failed' | 'cancelled';
  error?: string;
  executionTime: number;
}

// ============================================================================
// SCORING TYPES (for Smart Strategy)
// ============================================================================

export interface ScoreFactors {
  momentum: number;             // 0-30 points
  orderBookImbalance: number;   // 0-25 points
  whaleConfirmation: number;    // 0-25 points
  tokenOddsQuality: number;     // 0-20 points
  total: number;                // 0-100 total
}

export interface OrderBookData {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  midpoint: number;
  spread: number;
  imbalance: number;            // -1 to +1
}

// ============================================================================
// PATTERN TYPES (for Safe Strategy)
// ============================================================================

export type PatternType =
  | 'high_conviction'           // Whale buys at 90¢+
  | 'momentum_aligned'          // All signals aligned
  | 'late_surge'                // Big whale entry in last 45s
  | 'both_whales'               // Both whales same direction
  | 'contrarian';               // Against momentum (usually avoid)

export interface PatternMatch {
  type: PatternType;
  confidence: number;           // 0-100
  details: Record<string, any>;
}

// ============================================================================
// RISK MANAGEMENT
// ============================================================================

export interface RiskState {
  dailyPnL: number;
  dailyTrades: number;
  dailyWins: number;
  dailyLosses: number;
  consecutiveLosses: number;
  lastLossTime: number;
  isPaused: boolean;
  pauseReason?: string;
}

export interface PositionState {
  coin: string;
  slug: string;
  outcome: 'Up' | 'Down';
  tokenId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  entryTime: number;
}

// ============================================================================
// BOT STATE
// ============================================================================

export interface BotState {
  isRunning: boolean;
  startTime: number;
  markets: Map<string, MarketState>;
  prices: Map<string, PriceState>;
  positions: Map<string, PositionState>;
  risk: RiskState;
  stats: BotStats;
}

export interface BotStats {
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPnL: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesPerStrategy: Record<StrategyType, number>;
}

// ============================================================================
// WEBSOCKET TYPES
// ============================================================================

export interface WSSubscription {
  topic: string;
  type: string;
  handler: (data: any) => void;
}

export interface ChainlinkUpdate {
  symbol: string;
  value: number;
  timestamp: number;
}

export interface ActivityUpdate {
  type: 'trades' | 'orders' | 'cancels';
  payload: any;
}
