import { TimezoneUtils } from '../utils/timezone';
import * as fs from 'fs';
import * as path from 'path';

export interface Trade {
  id: string;
  timestamp: Date;
  market: string;
  side: 'BUY' | 'SELL';
  shares: number;
  pricePerShare: number;
  totalCost: number;
  outcome: 'YES' | 'NO';
}

export interface ClosedPosition {
  market: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPercent: number;
  holdingTime: number; // hours
  timestamp: Date;
}

export interface PerformanceMetrics {
  // Basic metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // Financial metrics
  totalPnL: number;
  totalPnLPercent: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number; // Total wins / Total losses
  
  // Risk metrics
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  
  // Time metrics
  averageHoldingTime: number; // hours
  tradingDays: number;
  
  // Current status
  currentBalance: number;
  startingBalance: number;
  returnsPercent: number;
}

export interface DailyReport {
  date: string;
  trades: number;
  pnl: number;
  winRate: number;
  balance: number;
}

export class PerformanceAnalytics {
  private trades: Trade[] = [];
  private closedPositions: ClosedPosition[] = [];
  private startingBalance: number;
  private currentBalance: number;
  private dataDir: string;

  constructor(startingBalance: number, dataDir: string = './data/analytics') {
    this.startingBalance = startingBalance;
    this.currentBalance = startingBalance;
    this.dataDir = dataDir;
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.loadData();
  }

  /**
   * Record a new trade
   */
  recordTrade(trade: Trade): void {
    this.trades.push(trade);
    this.saveData();
  }

  /**
   * Record a closed position
   */
  recordClosedPosition(position: ClosedPosition): void {
    this.closedPositions.push(position);
    this.currentBalance += position.pnl;
    this.saveData();
  }

  /**
   * Calculate all performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const winningPositions = this.closedPositions.filter(p => p.pnl > 0);
    const losingPositions = this.closedPositions.filter(p => p.pnl < 0);
    
    const totalWins = winningPositions.reduce((sum, p) => sum + p.pnl, 0);
    const totalLosses = Math.abs(losingPositions.reduce((sum, p) => sum + p.pnl, 0));
    
    const averageWin = winningPositions.length > 0 ? totalWins / winningPositions.length : 0;
    const averageLoss = losingPositions.length > 0 ? totalLosses / losingPositions.length : 0;
    
    const largestWin = winningPositions.length > 0 
      ? Math.max(...winningPositions.map(p => p.pnl)) 
      : 0;
    const largestLoss = losingPositions.length > 0 
      ? Math.min(...losingPositions.map(p => p.pnl)) 
      : 0;
    
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    
    const totalPnL = this.currentBalance - this.startingBalance;
    const totalPnLPercent = (totalPnL / this.startingBalance) * 100;
    
    const averageHoldingTime = this.closedPositions.length > 0
      ? this.closedPositions.reduce((sum, p) => sum + p.holdingTime, 0) / this.closedPositions.length
      : 0;
    
    const sharpeRatio = this.calculateSharpeRatio();
    const { maxDrawdown, maxDrawdownPercent } = this.calculateMaxDrawdown();
    
    return {
      totalTrades: this.closedPositions.length,
      winningTrades: winningPositions.length,
      losingTrades: losingPositions.length,
      winRate: this.closedPositions.length > 0 
        ? (winningPositions.length / this.closedPositions.length) * 100 
        : 0,
      
      totalPnL,
      totalPnLPercent,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      profitFactor,
      
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      
      averageHoldingTime,
      tradingDays: this.getTradingDays(),
      
      currentBalance: this.currentBalance,
      startingBalance: this.startingBalance,
      returnsPercent: totalPnLPercent,
    };
  }

  /**
   * Get daily report
   */
  getDailyReport(date?: Date): DailyReport {
    const targetDate = date || TimezoneUtils.getBerlinTime();
    const dateString = targetDate.toISOString().split('T')[0];
    
    const dayPositions = this.closedPositions.filter(p => 
      p.timestamp.toISOString().split('T')[0] === dateString
    );
    
    const dayPnL = dayPositions.reduce((sum, p) => sum + p.pnl, 0);
    const dayWins = dayPositions.filter(p => p.pnl > 0).length;
    
    return {
      date: dateString,
      trades: dayPositions.length,
      pnl: dayPnL,
      winRate: dayPositions.length > 0 ? (dayWins / dayPositions.length) * 100 : 0,
      balance: this.currentBalance,
    };
  }

  /**
   * Get weekly summary
   */
  getWeeklySummary(): {
    weeklyPnL: number;
    weeklyTrades: number;
    weeklyWinRate: number;
    dailyReports: DailyReport[];
  } {
    const now = TimezoneUtils.getBerlinTime();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const weekPositions = this.closedPositions.filter(p => p.timestamp >= weekAgo);
    const weekPnL = weekPositions.reduce((sum, p) => sum + p.pnl, 0);
    const weekWins = weekPositions.filter(p => p.pnl > 0).length;
    
    // Get daily reports for the week
    const dailyReports: DailyReport[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dailyReports.push(this.getDailyReport(date));
    }
    
    return {
      weeklyPnL: weekPnL,
      weeklyTrades: weekPositions.length,
      weeklyWinRate: weekPositions.length > 0 ? (weekWins / weekPositions.length) * 100 : 0,
      dailyReports: dailyReports.reverse(),
    };
  }

