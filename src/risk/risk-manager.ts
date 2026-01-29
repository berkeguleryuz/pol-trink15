import { TimezoneUtils } from '../utils/timezone';

export interface RiskLimits {
  maxPositionSize: number; // Max $ per single trade
  maxDailyLoss: number; // Max daily loss $
  maxPortfolioExposure: number; // Max total $ in open positions
  emergencyStopLoss: number; // Emergency stop at % daily loss
  maxOpenPositions: number; // Max number of concurrent positions
  minBalance: number; // Minimum balance to keep
}

export interface DailyStats {
  date: string;
  startingBalance: number;
  currentBalance: number;
  totalPnL: number;
  trades: number;
  wins: number;
  losses: number;
  largestWin: number;
  largestLoss: number;
}

export interface PositionRisk {
  positionId: string;
  market: string;
  entryPrice: number;
  currentPrice: number;
  size: number; // $ value
  pnlPercent: number;
  pnlAmount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  shouldClose: boolean;
  reason?: string;
}

export class RiskManager {
  private limits: RiskLimits;
  private dailyStats: DailyStats;
  private currentDate: string;
  private openPositionsValue: number = 0;
  private emergencyStop: boolean = false;

  constructor(
    private startingBalance: number,
    customLimits?: Partial<RiskLimits>
  ) {
    // Default risk limits (for $20 balance)
    this.limits = {
      maxPositionSize: 5.0, // $5 per trade (25% of balance)
      maxDailyLoss: 2.0, // $2 max daily loss (10% of balance)
      maxPortfolioExposure: 15.0, // $15 max in open positions (75%)
      emergencyStopLoss: 0.20, // Stop trading at -20% daily
      maxOpenPositions: 5,
      minBalance: 5.0, // Keep at least $5
      ...customLimits,
    };

    this.currentDate = this.getTodayString();
    this.dailyStats = this.initializeDailyStats(startingBalance);
  }

  /**
   * Check if a new trade is allowed
   */
  canTrade(amount: number, currentBalance: number): {
    allowed: boolean;
    reason?: string;
  } {
    // Emergency stop check
    if (this.emergencyStop) {
      return {
        allowed: false,
        reason: `🚨 EMERGENCY STOP ACTIVE - Daily loss limit exceeded!`,
      };
    }

    // Check if new day (reset stats)
    this.checkDayRollover(currentBalance);

    // Check minimum balance
    if (currentBalance < this.limits.minBalance) {
      return {
        allowed: false,
        reason: `⚠️ Balance too low ($${currentBalance.toFixed(2)} < $${this.limits.minBalance})`,
      };
    }

    // Check position size limit
    if (amount > this.limits.maxPositionSize) {
      return {
        allowed: false,
        reason: `⚠️ Position too large ($${amount.toFixed(2)} > $${this.limits.maxPositionSize} max)`,
      };
    }

    // Check daily loss limit
    const dailyLoss = this.startingBalance - currentBalance;
    if (dailyLoss >= this.limits.maxDailyLoss) {
      return {
        allowed: false,
        reason: `⚠️ Daily loss limit reached ($${dailyLoss.toFixed(2)} >= $${this.limits.maxDailyLoss})`,
      };
    }

    // Check portfolio exposure
    if (this.openPositionsValue + amount > this.limits.maxPortfolioExposure) {
      return {
        allowed: false,
        reason: `⚠️ Portfolio exposure too high ($${(this.openPositionsValue + amount).toFixed(2)} > $${this.limits.maxPortfolioExposure})`,
      };
    }

    // Check max open positions
    // Note: This should be checked by caller with actual position count
    
    return { allowed: true };
  }

  /**
   * Record a new trade
   */
  recordTrade(pnl: number): void {
    this.dailyStats.trades++;
    this.dailyStats.totalPnL += pnl;

    if (pnl > 0) {
      this.dailyStats.wins++;
      if (pnl > this.dailyStats.largestWin) {
        this.dailyStats.largestWin = pnl;
      }
    } else if (pnl < 0) {
      this.dailyStats.losses++;
      if (pnl < this.dailyStats.largestLoss) {
        this.dailyStats.largestLoss = pnl;
      }
    }
  }

  /**
   * Update current balance and check emergency stop
   */
  updateBalance(newBalance: number): void {
    this.dailyStats.currentBalance = newBalance;
    
    const dailyLossPercent = ((this.dailyStats.startingBalance - newBalance) / this.dailyStats.startingBalance);
    
    // Check emergency stop
    if (dailyLossPercent >= this.limits.emergencyStopLoss) {
      this.emergencyStop = true;
      console.log(`\n🚨 EMERGENCY STOP ACTIVATED 🚨`);
      console.log(`Daily loss: ${(dailyLossPercent * 100).toFixed(1)}% >= ${(this.limits.emergencyStopLoss * 100)}%`);
      console.log(`No more trades allowed today!`);
    }
  }

