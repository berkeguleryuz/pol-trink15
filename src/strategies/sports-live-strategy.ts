/**
 * Live Sports Trading Strategy
 * Multi-position strategy for live sports betting
 */

import { MatchScore, TradingAction } from '../integrations/sports-telegram-bot';

export interface Position {
  matchKey: string;
  market: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  amount: number;
  currentPrice: number;
  profit: number;
  profitPercent: number;
  timestamp: Date;
}

export interface MatchState {
  homeTeam: string;
  awayTeam: string;
  currentScore: MatchScore;
  previousScore?: MatchScore;
  positions: Position[];
  totalInvested: number;
  totalProfit: number;
}

export class LiveSportsStrategy {
  private matches: Map<string, MatchState> = new Map();
  
  // Configuration
  private readonly POSITION_SIZE = 2; // $2 per position
  private readonly MAX_PER_MATCH = 6; // 3 positions × $2 = $6
  
  // Profit targets (AKILLI KADEMELI SATIŞ)
  private readonly PROFIT_TARGETS = [
    { profit: 0.50, sellPercent: 0.25 }, // 50% profit → sell 25%
    { profit: 1.00, sellPercent: 0.35 }, // 100% profit → sell 35%
    { profit: 2.00, sellPercent: 0.40 }, // 200% profit → sell 40%
  ];
  
  // 🎯 YENİ: GOL FARKI HOLD STRATEJİSİ
  private readonly HOLD_RULES = {
    TWO_GOAL_LEAD: { minDiff: 2, holdUntil: 90 },      // 2+ gol önde → 90. dakikaya kadar SAT
    ONE_GOAL_LEAD_LATE: { minDiff: 1, minMinute: 80, holdUntil: 90 }, // 1 gol önde 80+ → 90. dakikaya kadar tut
    ONE_GOAL_LEAD_EARLY: { minDiff: 1, maxMinute: 70, sellAt: 0.30 }, // 1 gol önde erken → %30 kar yeterli
  };

  constructor() {
    console.log('⚽ Live Sports Strategy initialized');
  }