  /**
   * Log performance report
   */
  logPerformanceReport(): void {
    const metrics = this.getMetrics();
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 PERFORMANCE ANALYTICS REPORT`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📅 Generated: ${TimezoneUtils.formatBerlinTime()}\n`);
    
    console.log(`💰 FINANCIAL PERFORMANCE`);
    console.log(`   Starting Balance: $${metrics.startingBalance.toFixed(2)}`);
    console.log(`   Current Balance:  $${metrics.currentBalance.toFixed(2)}`);
    console.log(`   Total P&L:        ${metrics.totalPnL >= 0 ? '+' : ''}$${metrics.totalPnL.toFixed(2)} (${metrics.totalPnLPercent >= 0 ? '+' : ''}${metrics.totalPnLPercent.toFixed(2)}%)`);
    console.log(`   Returns:          ${metrics.returnsPercent >= 0 ? '+' : ''}${metrics.returnsPercent.toFixed(2)}%\n`);
    
    console.log(`📈 TRADING STATISTICS`);
    console.log(`   Total Trades:     ${metrics.totalTrades}`);
    console.log(`   Winning Trades:   ${metrics.winningTrades} (${metrics.winRate.toFixed(1)}%)`);
    console.log(`   Losing Trades:    ${metrics.losingTrades}`);
    console.log(`   Average Win:      $${metrics.averageWin.toFixed(2)}`);
    console.log(`   Average Loss:     $${Math.abs(metrics.averageLoss).toFixed(2)}`);
    console.log(`   Largest Win:      $${metrics.largestWin.toFixed(2)}`);
    console.log(`   Largest Loss:     $${metrics.largestLoss.toFixed(2)}`);
    console.log(`   Profit Factor:    ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}\n`);
    
    console.log(`📊 RISK METRICS`);
    console.log(`   Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(3)}`);
    console.log(`   Max Drawdown:     $${Math.abs(metrics.maxDrawdown).toFixed(2)} (${Math.abs(metrics.maxDrawdownPercent).toFixed(2)}%)`);
    console.log(`   Avg Holding Time: ${metrics.averageHoldingTime.toFixed(1)} hours`);
    console.log(`   Trading Days:     ${metrics.tradingDays}\n`);
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Log weekly summary
   */
  logWeeklySummary(): void {
    const weekly = this.getWeeklySummary();
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📅 WEEKLY SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    console.log(`💰 Weekly P&L:      ${weekly.weeklyPnL >= 0 ? '+' : ''}$${weekly.weeklyPnL.toFixed(2)}`);
    console.log(`📊 Weekly Trades:   ${weekly.weeklyTrades}`);
    console.log(`🎯 Weekly Win Rate: ${weekly.weeklyWinRate.toFixed(1)}%\n`);
    
    console.log(`📅 Daily Breakdown:`);
    weekly.dailyReports.forEach(day => {
      if (day.trades > 0) {
        console.log(`   ${day.date}: ${day.trades} trades, ${day.pnl >= 0 ? '+' : ''}$${day.pnl.toFixed(2)}, ${day.winRate.toFixed(0)}% win rate`);
      }
    });
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Calculate Sharpe Ratio (simplified, assumes 0% risk-free rate)
   */
  private calculateSharpeRatio(): number {
    if (this.closedPositions.length < 2) return 0;
    
    const returns = this.closedPositions.map(p => p.pnlPercent / 100);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? avgReturn / stdDev : 0;
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(): { maxDrawdown: number; maxDrawdownPercent: number } {
    let peak = this.startingBalance;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let balance = this.startingBalance;
    
    for (const position of this.closedPositions) {
      balance += position.pnl;
      
      if (balance > peak) {
        peak = balance;
      }
      
      const drawdown = peak - balance;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = (drawdown / peak) * 100;
      }
    }
    
    return { maxDrawdown, maxDrawdownPercent };
  }

  /**
   * Get number of trading days
   */
  private getTradingDays(): number {
    if (this.closedPositions.length === 0) return 0;
    
    const uniqueDates = new Set(
      this.closedPositions.map(p => p.timestamp.toISOString().split('T')[0])
    );
    
    return uniqueDates.size;
  }

  /**
   * Save data to files
   */
  private saveData(): void {
    try {
      const tradesFile = path.join(this.dataDir, 'trades.json');
      const positionsFile = path.join(this.dataDir, 'positions.json');
      
      fs.writeFileSync(tradesFile, JSON.stringify(this.trades, null, 2));
      fs.writeFileSync(positionsFile, JSON.stringify(this.closedPositions, null, 2));
    } catch (error) {
      console.error('Error saving analytics data:', error);
    }
  }

  /**
   * Load data from files
   */
  private loadData(): void {
    try {
      const tradesFile = path.join(this.dataDir, 'trades.json');
      const positionsFile = path.join(this.dataDir, 'positions.json');
      
      if (fs.existsSync(tradesFile)) {
        this.trades = JSON.parse(fs.readFileSync(tradesFile, 'utf-8'));
      }
      
      if (fs.existsSync(positionsFile)) {
        this.closedPositions = JSON.parse(fs.readFileSync(positionsFile, 'utf-8'));
        // Recalculate current balance
        const totalPnL = this.closedPositions.reduce((sum, p) => sum + p.pnl, 0);
        this.currentBalance = this.startingBalance + totalPnL;
      }
    } catch (error) {
      console.error('Error loading analytics data:', error);
    }
  }
}