  /**
   * Update open positions total value
   */
  updateOpenPositions(totalValue: number): void {
    this.openPositionsValue = totalValue;
  }

  /**
   * Analyze position risk
   */
  analyzePositionRisk(
    positionId: string,
    market: string,
    entryPrice: number,
    currentPrice: number,
    size: number
  ): PositionRisk {
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    const pnlAmount = (currentPrice - entryPrice) * size;

    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let shouldClose = false;
    let reason: string | undefined;

    if (pnlPercent <= -50) {
      riskLevel = 'CRITICAL';
      shouldClose = true;
      reason = 'Position down 50%+. Cut losses immediately!';
    } else if (pnlPercent <= -30) {
      riskLevel = 'HIGH';
      shouldClose = true;
      reason = 'Position down 30%. Consider closing.';
    } else if (pnlPercent <= -15) {
      riskLevel = 'MEDIUM';
      reason = 'Position down 15%. Monitor closely.';
    } else if (pnlPercent >= 100) {
      riskLevel = 'LOW';
      shouldClose = true;
      reason = 'Position doubled! Consider taking profits.';
    }

    return {
      positionId,
      market,
      entryPrice,
      currentPrice,
      size,
      pnlPercent,
      pnlAmount,
      riskLevel,
      shouldClose,
      reason,
    };
  }

  /**
   * Get daily statistics
   */
  getDailyStats(): DailyStats {
    return { ...this.dailyStats };
  }

  /**
   * Get risk limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Is emergency stop active?
   */
  isEmergencyStop(): boolean {
    return this.emergencyStop;
  }

  /**
   * Get portfolio risk summary
   */
  getPortfolioSummary(): {
    balance: number;
    openPositionsValue: number;
    availableCapital: number;
    dailyPnL: number;
    dailyPnLPercent: number;
    winRate: number;
    tradesCount: number;
  } {
    const winRate = this.dailyStats.trades > 0 
      ? (this.dailyStats.wins / this.dailyStats.trades) * 100 
      : 0;

    const dailyPnLPercent = this.dailyStats.startingBalance > 0
      ? (this.dailyStats.totalPnL / this.dailyStats.startingBalance) * 100
      : 0;

    return {
      balance: this.dailyStats.currentBalance,
      openPositionsValue: this.openPositionsValue,
      availableCapital: this.dailyStats.currentBalance - this.openPositionsValue,
      dailyPnL: this.dailyStats.totalPnL,
      dailyPnLPercent,
      winRate,
      tradesCount: this.dailyStats.trades,
    };
  }

  /**
   * Log risk summary
   */
  logRiskSummary(): void {
    const summary = this.getPortfolioSummary();
    const stats = this.dailyStats;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 RISK MANAGEMENT SUMMARY - ${TimezoneUtils.formatBerlinTime()}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💰 Balance: $${summary.balance.toFixed(2)}`);
    console.log(`📈 Open Positions: $${summary.openPositionsValue.toFixed(2)}`);
    console.log(`💵 Available Capital: $${summary.availableCapital.toFixed(2)}`);
    console.log(`📊 Daily P&L: ${summary.dailyPnL >= 0 ? '+' : ''}$${summary.dailyPnL.toFixed(2)} (${summary.dailyPnLPercent >= 0 ? '+' : ''}${summary.dailyPnLPercent.toFixed(2)}%)`);
    console.log(`🎯 Win Rate: ${summary.winRate.toFixed(1)}% (${stats.wins}W / ${stats.losses}L)`);
    console.log(`📈 Largest Win: $${stats.largestWin.toFixed(2)}`);
    console.log(`📉 Largest Loss: $${stats.largestLoss.toFixed(2)}`);
    console.log(`🚨 Emergency Stop: ${this.emergencyStop ? 'ACTIVE ⛔' : 'Inactive ✅'}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Helper: Check if day rolled over
   */
  private checkDayRollover(currentBalance: number): void {
    const today = this.getTodayString();
    
    if (today !== this.currentDate) {
      console.log(`\n🌅 NEW DAY: ${today}`);
      console.log(`Previous day stats saved.`);
      
      this.currentDate = today;
      this.dailyStats = this.initializeDailyStats(currentBalance);
      this.emergencyStop = false; // Reset emergency stop
      this.openPositionsValue = 0; // Will be recalculated
    }
  }

  /**
   * Helper: Get today's date string
   */
  private getTodayString(): string {
    const date = TimezoneUtils.getBerlinTime();
    return date.toISOString().split('T')[0];
  }

  /**
   * Helper: Initialize daily stats
   */
  private initializeDailyStats(balance: number): DailyStats {
    return {
      date: this.getTodayString(),
      startingBalance: balance,
      currentBalance: balance,
      totalPnL: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      largestWin: 0,
      largestLoss: 0,
    };
  }
}
