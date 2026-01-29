/**
 * CORE TYPES - Tüm sistem tipleri
 */

// ===== MATCH TYPES =====

export enum MatchStatus {
  UPCOMING = 'upcoming',    // 30+ dakika var
  SOON = 'soon',           // 0-30 dakika kaldı
  LIVE = 'live',           // Maç canlı
  FINISHED = 'finished'    // Maç bitti
}

export enum MatchPhase {
  PRE_MATCH = 'pre_match',
  EARLY = 'early',
  MID_GAME = 'mid_game',
  CRITICAL = 'critical',
  ULTRA_CRITICAL = 'ultra_critical',
  POST_MATCH = 'post_match'
}

export interface FootballMatch {
  id: string;
  slug: string;
  title: string;
  endDate: string;
  matchDate: string;
  kickoffTime: string;
  kickoffUTC: string;
  status: MatchStatus;
  minutesUntilKickoff?: number;
  volume24hr?: number;
  liquidity?: number;
  sport: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  currentMinute?: number;
  matchStatus?: string; // ⚡ API-Football status: HT, FT, 1H, 2H, etc.
  apiFootballId?: number;
}

export interface MatchPhaseInfo {
  phase: MatchPhase;
  interval: number;
  reason: string;
}

// ===== TRADING (Re-export from trading module) =====

export enum TradeAction {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD'
}

// ===== GOL EVENT =====

export interface GoalEvent {
  matchId: string;
  team: 'home' | 'away';
  minute: number;
  scorer: string;
  newScore: {
    home: number;
    away: number;
  };
  previousScore: {
    home: number;
    away: number;
  };
  timestamp: Date;
}

// ===== PRE-MATCH ANALYSIS =====

export interface PreMatchAnalysis {
  matchId: string;
  favorite: 'home' | 'away' | 'none';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  odds: {
    home: number;
    away: number;
    draw: number;
  };
  recommendation: 'BUY' | 'SKIP';
  reason: string;
}

// ===== NOTIFICATION TYPES =====

export interface TelegramNotification {
  type: 'MATCH_STARTING' | 'GOAL' | 'TRADE_EXECUTED' | 'POSITION_CLOSED' | 'FAVORITE_DETECTED';
  matchId: string;
  message: string;
  requiresApproval?: boolean;
  timestamp: Date;
}

// ===== CONFIGURATION =====

export interface BotConfig {
  dryRun: boolean;
  maxConcurrentMatches: number;
  updateInterval: number;
  cleanupInterval: number;
}

// ===== SYSTEM STATE =====

export interface SystemState {
  allMatches: FootballMatch[];
  todayMatches: FootballMatch[];
  upcomingMatches: FootballMatch[];
  soonMatches: FootballMatch[];
  activeMatches: FootballMatch[];
  liveMatches: FootballMatch[];
  finishedMatches: FootballMatch[];
  positions: any[];  // Will import from trading module
  dailyPnL: number;
  totalTrades: number;
  lastUpdate: Date;
}
