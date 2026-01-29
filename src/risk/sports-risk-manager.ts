/**
 * Match-Aware Risk Manager
 * Dynamic risk management based on match score, time, and position state
 */

import { MatchScore } from '../integrations/sports-telegram-bot';
import { Position, MatchState } from '../strategies/sports-live-strategy';

export interface RiskAssessment {
  riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  shouldHold: boolean;
  shouldSell: boolean;
  shouldEmergencySell: boolean;
  sellPercentage: number; // 0-100
  reason: string;
  factors: string[];
}

export interface PositionRisk {
  position: Position;
  matchScore: MatchScore;
  risk: RiskAssessment;
}

export class MatchAwareRiskManager {
  // Risk limits
  private readonly MAX_LOSS_PER_MATCH = 5; // $5 max loss per match
  private readonly MAX_DAILY_LOSS = 15; // $15 max daily loss
  private readonly MAX_CONCURRENT_MATCHES = 5;
  private readonly MAX_POSITIONS_PER_MATCH = 3;
  
  // Tracking
  private dailyPnL = 0;
  private activeMatches = 0;
  
  constructor() {
    console.log('🛡️  Match-Aware Risk Manager initialized');
  }

  /**
   * Assess risk for a match state
   */
  assessMatchRisk(matchState: MatchState): RiskAssessment {
    const score = matchState.currentScore;
    const scoreDiff = Math.abs(score.homeScore - score.awayScore);
    const minute = score.minute;
    const factors: string[] = [];
    
    // Factor 1: Score difference
    let scoreRisk = 0;
    if (scoreDiff >= 3) {
      scoreRisk = 0; // Very safe
      factors.push('3+ goal lead (very safe)');
    } else if (scoreDiff === 2) {
      scoreRisk = 1; // Safe
      factors.push('2-goal lead (safe)');
    } else if (scoreDiff === 1) {
      scoreRisk = 3; // Medium risk
      factors.push('1-goal lead (medium risk)');
    } else {
      scoreRisk = 5; // High risk
      factors.push('Tied game (high risk)');
    }
    
    // Factor 2: Time remaining
    let timeRisk = 0;
    if (minute >= 85) {
      timeRisk = 0; // Very late, almost over
      factors.push('85+ minutes (game almost over)');
    } else if (minute >= 75) {
      timeRisk = 1; // Late game
      factors.push('75+ minutes (late game)');
    } else if (minute >= 60) {
      timeRisk = 2; // Mid-late game
      factors.push('60+ minutes (mid-late game)');
    } else {
      timeRisk = 3; // Early game
      factors.push('< 60 minutes (early game)');
    }
    
    // Factor 3: Position P&L
    let profitRisk = 0;
    if (matchState.totalProfit > 0) {
      profitRisk = -1; // In profit = lower risk
      factors.push(`In profit ($${matchState.totalProfit.toFixed(2)})`);
    } else if (matchState.totalProfit < -3) {
      profitRisk = 2; // Big loss = higher risk
      factors.push(`Significant loss ($${matchState.totalProfit.toFixed(2)})`);
    }
    
    // Calculate total risk score
    const totalRisk = scoreRisk + timeRisk + profitRisk;
    
    // Determine risk level
    let riskLevel: RiskAssessment['riskLevel'];
    let shouldHold: boolean;
    let shouldSell: boolean;
    let shouldEmergencySell: boolean;
    let sellPercentage = 0;
    let reason: string;
    
    if (totalRisk <= 1) {
      // VERY LOW RISK: Safe lead, late game
      riskLevel = 'VERY_LOW';
      shouldHold = true;
      shouldSell = false;
      shouldEmergencySell = false;
      reason = 'Safe position - HOLD to match end';
    } else if (totalRisk <= 3) {
      // LOW RISK: Decent lead or late game
      riskLevel = 'LOW';
      shouldHold = true;
      shouldSell = false;
      shouldEmergencySell = false;
      reason = 'Low risk - HOLD position';
    } else if (totalRisk <= 5) {
      // MEDIUM RISK: Close score or mid game
      riskLevel = 'MEDIUM';
      shouldHold = false;
      shouldSell = true;
      shouldEmergencySell = false;
      sellPercentage = 50; // Sell half
      reason = 'Medium risk - consider partial sell';
    } else if (totalRisk <= 7) {
      // HIGH RISK: Tied or losing
      riskLevel = 'HIGH';
      shouldHold = false;
      shouldSell = true;
      shouldEmergencySell = false;
      sellPercentage = 75; // Sell most
      reason = 'High risk - sell majority';
    } else {
      // CRITICAL RISK: Emergency
      riskLevel = 'CRITICAL';
      shouldHold = false;
      shouldSell = false;
      shouldEmergencySell = true;
      sellPercentage = 100; // Sell all
      reason = 'CRITICAL risk - emergency sell all';
    }
    
    return {
      riskLevel,
      shouldHold,
      shouldSell,
      shouldEmergencySell,
      sellPercentage,
      reason,
      factors,
    };
  }