  /**
   * ENTRY: New goal scored → Open multi-position
   */
  async onGoalScored(match: MatchScore, actions: TradingAction[]): Promise<{
    shouldTrade: boolean;
    positions: TradingAction[];
  }> {
    const key = `${match.homeTeam}_${match.awayTeam}`;
    const scoreDiff = Math.abs(match.homeScore - match.awayScore);

    // Don't trade on tied games (yet)
    if (scoreDiff === 0) {
      console.log(`⚠️  Tied game, waiting for leader`);
      return { shouldTrade: false, positions: [] };
    }

    // Check if we already have positions
    const existing = this.matches.get(key);
    if (existing && existing.positions.length > 0) {
      console.log(`✅ Already have ${existing.positions.length} positions`);
      
      // Check for REVERSE GOAL (opponent scored)
      if (this.isReverseGoal(existing, match)) {
        console.log(`🚨 REVERSE GOAL! Emergency sell!`);
        return await this.onReverseGoal(existing, match);
      }
      
      // Check for profit targets
      return await this.checkProfitTargets(existing);
    }

    // ENTER: Open new multi-position
    console.log(`\n💰 ENTRY: Opening ${actions.length} positions`);
    console.log(`📊 Score: ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
    console.log(`⏱️  Minute: ${match.minute}'`);

    // Initialize match state
    this.matches.set(key, {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      currentScore: match,
      positions: [],
      totalInvested: 0,
      totalProfit: 0,
    });

    return {
      shouldTrade: true,
      positions: actions,
    };
  }

  /**
   * CHECK: Profit targets için AKILLI satış
   * 
   * 🎯 YENİ MANTIK:
   * - 2+ gol fark varsa → 90. dakikaya kadar SATMA!
   * - 1 gol fark + 80+ dakika → Güvenli, 90. dakikaya kadar tut
   * - 1 gol fark + erken dakika → %30 karda sat (riskli)
   * - Beraberlik → HEMEN SAT!
   */
  async checkProfitTargets(matchState: MatchState): Promise<{
    shouldTrade: boolean;
    positions: TradingAction[];
  }> {
    const actions: TradingAction[] = [];
    const currentScore = matchState.currentScore;
    const scoreDiff = Math.abs(currentScore.homeScore - currentScore.awayScore);
    const minute = currentScore.minute || 0;

    console.log(`\n🔍 Checking positions... (${scoreDiff}-goal diff, ${minute}')`);

    for (const position of matchState.positions) {
      const profitPercent = position.profitPercent;
      const currentPrice = position.currentPrice;

      // ==========================================
      // RULE 1: 2+ GOL ÖNDE → 90. DAKİKAYA KADAR SATMA!
      // ==========================================
      if (scoreDiff >= 2 && minute < 90) {
        console.log(`   💎 HOLDING ${position.market}: ${scoreDiff}-goal lead (safe until 90')`);
        continue; // SATMA!
      }

      // ==========================================
      // RULE 2: 1 GOL ÖNDE + GEÇTE → 90. DAKİKAYA KADAR TUT
      // ==========================================
      if (scoreDiff === 1 && minute >= 80 && minute < 90) {
        console.log(`   💎 HOLDING ${position.market}: 1-goal lead at ${minute}' (late game)`);
        continue; // SATMA!
      }

      // ==========================================
      // RULE 3: 1 GOL ÖNDE + ERKEN → %30 KARDA SAT
      // ==========================================
      if (scoreDiff === 1 && minute < 70 && profitPercent >= 0.30) {
        console.log(`   ⚠️  RISKY ${position.market}: Only 1-goal lead at ${minute}'`);
        console.log(`   � Selling at ${(profitPercent * 100).toFixed(0)}% profit (safe exit)`);
        
        actions.push({
          market: position.market,
          side: position.side,
          priority: 1,
          reason: `1-goal lead at ${minute}' - take ${(profitPercent * 100).toFixed(0)}% profit`,
        });
        continue;
      }

      // ==========================================
      // RULE 4: BERABERLİK → HEMEN SAT!
      // ==========================================
      if (scoreDiff === 0 && profitPercent > 0) {
        console.log(`   🚨 TIED GAME ${position.market}: EMERGENCY SELL!`);
        
        actions.push({
          market: position.market,
          side: position.side,
          priority: 1,
          reason: `Tied game - sell at any profit (${(profitPercent * 100).toFixed(0)}%)`,
        });
        continue;
      }

      // ==========================================
      // RULE 5: 90. DAKİKA → HER ŞEYDE %100 SAT
      // ==========================================
      if (minute >= 90) {
        console.log(`   ⏱️  90+ MINUTE ${position.market}: Selling everything`);
        
        actions.push({
          market: position.market,
          side: position.side,
          priority: 1,
          reason: '90+ minute - close all positions',
        });
        continue;
      }

      // ==========================================
      // RULE 6: FİYAT >95% → %100 SAT (Market kapanıyor)
      // ==========================================
      if (currentPrice > 0.95) {
        console.log(`   🎯 EXTREME PRICE ${position.market}: ${(currentPrice * 100).toFixed(1)}%`);
        console.log(`   💰 Selling 100% (market resolving)`);

        actions.push({
          market: position.market,
          side: position.side,
          priority: 1,
          reason: 'Price > 95% - market resolving',
        });
        continue;
      }

      // ==========================================
      // RULE 7: KLASİK KADEMELİ SATIŞ (Diğer durumlar)
      // ==========================================
      for (const target of this.PROFIT_TARGETS) {
        if (profitPercent >= target.profit) {
          const sellAmount = position.amount * target.sellPercent;
          
          console.log(`   💎 PROFIT TARGET ${position.market}: ${(profitPercent * 100).toFixed(0)}%`);
          console.log(`   💰 Sell ${(target.sellPercent * 100).toFixed(0)}% (${sellAmount.toFixed(2)} tokens)`);

          actions.push({
            market: position.market,
            side: position.side,
            priority: 1,
            reason: `Profit target: ${(target.profit * 100).toFixed(0)}%`,
          });
          
          break; // Sadece 1 target
        }
      }
    }

    return {
      shouldTrade: actions.length > 0,
      positions: actions,
    };
  }

  /**
   * STOP-LOSS: Reverse goal (opponent scored)
   */
  async onReverseGoal(matchState: MatchState, newScore: MatchScore): Promise<{
    shouldTrade: boolean;
    positions: TradingAction[];
  }> {
    console.log(`\n🚨 REVERSE GOAL DETECTED!`);
    console.log(`📊 Old: ${matchState.currentScore.homeScore}-${matchState.currentScore.awayScore}`);
    console.log(`📊 New: ${newScore.homeScore}-${newScore.awayScore}`);

    const actions: TradingAction[] = [];

    // Evaluate each position
    for (const position of matchState.positions) {
      // If position is now LOSING or RISKY → SELL
      const shouldSell = this.isPositionAtRisk(position, newScore);
      
      if (shouldSell) {
        console.log(`🔴 EMERGENCY SELL: ${position.market}`);
        actions.push({
          market: position.market,
          side: position.side,
          priority: 1,
          reason: 'Reverse goal - position at risk',
        });
      }
    }

    // Update match state
    matchState.previousScore = matchState.currentScore;
    matchState.currentScore = newScore;

    return {
      shouldTrade: actions.length > 0,
      positions: actions,
    };
  }

  /**
   * HOLD LOGIC: Should we hold or sell?
   */
  shouldHoldPosition(match: MatchScore, position: Position): boolean {
    const scoreDiff = Math.abs(match.homeScore - match.awayScore);
    const minute = match.minute;

    // HOLD: 2+ goal lead (very safe)
    if (scoreDiff >= 2) {
      console.log(`💎 HOLDING: ${scoreDiff}-goal lead is safe`);
      return true;
    }

    // HOLD: 1-goal lead in late game (80+ min)
    if (scoreDiff === 1 && minute >= 80) {
      console.log(`💎 HOLDING: 1-goal lead at ${minute}'`);
      return true;
    }

    // RISKY: 1-goal lead early/mid game
    if (scoreDiff === 1 && minute < 70) {
      console.log(`⚠️  RISKY: Only 1-goal lead at ${minute}'`);
      return false; // Consider selling
    }

    // TIED: Very risky
    if (scoreDiff === 0) {
      console.log(`🚨 TIED GAME: Consider selling`);
      return false;
    }

    return true;
  }

  /**
   * Check if this is a reverse goal
   */
  private isReverseGoal(matchState: MatchState, newScore: MatchScore): boolean {
    const old = matchState.currentScore;
    const oldDiff = old.homeScore - old.awayScore;
    const newDiff = newScore.homeScore - newScore.awayScore;

    // Score difference reduced or flipped
    return Math.abs(newDiff) < Math.abs(oldDiff) || 
           (oldDiff > 0 && newDiff <= 0) || 
           (oldDiff < 0 && newDiff >= 0);
  }

  /**
   * Check if position is at risk after reverse goal
   */
  private isPositionAtRisk(position: Position, newScore: MatchScore): boolean {
    const scoreDiff = newScore.homeScore - newScore.awayScore;

    // Parse team from market
    // Example: "Real Madrid to win" → check if Real Madrid is losing
    const market = position.market.toLowerCase();
    
    // Simplified risk check: if game is tied or very close
    if (Math.abs(scoreDiff) <= 1 && newScore.minute >= 70) {
      return true; // Late game, close score = risky
    }

    return false;
  }

  /**
   * Update position prices and calculate profits
   */
  updatePosition(matchKey: string, market: string, currentPrice: number): void {
    const matchState = this.matches.get(matchKey);
    if (!matchState) return;

    const position = matchState.positions.find(p => p.market === market);
    if (!position) return;

    position.currentPrice = currentPrice;
    position.profit = (currentPrice - position.entryPrice) * position.amount;
    position.profitPercent = (currentPrice - position.entryPrice) / position.entryPrice;

    // Update match totals
    matchState.totalProfit = matchState.positions.reduce((sum, p) => sum + p.profit, 0);
  }

  /**
   * Add new position to match
   */
  addPosition(matchKey: string, market: string, side: 'YES' | 'NO', entryPrice: number, amount: number): void {
    const matchState = this.matches.get(matchKey);
    if (!matchState) return;

    const position: Position = {
      matchKey,
      market,
      side,
      entryPrice,
      amount,
      currentPrice: entryPrice,
      profit: 0,
      profitPercent: 0,
      timestamp: new Date(),
    };

    matchState.positions.push(position);
    matchState.totalInvested += amount * entryPrice;

    console.log(`✅ Position added: ${market} (${side}) @ ${(entryPrice * 100).toFixed(1)}%`);
  }

  /**
   * Remove position (after selling)
   */
  removePosition(matchKey: string, market: string): void {
    const matchState = this.matches.get(matchKey);
    if (!matchState) return;

    const index = matchState.positions.findIndex(p => p.market === market);
    if (index >= 0) {
      const position = matchState.positions[index];
      console.log(`🗑️  Position closed: ${position.market} | P&L: $${position.profit.toFixed(2)}`);
      matchState.positions.splice(index, 1);
    }
  }

  /**
   * Get match state
   */
  getMatchState(homeTeam: string, awayTeam: string): MatchState | undefined {
    const key = `${homeTeam}_${awayTeam}`;
    return this.matches.get(key);
  }

  /**
   * Clear match after it ends
   */
  clearMatch(homeTeam: string, awayTeam: string): void {
    const key = `${homeTeam}_${awayTeam}`;
    const matchState = this.matches.get(key);
    
    if (matchState) {
      console.log(`\n🏁 MATCH ENDED: ${homeTeam} vs ${awayTeam}`);
      console.log(`📊 Total P&L: $${matchState.totalProfit.toFixed(2)}`);
      console.log(`💰 ROI: ${((matchState.totalProfit / matchState.totalInvested) * 100).toFixed(1)}%`);
    }

    this.matches.delete(key);
  }

  /**
   * Get all active matches
   */
  getActiveMatches(): MatchState[] {
    return Array.from(this.matches.values());
  }

  /**
   * Get total P&L across all matches
   */
  getTotalProfitLoss(): number {
    return Array.from(this.matches.values())
      .reduce((sum, match) => sum + match.totalProfit, 0);
  }
}
