#!/usr/bin/env ts-node

/**
 * Main Bot Orchestrator
 * Coordinates all trading strategies and runs in continuous mode
 * 
 * Usage:
 *   npm start              - Run normal bot (news-driven)
 *   npm run bot:sport      - Run sports betting bot
 */

import { PolymarketClient } from '../client';
import { config } from '../config';
import { MarketScanner } from '../strategies/market-scanner';
import { CoreTradingStrategy, TradingSignal } from '../strategies/core-strategy';
import { DynamicPricingStrategy } from '../strategies/dynamic-pricing';
import { RiskManager } from '../risk/risk-manager';
import { PerplexityAI } from '../integrations/perplexity-ai';
import { SportsAPI, SportsTradingSignal } from '../integrations/sports-api';
import { TimezoneUtils } from '../utils/timezone';
import { getBalance } from '../utils/balance';

interface BotConfig {
  mode: 'NORMAL' | 'SPORT';
  scanIntervalMinutes: number;
  autoTrade: boolean;
  dryRun: boolean;
}

class TradingBotOrchestrator {
  private client: PolymarketClient;
  private scanner: MarketScanner;
  private tradingStrategy: CoreTradingStrategy;
  private pricingStrategy: DynamicPricingStrategy;
  private riskManager: RiskManager;
  private perplexityAI: PerplexityAI;
  private sportsAPI: SportsAPI;
  
  private config: BotConfig;
  private running: boolean = false;
  private lastScanTime: Date | null = null;

  private clientPromise: Promise<PolymarketClient>;

  constructor(mode: 'NORMAL' | 'SPORT' = 'NORMAL', autoTrade: boolean = false) {
    this.clientPromise = PolymarketClient.create();
    // Will be initialized in start()
    this.client = null as any;
    this.scanner = null as any;
    this.tradingStrategy = null as any;
    this.pricingStrategy = new DynamicPricingStrategy();
    this.riskManager = new RiskManager(19.96); // Current balance
    this.perplexityAI = new PerplexityAI();
    this.sportsAPI = new SportsAPI();

    this.config = {
      mode,
      scanIntervalMinutes: mode === 'SPORT' ? 2 : 5, // Sports faster
      autoTrade,
      dryRun: !autoTrade, // If not auto-trading, it's dry run
    };
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    this.running = true;
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🤖 POLYMARKET TRADING BOT STARTING`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📍 Location: Europe/Berlin (${TimezoneUtils.formatBerlinTime()})`);
    console.log(`🎯 Mode: ${this.config.mode}`);
    console.log(`⚡ Auto-Trade: ${this.config.autoTrade ? 'ENABLED ✅' : 'DISABLED (DRY RUN) ⚠️'}`);
    console.log(`⏱️  Scan Interval: ${this.config.scanIntervalMinutes} minutes`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Show risk limits
    this.riskManager.logRiskSummary();

    // Show pricing strategy
    this.pricingStrategy.logExitLevels();

    // Initialize
    await this.initialize();

    // Start main loop
    await this.mainLoop();
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.running = false;
    console.log(`\n🛑 Bot stopping...`);
  }

