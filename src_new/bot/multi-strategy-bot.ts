/**
 * MULTI-STRATEGY BOT
 *
 * Runs all three whale-based trading strategies together:
 * - Mirror Strategy: Instant whale copy
 * - Smart Strategy: Multi-factor scoring
 * - Safe Strategy: Pattern-based conservative
 *
 * Features:
 * - Unified risk management across strategies
 * - Strategy-specific allocation
 * - Dry run mode for testing
 * - Comprehensive logging
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import { getWebSocketManager } from '../data/websocket-manager';
import { getPriceCache } from '../data/price-cache';
import { getWhaleTracker } from '../analysis/whale-tracker';

import { MirrorStrategy } from '../strategies/mirror-strategy';
import { SmartStrategy } from '../strategies/smart-strategy';
import { SafeStrategy } from '../strategies/safe-strategy';
import { StrategyType, TradeSignal, RiskState, BotStats } from '../strategies/types';

// Bot configuration
export interface MultiBotConfig {
  dryRun: boolean;              // Simulate trades without execution
  enableMirror: boolean;        // Enable mirror strategy
  enableSmart: boolean;         // Enable smart strategy
  enableSafe: boolean;          // Enable safe strategy
  maxDailyLoss: number;         // Global daily loss limit
  logDir: string;               // Log directory
  allocation: {                 // Budget allocation per strategy
    mirror: number;
    smart: number;
    safe: number;
  };
}

const DEFAULT_CONFIG: MultiBotConfig = {
  dryRun: true,
  enableMirror: true,
  enableSmart: true,
  enableSafe: true,
  maxDailyLoss: 20,
  logDir: './data/multi-bot-logs',
  allocation: {
    mirror: 10,  // $10 for mirror
    smart: 8,    // $8 for smart
    safe: 5      // $5 for safe
  }
};

export class MultiStrategyBot extends EventEmitter {
  private config: MultiBotConfig;
  private isRunning: boolean = false;
  private startTime: number = 0;

  // Strategies
  private mirrorStrategy: MirrorStrategy | null = null;
  private smartStrategy: SmartStrategy | null = null;
  private safeStrategy: SafeStrategy | null = null;

  // Global risk state
  private globalRisk: RiskState = {
    dailyPnL: 0,
    dailyTrades: 0,
    dailyWins: 0,
    dailyLosses: 0,
    consecutiveLosses: 0,
    lastLossTime: 0,
    isPaused: false
  };

  // Statistics
  private stats: BotStats = {
    totalTrades: 0,
    totalWins: 0,
    totalLosses: 0,
    totalPnL: 0,
    winRate: 0,
    avgProfit: 0,
    avgLoss: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    tradesPerStrategy: { mirror: 0, smart: 0, safe: 0 }
  };

  // Signal log
  private signals: TradeSignal[] = [];
  private maxSignalHistory: number = 1000;

  constructor(config: Partial<MultiBotConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[MultiBot] Already running');
      return;
    }

    console.log('\n' + '═'.repeat(60));
    console.log('  🐋 MULTI-STRATEGY BOT');
    console.log('═'.repeat(60));
    console.log(`  Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`  Mirror: ${this.config.enableMirror ? '✅' : '❌'}`);
    console.log(`  Smart: ${this.config.enableSmart ? '✅' : '❌'}`);
    console.log(`  Safe: ${this.config.enableSafe ? '✅' : '❌'}`);
    console.log('═'.repeat(60) + '\n');

    this.startTime = Date.now();

    // Initialize WebSocket connection
    const ws = getWebSocketManager();
    ws.connect();

    // Wait for connection
    await new Promise<void>((resolve) => {
      if (ws.connected) {
        resolve();
      } else {
        ws.once('connected', resolve);
      }
    });

    // Start price cache
    const priceCache = getPriceCache();
    priceCache.startPolling();

    // Initialize strategies
    if (this.config.enableMirror) {
      this.mirrorStrategy = new MirrorStrategy({
        maxDailyLoss: this.config.allocation.mirror
      });
      this.mirrorStrategy.on('signal', (signal) => this.handleSignal(signal));
      await this.mirrorStrategy.start();
    }

    if (this.config.enableSmart) {
      this.smartStrategy = new SmartStrategy({
        maxDailyLoss: this.config.allocation.smart
      });
      this.smartStrategy.on('signal', (signal) => this.handleSignal(signal));
      await this.smartStrategy.start();
    }

    if (this.config.enableSafe) {
      this.safeStrategy = new SafeStrategy({
        maxDailyLoss: this.config.allocation.safe
      });
      this.safeStrategy.on('signal', (signal) => this.handleSignal(signal));
      await this.safeStrategy.start();
    }

    this.isRunning = true;
    this.emit('started');

    console.log('[MultiBot] Bot started successfully');

    // Start status printing
    this.printStatusLoop();
  }

  /**
   * Stop the bot
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log('[MultiBot] Stopping...');

    this.mirrorStrategy?.stop();
    this.smartStrategy?.stop();
    this.safeStrategy?.stop();

    getPriceCache().stopPolling();
    getWebSocketManager().disconnect();

    this.isRunning = false;
    this.emit('stopped');

    // Print final stats
    this.printStats();

    console.log('[MultiBot] Bot stopped');
  }

  /**
   * Handle signal from any strategy
   */
  private handleSignal(signal: TradeSignal): void {
    // Check global risk
    if (this.globalRisk.isPaused) {
      console.log(`[MultiBot] Signal blocked - global risk paused`);
      return;
    }

    if (Math.abs(this.globalRisk.dailyPnL) >= this.config.maxDailyLoss) {
      this.globalRisk.isPaused = true;
      this.globalRisk.pauseReason = 'Global daily loss limit';
      console.log(`[MultiBot] Trading paused - daily loss limit reached`);
      return;
    }

    // Log signal
    this.signals.push(signal);
    if (this.signals.length > this.maxSignalHistory) {
      this.signals.shift();
    }

    // Update stats
    this.stats.totalTrades++;
    this.stats.tradesPerStrategy[signal.strategy]++;
    this.globalRisk.dailyTrades++;

    // Log to file
    this.logSignal(signal);

    // Print signal
    this.printSignal(signal);

    // Emit for external handling
    this.emit('signal', signal);
  }

  /**
   * Print signal to console
   */
  private printSignal(signal: TradeSignal): void {
    const strategyColors: Record<StrategyType, string> = {
      mirror: '\x1b[36m',  // Cyan
      smart: '\x1b[33m',   // Yellow
      safe: '\x1b[32m'     // Green
    };
    const reset = '\x1b[0m';
    const color = strategyColors[signal.strategy];

    const time = new Date().toLocaleTimeString('de-DE', { hour12: false });
    const priceStr = ((signal.price * 100).toFixed(0) + '¢').padStart(4);
    const amountStr = ('$' + signal.amount.toFixed(2)).padStart(6);
    const confStr = (signal.confidence + '%').padStart(4);

    console.log(`[${time}] ${color}${signal.strategy.toUpperCase().padEnd(6)}${reset} | ${signal.coin} ${signal.outcome.padEnd(4)} | ${priceStr} ${amountStr} | Conf: ${confStr} | ${signal.reason}`);
  }

  /**
   * Log signal to file
   */
  private logSignal(signal: TradeSignal): void {
    const logFile = path.join(this.config.logDir, `signals_${new Date().toISOString().split('T')[0]}.jsonl`);
    const line = JSON.stringify(signal) + '\n';
    fs.appendFileSync(logFile, line);
  }

  /**
   * Print status periodically
   */
  private printStatusLoop(): void {
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }

      // Print every 30 seconds
      this.printStatus();
    }, 30000);
  }

  /**
   * Print current status
   */
  private printStatus(): void {
    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(runtime / 60);
    const seconds = runtime % 60;

    console.log(`\n[Status] Runtime: ${minutes}m ${seconds}s | Trades: ${this.stats.totalTrades} | PnL: $${this.globalRisk.dailyPnL.toFixed(2)}`);
    console.log(`  Mirror: ${this.stats.tradesPerStrategy.mirror} | Smart: ${this.stats.tradesPerStrategy.smart} | Safe: ${this.stats.tradesPerStrategy.safe}\n`);
  }

  /**
   * Print final statistics
   */
  private printStats(): void {
    console.log('\n' + '═'.repeat(60));
    console.log('  📊 SESSION STATISTICS');
    console.log('═'.repeat(60));
    console.log(`  Total Trades: ${this.stats.totalTrades}`);
    console.log(`  Total PnL: $${this.globalRisk.dailyPnL.toFixed(2)}`);
    console.log(`  Win Rate: ${this.stats.totalTrades > 0 ? ((this.stats.totalWins / this.stats.totalTrades) * 100).toFixed(1) : 0}%`);
    console.log(`  Mirror Trades: ${this.stats.tradesPerStrategy.mirror}`);
    console.log(`  Smart Trades: ${this.stats.tradesPerStrategy.smart}`);
    console.log(`  Safe Trades: ${this.stats.tradesPerStrategy.safe}`);
    console.log('═'.repeat(60) + '\n');
  }

  /**
   * Get current stats
   */
  getStats(): BotStats {
    return { ...this.stats };
  }

  /**
   * Get risk state
   */
  getRiskState(): RiskState {
    return { ...this.globalRisk };
  }

  /**
   * Get recent signals
   */
  getSignals(limit: number = 50): TradeSignal[] {
    return this.signals.slice(-limit);
  }

  /**
   * Check if running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Record trade result (for tracking wins/losses)
   */
  recordResult(won: boolean, profit: number, strategy: StrategyType): void {
    this.globalRisk.dailyPnL += profit;

    if (won) {
      this.stats.totalWins++;
      this.globalRisk.dailyWins++;
      this.globalRisk.consecutiveLosses = 0;
    } else {
      this.stats.totalLosses++;
      this.globalRisk.dailyLosses++;
      this.globalRisk.consecutiveLosses++;
      this.globalRisk.lastLossTime = Date.now();
    }

    this.stats.totalPnL = this.globalRisk.dailyPnL;
    this.stats.winRate = this.stats.totalTrades > 0
      ? this.stats.totalWins / this.stats.totalTrades
      : 0;
  }
}

// ============================================================================
// CLI Runner
// ============================================================================

async function main() {
  const bot = new MultiStrategyBot({
    dryRun: true,
    enableMirror: true,
    enableSmart: true,
    enableSafe: true
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    bot.stop();
    process.exit(0);
  });

  // Start bot
  await bot.start();

  console.log('\nBot running. Press Ctrl+C to stop.\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default MultiStrategyBot;
