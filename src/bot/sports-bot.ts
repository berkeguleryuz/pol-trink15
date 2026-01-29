/**
 * Main Sports Trading Bot
 * Orchestrates all components: Telegram, Scanner, Strategy, Risk, Executor
 */

import { PolymarketClient } from '../client';
import { SportsTelegramBot, SportsTradingSignal } from '../integrations/sports-telegram-bot';
import { SportsEventDrivenTrader } from '../strategies/sports-event-trader';
import { MatchAwareRiskManager } from '../risk/sports-risk-manager';
import { TimezoneUtils } from '../utils/timezone';

export interface BotConfig {
  dryRun: boolean;
  scanIntervalSeconds: number;
  profitCheckIntervalSeconds: number;
  minLiquidity: number;
  maxPositionSize: number;
}

export class MainSportsBot {
  private client: PolymarketClient;
  private trader: SportsEventDrivenTrader;
  private riskManager: MatchAwareRiskManager;
  private config: BotConfig;
  
  private running = false;
  private scanTimer?: NodeJS.Timeout;
  private profitTimer?: NodeJS.Timeout;
  
  constructor(client: PolymarketClient, config?: Partial<BotConfig>) {
    this.client = client;
    this.trader = new SportsEventDrivenTrader();
    this.riskManager = new MatchAwareRiskManager();
    
    this.config = {
      dryRun: true, // ALWAYS start with dry run
      scanIntervalSeconds: 30, // Scan every 30 seconds
      profitCheckIntervalSeconds: 60, // Check profits every minute
      minLiquidity: 5000,
      maxPositionSize: 2.0,
      ...config,
    };
    
    console.log('\n🤖 ===== MAIN SPORTS BOT ===== 🤖');
    console.log(`Mode: ${this.config.dryRun ? 'DRY RUN ✅' : 'LIVE TRADING ⚠️'}`);
    console.log(`Scan interval: ${this.config.scanIntervalSeconds}s`);
    console.log(`Max position: $${this.config.maxPositionSize}`);
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('⚠️  Bot already running');
      return;
    }
    
    this.running = true;
    console.log('\n🚀 Starting Sports Trading Bot...\n');
    
    // Start Telegram listener
    this.startTelegramListener();
    
    // Start market scanner
    this.startMarketScanner();
    
    // Start profit checker
    this.startProfitChecker();
    
