/**
 * TRADING TYPES
 * 
 * Polymarket entegrasyonu için gerekli tipler
 */

// ===== POSITION TYPES =====

export enum PositionType {
  TEAM_WINS_YES = 'TEAM_WINS_YES',     // Gol atan takım KAZANIR (YES)
  OPPONENT_WINS_NO = 'OPPONENT_WINS_NO', // Karşı takım KAZANIR (NO)
  DRAW_NO = 'DRAW_NO',                 // BERABERE (NO)
  DRAW_YES = 'DRAW_YES'                // BERABERE (YES) - beraberlik yakalandığında
}

export interface Position {
  id: string;                  // Unique ID
  matchId: string;             // Football match ID
  market: string;              // Polymarket market slug
  conditionId: string;         // Polymarket condition ID
  tokenId: string;             // Polymarket token ID
  type: PositionType;          // Position type
  outcome: 'YES' | 'NO';       // Bet on YES or NO
  side: 'BUY' | 'SELL';        // Buy or Sell
  shares: number;              // Number of shares
  amount: number;              // USD spent
  avgEntryPrice: number;       // Average entry price (0-1)
  currentPrice: number;        // Current market price (0-1)
  unrealizedPnL: number;       // Current profit/loss ($)
  unrealizedPnLPercent: number; // Current profit/loss (%)
  openTime: Date;              // When position opened
  closeTime?: Date;            // When position closed
  status: 'OPEN' | 'CLOSED';   // Position status
}

// ===== TRADE TYPES =====

export interface Trade {
  id: string;
  matchId: string;
  positionId: string;
  market: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  shares: number;
  amount: number;              // USD
  price: number;               // Execution price (0-1)
  orderId?: string;            // Polymarket order ID
  timestamp: Date;
  success: boolean;
  error?: string;
}

export interface TradeOrder {
  market: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  amount: number;              // USD
  price: number;               // 0-1
  reason: string;
}

export interface TradeResult {
  success: boolean;
  trade?: Trade;
  position?: Position;
  error?: string;
}

// ===== EXIT STRATEGY =====

export interface ExitTarget {
  targetProfitPercent: number; // % profit to trigger sell
  sellPercent: number;         // % of position to sell
}

// Kademeli satış hedefleri - AGRESIF!
export const EXIT_TARGETS: ExitTarget[] = [
  { targetProfitPercent: 15, sellPercent: 30 },  // %15 kar → %30 sat (HIZLI KAR AL!)
  { targetProfitPercent: 30, sellPercent: 40 },  // %30 kar → %40 sat
  { targetProfitPercent: 50, sellPercent: 30 },  // %50 kar → geri kalan %30'u sat
];

// ===== POLYMARKET MARKET DATA =====

export interface PolymarketMarket {
  id?: string;
  slug: string;
  title?: string;
  question?: string;
  conditionId: string;
  tokens?: PolymarketToken[];
  volume: number;
  liquidity: number;
  endDate: string;
}

export interface PolymarketToken {
  yesTokenId: string;         // YES token (clobTokenIds[0])
  noTokenId: string;          // NO token (clobTokenIds[1])
  yesPrice: number;           // 0-1 price for YES
  noPrice: number;            // 0-1 price for NO (usually 1 - yesPrice)
  outcome: string;            // 'YES' or 'NO' - which one we're targeting
  winner: boolean;
}

// ===== TRADING CONFIG =====

export interface TradingConfig {
  dryRun: boolean;
  positionSize: number;        // $2-3 per position
  maxPositionSize: number;     // $10 per match
  maxConcurrentMatches: number; // 3-5 matches
  maxDailyLoss: number;        // $15
  minLiquidity: number;        // $5000
  stopLossPercent: number;     // -20%
}
