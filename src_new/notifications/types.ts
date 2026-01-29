/**
 * NOTIFICATION TYPES
 * 
 * Telegram bildirimleri için type definitions
 */

export enum NotificationType {
  MATCH_STARTING = 'MATCH_STARTING',      // Maç 10 dk sonra başlıyor
  GOAL_SCORED = 'GOAL_SCORED',            // Gol oldu
  TRADE_EXECUTED = 'TRADE_EXECUTED',      // Trade açıldı
  POSITION_CLOSED = 'POSITION_CLOSED',    // Pozisyon kapandı
  FAVORITE_DETECTED = 'FAVORITE_DETECTED', // Pre-match favori bulundu
  STOP_LOSS = 'STOP_LOSS',                // Stop-loss tetiklendi
  DAILY_REPORT = 'DAILY_REPORT',          // Günlük rapor
  ERROR = 'ERROR'                          // Sistem hatası
}

export interface TelegramNotification {
  type: NotificationType;
  timestamp: Date;
  data: any;
  requiresApproval?: boolean;
  approvalTimeout?: number; // seconds
}

export interface MatchStartingData {
  matchId: string;
  slug: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  minutesUntilKickoff: number;
  marketLink: string;
}

export interface GoalScoredData {
  matchId: string;
  slug: string;
  title: string;
  scorer: string;
  team: 'home' | 'away';
  minute: number;
  previousScore: { home: number; away: number };
  newScore: { home: number; away: number };
  marketLink: string;
}

export interface TradeExecutedData {
  matchId: string;
  slug: string;
  title: string;
  positions: {
    type: string;
    amount: number;
    price: number;
  }[];
  totalInvestment: number;
  marketLink: string;
}

export interface PositionClosedData {
  matchId: string;
  slug: string;
  positionType: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  pnl: number;
  pnlPercent: number;
  reason: string;
  marketLink: string;
}

export interface FavoriteDetectedData {
  matchId: string;
  slug: string;
  title: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  favorite: 'home' | 'away';
  winProbability: number;
  currentPrice: number;
  recommendedAction: string;
  marketLink: string;
}

export interface StopLossData {
  matchId: string;
  slug: string;
  positionsCount: number;
  totalLoss: number;
  reason: string;
  marketLink: string;
}

export interface DailyReportData {
  date: string;
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  winRate: number;
  totalPnL: number;
  bestTrade: {
    match: string;
    pnl: number;
  } | null;
  worstTrade: {
    match: string;
    pnl: number;
  } | null;
}

export interface ApprovalRequest {
  id: string;
  type: NotificationType;
  data: any;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}