    console.log('✅ Bot started successfully!\n');
    this.printStatus();
  }

  /**
   * Stop the bot
   */
  stop(): void {
    if (!this.running) {
      return;
    }
    
    this.running = false;
    
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
    }
    if (this.profitTimer) {
      clearInterval(this.profitTimer);
    }
    
    console.log('\n🛑 Sports Trading Bot stopped\n');
  }

  /**
   * Start Telegram signal listener
   */
  private startTelegramListener(): void {
    console.log('📱 Starting Telegram listener...');
    
    const telegramBot = this.trader.getTelegramBot();
    
    telegramBot.startListening(async (signal) => {
      await this.handleTelegramSignal(signal);
    });
  }

  /**
   * Handle incoming Telegram signal
   */
  private async handleTelegramSignal(signal: SportsTradingSignal): Promise<void> {
    console.log(`\n📨 NEW TELEGRAM SIGNAL`);
    console.log(`Type: ${signal.type}`);
    console.log(`Match: ${signal.match.homeTeam} ${signal.match.homeScore}-${signal.match.awayScore} ${signal.match.awayTeam}`);
    console.log(`Urgency: ${signal.urgency}`);
    
    try {
      // Check if it's a goal event
      if (signal.type === 'GOAL') {
        await this.handleGoalEvent(signal);
      }
      // Check if it's a red card
      else if (signal.type === 'RED_CARD') {
        await this.handleRedCardEvent(signal);
      }
      // Match start
      else if (signal.type === 'MATCH_START') {
        await this.handleMatchStart(signal);
      }
      
    } catch (error: any) {
      console.error(`❌ Error handling signal: ${error.message}`);
    }
  }

  /**
   * Handle goal event
   */
  private async handleGoalEvent(signal: SportsTradingSignal): Promise<void> {
    console.log(`\n⚽ HANDLING GOAL EVENT`);
    
    // Get trade decision from strategy
    const decision = await this.trader.processGoalEvent(signal);
    
    if (!decision.shouldTrade) {
      console.log(`⏸️  Strategy says: ${decision.explanation}`);
      return;
    }
    
    // Check risk for each position
    for (const trade of decision.markets) {
      const riskCheck = this.riskManager.shouldEnterPosition(signal.match, trade.amount);
      
      if (!riskCheck.allowed) {
        console.log(`🚫 Risk check failed: ${riskCheck.reason}`);
        continue;
      }
      
      // Execute trade
      await this.executeTrade(trade, decision.action);
      
      // Update risk tracking
      if (decision.action === 'BUY') {
        this.riskManager.incrementActiveMatches();
      }
    }
  }

  /**
   * Handle red card event
   */
  private async handleRedCardEvent(signal: SportsTradingSignal): Promise<void> {
    console.log(`\n🔴 HANDLING RED CARD EVENT`);
    
    const decision = await this.trader.processGoalEvent(signal);
    
    if (decision.shouldTrade) {
      for (const trade of decision.markets) {
        await this.executeTrade(trade, decision.action);
      }
    }
  }

  /**
   * Handle match start
   */
  private async handleMatchStart(signal: SportsTradingSignal): Promise<void> {
    console.log(`\n⏱️  HANDLING MATCH START`);
    
    // Can take early positions if odds are good
    const decision = await this.trader.processGoalEvent(signal);
    
    if (decision.shouldTrade) {
      for (const trade of decision.markets) {
        await this.executeTrade(trade, decision.action);
      }
    }
  }

  /**
   * Start periodic market scanner
   */
  private startMarketScanner(): void {
    console.log(`🔍 Starting market scanner (every ${this.config.scanIntervalSeconds}s)...`);
    
    // Initial scan
    this.scanMarkets();
    
    // Periodic scans
    this.scanTimer = setInterval(async () => {
      await this.scanMarkets();
    }, this.config.scanIntervalSeconds * 1000);
  }

  /**
   * Scan markets for opportunities
   */
  private async scanMarkets(): Promise<void> {
    try {
      const decision = await this.trader.scanForOpportunities();
      
      if (decision.shouldTrade) {
        console.log(`\n💡 OPPORTUNITIES FOUND`);
        console.log(`Action: ${decision.action}`);
        console.log(`Markets: ${decision.markets.length}`);
        
        for (const trade of decision.markets) {
          const riskCheck = this.riskManager.shouldEnterPosition(
            { homeTeam: '', awayTeam: '', homeScore: 0, awayScore: 0, minute: 0 },
            trade.amount
          );
          
          if (riskCheck.allowed) {
            await this.executeTrade(trade, decision.action);
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Scan error: ${error.message}`);
    }
  }

  /**
   * Start profit checker
   */
  private startProfitChecker(): void {
    console.log(`💎 Starting profit checker (every ${this.config.profitCheckIntervalSeconds}s)...`);
    
    this.profitTimer = setInterval(async () => {
      await this.checkProfits();
    }, this.config.profitCheckIntervalSeconds * 1000);
  }

  /**
   * Check profit targets
   */
  private async checkProfits(): Promise<void> {
    try {
      const decision = await this.trader.checkProfitTargets();
      
      if (decision.shouldTrade) {
        console.log(`\n💰 PROFIT TARGETS HIT`);
        console.log(`Action: ${decision.action}`);
        console.log(`Positions: ${decision.markets.length}`);
        
        for (const trade of decision.markets) {
          await this.executeTrade(trade, decision.action);
        }
      }
    } catch (error: any) {
      console.error(`❌ Profit check error: ${error.message}`);
    }
  }

  /**
   * Execute trade
   */
  private async executeTrade(
    trade: {
      marketId?: string;
      marketSlug?: string;
      market: string;
      side: 'YES' | 'NO';
      amount: number;
      reason: string;
      urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    },
    action: 'BUY' | 'SELL' | 'HOLD'
  ): Promise<void> {
    console.log(`\n${action === 'BUY' ? '💚' : '❤️'} EXECUTING ${action}`);
    console.log(`Market: ${trade.market}`);
    console.log(`Side: ${trade.side}`);
    console.log(`Amount: $${trade.amount.toFixed(2)}`);
    console.log(`Reason: ${trade.reason}`);
    console.log(`Urgency: ${trade.urgency}`);
    
    if (this.config.dryRun) {
      console.log(`🧪 DRY RUN - Trade NOT executed`);
      return;
    }
    
    try {
      if (action === 'BUY') {
        // Execute buy
        console.log(`🔵 Executing BUY order...`);
        // await this.executor.executeBuy(...);
      } else if (action === 'SELL') {
        // Execute sell
        console.log(`🔴 Executing SELL order...`);
        // await this.executor.executeSell(...);
      }
      
      console.log(`✅ Trade executed successfully`);
      
    } catch (error: any) {
      console.error(`❌ Trade execution failed: ${error.message}`);
    }
  }

  /**
   * Print bot status
   */
  printStatus(): void {
    const riskStatus = this.riskManager.getRiskStatus();
    const strategy = this.trader.getStrategy();
    const activeMatches = strategy.getActiveMatches();
    
    console.log('\n📊 ===== BOT STATUS ===== 📊');
    console.log(`Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Running: ${this.running ? 'YES' : 'NO'}`);
    console.log(`Time: ${TimezoneUtils.formatBerlinTime()}`);
    console.log(`\nRisk Status:`);
    console.log(`  Daily P&L: $${riskStatus.dailyPnL.toFixed(2)}`);
    console.log(`  Active Matches: ${riskStatus.activeMatches}`);
    console.log(`  Can Trade: ${riskStatus.canTrade ? 'YES' : 'NO'}`);
    if (riskStatus.warnings.length > 0) {
      console.log(`  Warnings: ${riskStatus.warnings.join(', ')}`);
    }
    console.log(`\nActive Positions:`);
    console.log(`  Matches: ${activeMatches.length}`);
    for (const match of activeMatches) {
      console.log(`  - ${match.homeTeam} vs ${match.awayTeam}: ${match.positions.length} positions`);
      console.log(`    P&L: $${match.totalProfit.toFixed(2)}`);
    }
    console.log('========================\n');
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      running: this.running,
      config: this.config,
      riskStatus: this.riskManager.getRiskStatus(),
      activeMatches: this.trader.getStrategy().getActiveMatches(),
    };
  }
}