  /**
   * Check if we should enter a new position
   */
  shouldEnterPosition(matchScore: MatchScore, amount: number): {
    allowed: boolean;
    reason: string;
  } {
    // Check daily loss limit
    if (this.dailyPnL < -this.MAX_DAILY_LOSS) {
      return {
        allowed: false,
        reason: `Daily loss limit hit ($${this.dailyPnL.toFixed(2)})`,
      };
    }
    
    // Check concurrent matches
    if (this.activeMatches >= this.MAX_CONCURRENT_MATCHES) {
      return {
        allowed: false,
        reason: `Max concurrent matches (${this.activeMatches}/${this.MAX_CONCURRENT_MATCHES})`,
      };
    }
    
    // Check match timing (don't enter too late)
    if (matchScore.minute >= 80) {
      return {
        allowed: false,
        reason: 'Match too late (80+ minutes)',
      };
    }
    
    // Check score (don't enter on tied games late)
    const scoreDiff = Math.abs(matchScore.homeScore - matchScore.awayScore);
    if (scoreDiff === 0 && matchScore.minute >= 60) {
      return {
        allowed: false,
        reason: 'Tied game in late stage',
      };
    }
    
    return {
      allowed: true,
      reason: 'All risk checks passed',
    };
  }

  /**
   * Check position-specific risk
   */
  assessPositionRisk(position: Position, matchScore: MatchScore): RiskAssessment {
    const factors: string[] = [];
    let totalRisk = 0;
    
    // Check if position is profitable
    if (position.profitPercent < -0.20) {
      totalRisk += 3;
      factors.push('Position down 20%+');
    } else if (position.profitPercent < 0) {
      totalRisk += 1;
      factors.push('Position in small loss');
    } else if (position.profitPercent > 1.0) {
      totalRisk -= 2;
      factors.push('Position up 100%+');
    }
    
    // Check match state
    const scoreDiff = Math.abs(matchScore.homeScore - matchScore.awayScore);
    if (scoreDiff === 0) {
      totalRisk += 3;
      factors.push('Match is tied');
    } else if (scoreDiff === 1 && matchScore.minute >= 70) {
      totalRisk += 2;
      factors.push('Close score in late game');
    }
    
    // Determine action
    let riskLevel: RiskAssessment['riskLevel'];
    let shouldEmergencySell = false;
    let sellPercentage = 0;
    
    if (totalRisk >= 5) {
      riskLevel = 'CRITICAL';
      shouldEmergencySell = true;
      sellPercentage = 100;
    } else if (totalRisk >= 3) {
      riskLevel = 'HIGH';
      sellPercentage = 75;
    } else if (totalRisk >= 1) {
      riskLevel = 'MEDIUM';
      sellPercentage = 50;
    } else {
      riskLevel = 'LOW';
      sellPercentage = 0;
    }
    
    return {
      riskLevel,
      shouldHold: sellPercentage === 0,
      shouldSell: sellPercentage > 0 && sellPercentage < 100,
      shouldEmergencySell,
      sellPercentage,
      reason: factors.join(', '),
      factors,
    };
  }

  /**
   * Evaluate if reverse goal creates emergency
   */
  isReverseGoalEmergency(
    oldScore: MatchScore,
    newScore: MatchScore,
    position: Position
  ): boolean {
    const oldDiff = oldScore.homeScore - oldScore.awayScore;
    const newDiff = newScore.homeScore - newScore.awayScore;
    
    // Score went from leading to tied or losing
    if ((oldDiff > 0 && newDiff <= 0) || (oldDiff < 0 && newDiff >= 0)) {
      return true;
    }
    
    // Lead reduced significantly
    if (Math.abs(oldDiff) - Math.abs(newDiff) >= 2) {
      return true;
    }
    
    // Position in big loss
    if (position.profitPercent < -0.30) {
      return true;
    }
    
    return false;
  }

  /**
   * Update daily P&L
   */
  updateDailyPnL(amount: number): void {
    this.dailyPnL += amount;
    console.log(`💰 Daily P&L: $${this.dailyPnL.toFixed(2)}`);
    
    if (this.dailyPnL < -this.MAX_DAILY_LOSS) {
      console.log(`🚨 DAILY LOSS LIMIT HIT! Stop trading.`);
    }
  }

  /**
   * Increment active matches
   */
  incrementActiveMatches(): void {
    this.activeMatches++;
    console.log(`📊 Active matches: ${this.activeMatches}/${this.MAX_CONCURRENT_MATCHES}`);
  }

  /**
   * Decrement active matches
   */
  decrementActiveMatches(): void {
    this.activeMatches = Math.max(0, this.activeMatches - 1);
    console.log(`📊 Active matches: ${this.activeMatches}/${this.MAX_CONCURRENT_MATCHES}`);
  }

  /**
   * Get current risk status
   */
  getRiskStatus(): {
    dailyPnL: number;
    activeMatches: number;
    canTrade: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    
    if (this.dailyPnL < -this.MAX_DAILY_LOSS * 0.5) {
      warnings.push('Approaching daily loss limit');
    }
    
    if (this.activeMatches >= this.MAX_CONCURRENT_MATCHES * 0.8) {
      warnings.push('Near max concurrent matches');
    }
    
    const canTrade = this.dailyPnL > -this.MAX_DAILY_LOSS && 
                     this.activeMatches < this.MAX_CONCURRENT_MATCHES;
    
    return {
      dailyPnL: this.dailyPnL,
      activeMatches: this.activeMatches,
      canTrade,
      warnings,
    };
  }

  /**
   * Reset daily stats (call at start of new day)
   */
  resetDaily(): void {
    this.dailyPnL = 0;
    console.log('🔄 Daily stats reset');
  }

  /**
   * Get max loss limits
   */
  getLimits() {
    return {
      maxLossPerMatch: this.MAX_LOSS_PER_MATCH,
      maxDailyLoss: this.MAX_DAILY_LOSS,
      maxConcurrentMatches: this.MAX_CONCURRENT_MATCHES,
      maxPositionsPerMatch: this.MAX_POSITIONS_PER_MATCH,
    };
  }
}