  /**
   * Initialize bot systems
   */
  private async initialize(): Promise<void> {
    console.log(`🔄 Initializing bot systems...`);
    
    try {
      // Initialize Polymarket client
      this.client = await this.clientPromise;
      const clobClient = this.client.getClient();
      console.log(`✅ Connected to Polymarket`);

      // Initialize scanner with PolymarketClient
      this.scanner = new MarketScanner(this.client);
      await this.scanner.initialize();
      console.log(`✅ Market scanner initialized`);
      
      // Initialize trading strategy
      this.tradingStrategy = new CoreTradingStrategy(clobClient);

      // Test Perplexity (only for normal mode)
      if (this.config.mode === 'NORMAL') {
        console.log(`🧪 Testing Perplexity AI...`);
        const testNews = await this.perplexityAI.getFinanceNews();
        console.log(`✅ Perplexity AI ready (${testNews.length} news items)`);
      }

      // Test Sports API (only for sports mode)
      if (this.config.mode === 'SPORT') {
        console.log(`🧪 Testing Sports API...`);
        const matches = await this.sportsAPI.getLiveMatches();
        console.log(`✅ Sports API ready (${matches.length} live matches)`);
      }

      console.log(`✅ Bot initialization complete!\n`);
    } catch (error) {
      console.error(`❌ Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Main bot loop
   */
  private async mainLoop(): Promise<void> {
    while (this.running) {
      try {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🔄 SCAN CYCLE - ${TimezoneUtils.formatBerlinTime()}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        // Check if we can trade
        const balanceData = await getBalance(this.client);
        const balance = parseFloat(balanceData.usdc);
        this.riskManager.updateBalance(balance);

        if (this.riskManager.isEmergencyStop()) {
          console.log(`\n⚠️  Emergency stop active. Monitoring only.\n`);
          await this.sleep(this.config.scanIntervalMinutes * 60 * 1000);
          continue;
        }

        // Run appropriate strategy
        if (this.config.mode === 'NORMAL') {
          await this.runNormalStrategy();
        } else {
          await this.runSportStrategy();
        }

        // Show risk summary
        this.riskManager.logRiskSummary();

        this.lastScanTime = TimezoneUtils.getBerlinTime();

        // Wait for next scan
        console.log(`\n⏱️  Next scan in ${this.config.scanIntervalMinutes} minutes...\n`);
        await this.sleep(this.config.scanIntervalMinutes * 60 * 1000);

      } catch (error) {
        console.error(`❌ Error in main loop:`, error);
        console.log(`⏱️  Retrying in 1 minute...`);
        await this.sleep(60 * 1000);
      }
    }
  }

  /**
   * Normal strategy: News-driven trading
   */
  private async runNormalStrategy(): Promise<void> {
    console.log(`📰 Running NORMAL strategy (News-driven)...\n`);

    // 1. Fetch latest news
    console.log(`🔍 Fetching news from Perplexity AI...`);
    const [financeNews, techNews, politicsNews] = await Promise.all([
      this.perplexityAI.getFinanceNews(),
      this.perplexityAI.getTechNews(),
      this.perplexityAI.getPoliticalNews(),
    ]);

    console.log(`📊 News collected: ${financeNews.length} finance, ${techNews.length} tech, ${politicsNews.length} politics\n`);

    // 2. Scan markets
    console.log(`🔍 Scanning markets...`);
    const opportunities = await this.scanner.scan();
    console.log(`📊 Found ${opportunities.length} opportunities\n`);

    // 3. Analyze opportunities with news context
    const signals: TradingSignal[] = [];
    for (const opp of opportunities) {
      // Match news to market (simple keyword matching)
      const allNews = [...financeNews, ...techNews, ...politicsNews];
      const relevantNews = allNews.find(news =>
        opp.marketQuestion.toLowerCase().includes(news.topic?.toLowerCase() || '')
      );

      const signal = this.tradingStrategy.analyzeMarket(
        {
          condition_id: opp.marketId,
          question: opp.marketQuestion,
          slug: opp.marketSlug,
          tokens: [{ token_id: opp.tokenId, outcome: opp.side, price: opp.currentPrice.toString() }],
          outcomePrices: [opp.currentPrice.toString()],
          liquidity: opp.liquidity.toString(),
          volume: opp.volume24h.toString(),
        },
        relevantNews?.summary
      );

      if (signal.action !== 'HOLD') {
        signals.push(signal);
      }
    }

    // 4. Execute top signals
    await this.executeSignals(signals);
  }

  /**
   * Sport strategy: Live match betting
   */
  private async runSportStrategy(): Promise<void> {
    console.log(`⚽ Running SPORT strategy (Live betting)...\n`);

    // 1. Get live matches
    console.log(`🔍 Fetching live matches...`);
    const matches = await this.sportsAPI.getLiveMatches();
    console.log(`📊 Found ${matches.length} live matches\n`);

    // 2. Detect trading signals
    const signals: SportsTradingSignal[] = [];
    for (const match of matches) {
      const matchSignals = this.sportsAPI.detectTradingSignals(match);
      signals.push(...matchSignals);
    }

    console.log(`🎯 Detected ${signals.length} trading signals\n`);

    // 3. Convert to trading signals and execute
    const tradingSignals: TradingSignal[] = signals.map(signal => ({
      action: signal.signal === 'BUY' ? 'BUY' : 'SELL',
      market: {
        condition_id: signal.matchId || 'sport-' + Date.now(),
        question: signal.suggestedMarket,
        slug: signal.match.toLowerCase().replace(/\s+/g, '-'),
        tokens: [],
        outcomePrices: ['0.5'], // Default odds
        liquidity: '10000',
        volume: '5000',
      },
      reason: signal.reason,
      confidence: signal.confidence,
      suggestedAmount: 2.0, // Fixed $2 for sports bets
    }));

    await this.executeSignals(tradingSignals);
  }

  /**
   * Execute trading signals
   */
  private async executeSignals(signals: TradingSignal[]): Promise<void> {
    if (signals.length === 0) {
      console.log(`ℹ️  No trading signals to execute.\n`);
      return;
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎯 EXECUTING TRADING SIGNALS (${signals.length})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Sort by confidence
    signals.sort((a, b) => {
      const order = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return order[b.confidence] - order[a.confidence];
    });

    for (const signal of signals) {
      this.tradingStrategy.logSignal(signal);

      // Check if we can trade
      const balanceData = await getBalance(this.client);
      const balance = parseFloat(balanceData.usdc);
      const canTrade = this.riskManager.canTrade(signal.suggestedAmount, balance);

      if (!canTrade.allowed) {
        console.log(`⚠️  Cannot trade: ${canTrade.reason}\n`);
        continue;
      }

      // Execute trade (only if auto-trade enabled)
      if (this.config.autoTrade) {
        console.log(`\n💰 EXECUTING TRADE...`);
        try {
          // TODO: Implement actual trade execution
          console.log(`⚠️  Trade execution not yet implemented`);
          console.log(`📝 Would trade: ${signal.action} $${signal.suggestedAmount.toFixed(2)}`);
        } catch (error) {
          console.error(`❌ Trade failed:`, error);
        }
      } else {
        console.log(`\n🔔 DRY RUN - No actual trade executed`);
      }

      console.log('');
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args.includes('--sport') ? 'SPORT' : 'NORMAL';
  const autoTrade = args.includes('--auto');

  const bot = new TradingBotOrchestrator(mode, autoTrade);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n\n🛑 Received SIGINT, shutting down gracefully...`);
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`\n\n🛑 Received SIGTERM, shutting down gracefully...`);
    bot.stop();
    process.exit(0);
  });

  // Start bot
  bot.start().catch((error: any) => {
    console.error(`💥 Fatal error:`, error);
    process.exit(1);
  });
}

export { TradingBotOrchestrator };
