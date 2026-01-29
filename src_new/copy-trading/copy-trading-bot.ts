/**
 * COPY TRADING BOT
 *
 * Target wallet'i takip edip her BUY islemini $1 sabit miktarla kopyalar.
 * ROI tracking: Market sonuclarini takip eder ve kar/zarar hesaplar.
 *
 * Usage:
 *   npm run copy:dry   - Dry run mode (trade yapmaz)
 *   npm run copy:live  - Live mode (gercek trade)
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import {
  PolymarketTrade,
  CopyTradingConfig,
  CopiedTradeRecord,
  CopyTradingStats,
  OrderResult
} from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG: CopyTradingConfig = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd',
  pollIntervalMs: 300,           // 300ms = ~3 req/s
  fixedAmount: 1,                // $1 sabit
  copyBuysOnly: true,
  dryRun: !process.argv.includes('--live'),
  enableTelegram: true,
  maxRetries: 1,
  dataApiUrl: 'https://data-api.polymarket.com',
  persistPath: path.join(__dirname, '../../data/copied-trades.json')
};

// ROI check interval (every 30 seconds)
const ROI_CHECK_INTERVAL_MS = 30000;

// ============================================================================
// COPY TRADE TRACKER (with ROI tracking)
// ============================================================================

class CopyTradeTracker {
  private copiedHashes: Set<string> = new Set();
  private records: CopiedTradeRecord[] = [];
  private persistPath: string;
  private persistInterval: NodeJS.Timeout | null = null;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
    this.load();
    this.startPersistInterval();
  }

  /**
   * Load from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
        this.records = data.records || [];
        this.copiedHashes = new Set(this.records.map(r => r.transactionHash));
        console.log(`   Loaded ${this.copiedHashes.size} previously copied trades`);

        // Show unresolved count
        const unresolved = this.records.filter(r => r.status === 'success' && !r.resolved);
        if (unresolved.length > 0) {
          console.log(`   ${unresolved.length} trades pending resolution`);
        }
      }
    } catch (error) {
      console.warn('   Could not load copied trades:', error);
    }
  }

  /**
   * Persist to disk every 30 seconds
   */
  private startPersistInterval(): void {
    this.persistInterval = setInterval(() => {
      this.persist();
    }, 30000);
  }

  /**
   * Save to disk
   */
  persist(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Calculate ROI summary
      const resolved = this.records.filter(r => r.resolved);
      const won = resolved.filter(r => r.won);
      const totalSpent = resolved.reduce((sum, r) => sum + (r.amount || 0), 0);
      const totalPayout = resolved.reduce((sum, r) => sum + (r.payout || 0), 0);

      fs.writeFileSync(this.persistPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        totalCopied: this.copiedHashes.size,
        summary: {
          resolved: resolved.length,
          won: won.length,
          lost: resolved.length - won.length,
          winRate: resolved.length > 0 ? ((won.length / resolved.length) * 100).toFixed(1) + '%' : 'N/A',
          totalSpent: totalSpent.toFixed(2),
          totalPayout: totalPayout.toFixed(2),
          profit: (totalPayout - totalSpent).toFixed(2),
          roi: totalSpent > 0 ? (((totalPayout - totalSpent) / totalSpent) * 100).toFixed(1) + '%' : 'N/A'
        },
        records: this.records.slice(-1000) // Keep last 1000
      }, null, 2));
    } catch (error) {
      console.error('   Persist error:', error);
    }
  }

  /**
   * Check if trade was already copied
   */
  isCopied(hash: string): boolean {
    return this.copiedHashes.has(hash);
  }

  /**
   * Mark trade as copied with full details for ROI tracking
   */
  markCopied(
    trade: PolymarketTrade,
    orderId?: string,
    status: 'success' | 'failed' | 'skipped' = 'success',
    error?: string,
    amount?: number
  ): void {
    this.copiedHashes.add(trade.transactionHash);
    this.records.push({
      transactionHash: trade.transactionHash,
      copiedAt: new Date().toISOString(),
      orderId,
      status,
      error,
      // ROI tracking fields
      tokenId: trade.asset,
      marketSlug: trade.slug,
      marketTitle: trade.title,
      outcome: trade.outcome,
      buyPrice: parseFloat(trade.price),
      amount: status === 'success' ? amount : 0,
      resolved: false,
      won: undefined,
      payout: undefined,
      profit: undefined
    });
  }

  /**
   * Get unresolved trades for ROI checking
   */
  getUnresolvedTrades(): CopiedTradeRecord[] {
    return this.records.filter(r => r.status === 'success' && !r.resolved);
  }

  /**
   * Mark trade as resolved
   */
  markResolved(transactionHash: string, won: boolean, payout: number): void {
    const record = this.records.find(r => r.transactionHash === transactionHash);
    if (record) {
      record.resolved = true;
      record.won = won;
      record.payout = payout;
      record.profit = payout - (record.amount || 0);
    }
  }

  /**
   * Get ROI summary
   */
  getROISummary(): {
    resolved: number;
    won: number;
    lost: number;
    pending: number;
    totalSpent: number;
    totalPayout: number;
    profit: number;
    winRate: string;
    roi: string;
  } {
    const resolved = this.records.filter(r => r.resolved);
    const pending = this.records.filter(r => r.status === 'success' && !r.resolved);
    const won = resolved.filter(r => r.won);
    const totalSpent = resolved.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalPayout = resolved.reduce((sum, r) => sum + (r.payout || 0), 0);

    return {
      resolved: resolved.length,
      won: won.length,
      lost: resolved.length - won.length,
      pending: pending.length,
      totalSpent,
      totalPayout,
      profit: totalPayout - totalSpent,
      winRate: resolved.length > 0 ? ((won.length / resolved.length) * 100).toFixed(1) + '%' : 'N/A',
      roi: totalSpent > 0 ? (((totalPayout - totalSpent) / totalSpent) * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  /**
   * Stop persist interval
   */
  stop(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persist();
    }
  }
}

// ============================================================================
// TELEGRAM SIMPLE NOTIFIER
// ============================================================================

class SimpleTelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!(this.botToken && this.chatId);

    if (!this.enabled) {
      console.log('   Telegram disabled (missing credentials)');
    }
  }

  /**
   * Fire-and-forget notification
   */
  async notify(message: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      // Fire and forget - don't block
    }
  }
}

// ============================================================================
// MARKET RESOLVER - Check if markets have settled
// ============================================================================

class MarketResolver {
  private dataApiUrl: string;

  constructor(dataApiUrl: string) {
    this.dataApiUrl = dataApiUrl;
  }

  /**
   * Check if a market has resolved and what the winning outcome was
   * Returns: { resolved: boolean, winningOutcome?: string }
   */
  async checkMarketResolution(slug: string): Promise<{ resolved: boolean; winningOutcome?: string }> {
    try {
      // Fetch market data
      const url = `${this.dataApiUrl}/markets?slug=${slug}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (!response.data || response.data.length === 0) {
        return { resolved: false };
      }

      const market = response.data[0];

      // Check if market is closed/resolved
      // Markets typically have "closed" or "resolved" status when done
      if (market.closed || market.resolved) {
        // Find winning outcome (price = 1 means winner)
        if (market.outcomes) {
          for (const outcome of market.outcomes) {
            if (parseFloat(outcome.price) >= 0.99) {
              return { resolved: true, winningOutcome: outcome.name };
            }
          }
        }

        // Alternative: check tokens
        if (market.tokens) {
          for (const token of market.tokens) {
            if (parseFloat(token.price) >= 0.99) {
              return { resolved: true, winningOutcome: token.outcome };
            }
          }
        }

        return { resolved: true, winningOutcome: undefined };
      }

      return { resolved: false };
    } catch (error) {
      // Don't spam errors, just return unresolved
      return { resolved: false };
    }
  }

  /**
   * Check resolution for a specific token
   * For 15-min Up/Down markets, we can also check token price
   */
  async checkTokenPrice(tokenId: string): Promise<{ price: number; resolved: boolean }> {
    try {
      const url = `${this.dataApiUrl}/prices?tokenIds=${tokenId}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data && response.data[tokenId]) {
        const price = parseFloat(response.data[tokenId]);
        // Price of 1.0 or 0.0 means resolved
        const resolved = price >= 0.99 || price <= 0.01;
        return { price, resolved };
      }

      return { price: 0, resolved: false };
    } catch (error) {
      return { price: 0, resolved: false };
    }
  }
}

// ============================================================================
// COPY TRADING BOT
// ============================================================================

class CopyTradingBot {
  private config: CopyTradingConfig;
  private client: ClobClient | null = null;
  private tracker: CopyTradeTracker;
  private telegram: SimpleTelegramNotifier;
  private resolver: MarketResolver;
  private stats: CopyTradingStats;
  private pollTimer: NodeJS.Timeout | null = null;
  private roiCheckTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastSeenHashes: Set<string> = new Set();

  constructor(config: CopyTradingConfig) {
    this.config = config;
    this.tracker = new CopyTradeTracker(config.persistPath);
    this.telegram = new SimpleTelegramNotifier();
    this.resolver = new MarketResolver(config.dataApiUrl);
    this.stats = {
      startedAt: new Date(),
      tradesDetected: 0,
      tradesCopied: 0,
      tradesFailed: 0,
      tradesSkipped: 0,
      totalSpent: 0,
      // ROI tracking
      tradesResolved: 0,
      tradesWon: 0,
      tradesLost: 0,
      totalPayout: 0,
      totalProfit: 0
    };
  }

  /**
   * Initialize and start the bot
   */
  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   COPY TRADING BOT (with ROI Tracking)');
    console.log('='.repeat(60));
    console.log(`   Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`   Target: ${this.config.targetWallet}`);
    console.log(`   Poll interval: ${this.config.pollIntervalMs}ms`);
    console.log(`   Fixed amount: $${this.config.fixedAmount}`);
    console.log(`   ROI check interval: ${ROI_CHECK_INTERVAL_MS / 1000}s`);
    console.log('='.repeat(60) + '\n');

    // Initialize Polymarket client
    if (!this.config.dryRun) {
      console.log('Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
    } else {
      console.log('DRY RUN - Polymarket client not initialized\n');
    }

    // Initial fetch to populate lastSeenHashes
    await this.initializeLastSeen();

    // Start polling for new trades
    this.isRunning = true;
    this.poll();

    // Start ROI checking
    this.startROIChecker();

    // Startup notification
    await this.telegram.notify(
      `*Copy Trading Bot Started*\n\n` +
      `Target: \`${this.config.targetWallet.slice(0, 10)}...\`\n` +
      `Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}\n` +
      `Amount: $${this.config.fixedAmount}\n` +
      `ROI Tracking: Enabled`
    );

    console.log('Bot started! Watching for trades...\n');
  }

  /**
   * Initialize with current trades to avoid copying old ones
   */
  private async initializeLastSeen(): Promise<void> {
    try {
      const trades = await this.fetchTrades();
      trades.forEach(t => this.lastSeenHashes.add(t.transactionHash));
      console.log(`   Initialized with ${this.lastSeenHashes.size} existing trades\n`);
    } catch (error) {
      console.error('   Failed to initialize last seen trades:', error);
    }
  }

  /**
   * Start periodic ROI checking
   */
  private startROIChecker(): void {
    this.roiCheckTimer = setInterval(() => {
      this.checkROI();
    }, ROI_CHECK_INTERVAL_MS);

    // Initial check after 10 seconds
    setTimeout(() => this.checkROI(), 10000);
  }

  /**
   * Check resolution status of pending trades
   */
  private async checkROI(): Promise<void> {
    const unresolved = this.tracker.getUnresolvedTrades();
    if (unresolved.length === 0) return;

    let newResolutions = 0;

    for (const trade of unresolved) {
      if (!trade.tokenId) continue;

      // Check token price
      const { price, resolved } = await this.resolver.checkTokenPrice(trade.tokenId);

      if (resolved) {
        const won = price >= 0.99;
        // Calculate shares: amount / buyPrice
        const shares = (trade.amount || 0) / (trade.buyPrice || 0.5);
        const payout = won ? shares : 0;

        this.tracker.markResolved(trade.transactionHash, won, payout);

        // Update stats
        this.stats.tradesResolved++;
        if (won) {
          this.stats.tradesWon++;
        } else {
          this.stats.tradesLost++;
        }
        this.stats.totalPayout += payout;
        this.stats.totalProfit = this.stats.totalPayout - this.stats.totalSpent;

        newResolutions++;

        const profitLoss = payout - (trade.amount || 0);
        console.log(`\n   [ROI] ${trade.marketTitle}`);
        console.log(`         Outcome: ${trade.outcome} - ${won ? 'WON!' : 'LOST'}`);
        console.log(`         Bought at: ${trade.buyPrice?.toFixed(2)} | Payout: $${payout.toFixed(2)}`);
        console.log(`         P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}\n`);

        // Telegram notification for resolution
        this.telegram.notify(
          `*Trade Resolved ${won ? '✅' : '❌'}*\n\n` +
          `Market: ${trade.marketTitle}\n` +
          `Outcome: ${trade.outcome}\n` +
          `Result: ${won ? 'WON' : 'LOST'}\n` +
          `P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}`
        );
      }

      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Print summary if new resolutions
    if (newResolutions > 0) {
      this.printROISummary();
    }
  }

  /**
   * Print current ROI summary
   */
  private printROISummary(): void {
    const summary = this.tracker.getROISummary();

    console.log('\n' + '-'.repeat(50));
    console.log('   ROI SUMMARY');
    console.log('-'.repeat(50));
    console.log(`   Resolved: ${summary.resolved} | Pending: ${summary.pending}`);
    console.log(`   Won: ${summary.won} | Lost: ${summary.lost}`);
    console.log(`   Win Rate: ${summary.winRate}`);
    console.log(`   Total Spent: $${summary.totalSpent.toFixed(2)}`);
    console.log(`   Total Payout: $${summary.totalPayout.toFixed(2)}`);
    console.log(`   Profit: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}`);
    console.log(`   ROI: ${summary.roi}`);
    console.log('-'.repeat(50) + '\n');
  }

  /**
   * Fetch recent trades from target wallet
   */
  private async fetchTrades(): Promise<PolymarketTrade[]> {
    const url = `${this.config.dataApiUrl}/trades?user=${this.config.targetWallet}&limit=20`;

    try {
      const response = await axios.get(url, { timeout: 5000 });
      return response.data || [];
    } catch (error) {
      console.error('   Fetch error:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Main polling loop
   */
  private poll(): void {
    if (!this.isRunning) return;

    this.pollOnce().finally(() => {
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
      }
    });
  }

  /**
   * Single poll iteration
   */
  private async pollOnce(): Promise<void> {
    this.stats.lastPollAt = new Date();

    const trades = await this.fetchTrades();
    if (trades.length === 0) return;

    // Find new trades
    const newTrades = trades.filter(t =>
      !this.lastSeenHashes.has(t.transactionHash) &&
      !this.tracker.isCopied(t.transactionHash)
    );

    // Update last seen
    trades.forEach(t => this.lastSeenHashes.add(t.transactionHash));

    if (newTrades.length === 0) return;

    // Filter BUY only
    const buyTrades = this.config.copyBuysOnly
      ? newTrades.filter(t => t.side === 'BUY')
      : newTrades;

    if (buyTrades.length === 0) return;

    const timestamp = new Date().toLocaleTimeString('tr-TR');
    console.log(`[${timestamp}] Detected ${buyTrades.length} new BUY trade(s)\n`);

    // Copy each trade
    for (const trade of buyTrades) {
      await this.copyTrade(trade);
    }
  }

  /**
   * Copy a single trade
   */
  private async copyTrade(trade: PolymarketTrade): Promise<void> {
    this.stats.tradesDetected++;

    console.log('>>> NEW TRADE DETECTED <<<');
    console.log(`   Title: ${trade.title}`);
    console.log(`   Outcome: ${trade.outcome}`);
    console.log(`   Side: ${trade.side}`);
    console.log(`   Size: ${parseFloat(trade.size).toFixed(2)}`);
    console.log(`   Price: ${trade.price}`);
    // API returns Unix timestamp in seconds, JS needs milliseconds
    const tradeTime = new Date(parseInt(trade.timestamp as any) * 1000);
    console.log(`   Time: ${tradeTime.toLocaleTimeString('tr-TR')}`);
    console.log('');

    // Execute copy
    const result = await this.executeCopy(trade);

    if (result.success) {
      this.stats.tradesCopied++;
      this.stats.totalSpent += this.config.fixedAmount;
      this.tracker.markCopied(trade, result.orderId, 'success', undefined, this.config.fixedAmount);

      console.log(`   Copying: ${trade.title} - ${trade.outcome}`);
      console.log(`   Token: ${trade.asset.slice(0, 10)}...`);
      console.log(`   Our amount: $${this.config.fixedAmount}`);
      console.log(`   Buy price: ${trade.price} (potential payout: $${(this.config.fixedAmount / parseFloat(trade.price)).toFixed(2)})`);
      console.log(`   SUCCESS! Order ID: ${result.orderId?.slice(0, 10)}... (${result.executionTimeMs}ms)`);

      // Telegram notification (fire-and-forget)
      this.telegram.notify(
        `*Trade Copied!*\n\n` +
        `Market: ${trade.title}\n` +
        `Outcome: ${trade.outcome}\n` +
        `Amount: $${this.config.fixedAmount}\n` +
        `Price: ${trade.price}\n` +
        `Potential payout: $${(this.config.fixedAmount / parseFloat(trade.price)).toFixed(2)}\n` +
        `Order: \`${result.orderId?.slice(0, 12)}...\``
      );
    } else {
      this.stats.tradesFailed++;
      this.tracker.markCopied(trade, undefined, 'failed', result.error, 0);

      console.log(`   FAILED: ${result.error}`);

      this.telegram.notify(
        `*Copy Failed!*\n\n` +
        `Market: ${trade.title}\n` +
        `Error: ${result.error}`
      );
    }

    console.log('');
    this.stats.lastTradeAt = new Date();
  }

  /**
   * Execute the copy order
   */
  private async executeCopy(trade: PolymarketTrade): Promise<OrderResult> {
    const startTime = Date.now();

    if (this.config.dryRun) {
      // Simulate execution
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        success: true,
        orderId: `dry-run-${Date.now().toString(16)}`,
        executionTimeMs: Date.now() - startTime
      };
    }

    if (!this.client) {
      return {
        success: false,
        error: 'Client not initialized',
        executionTimeMs: Date.now() - startTime
      };
    }

    try {
      // Create market order
      const orderObj = await this.client.createMarketOrder({
        tokenID: trade.asset,
        amount: this.config.fixedAmount,
        side: Side.BUY
      });

      // Post order with Fill-or-Kill
      const response = await this.client.postOrder(orderObj, OrderType.FOK);

      return {
        success: true,
        orderId: response.orderID || response.id || 'unknown',
        executionTimeMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Get current stats
   */
  getStats(): CopyTradingStats {
    return { ...this.stats };
  }

  /**
   * Stop the bot
   */
  stop(): void {
    console.log('\nStopping bot...');
    this.isRunning = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    if (this.roiCheckTimer) {
      clearInterval(this.roiCheckTimer);
    }

    // Final ROI check
    this.checkROI().finally(() => {
      this.tracker.stop();
      this.printFinalStats();
    });
  }

  /**
   * Print final statistics
   */
  private printFinalStats(): void {
    const summary = this.tracker.getROISummary();

    console.log('\n' + '='.repeat(60));
    console.log('   FINAL STATS');
    console.log('='.repeat(60));
    console.log(`   Runtime: ${Math.round((Date.now() - this.stats.startedAt.getTime()) / 1000 / 60)} minutes`);
    console.log(`   Trades detected: ${this.stats.tradesDetected}`);
    console.log(`   Trades copied: ${this.stats.tradesCopied}`);
    console.log(`   Trades failed: ${this.stats.tradesFailed}`);
    console.log(`   Total spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log('');
    console.log('   --- ROI ---');
    console.log(`   Resolved: ${summary.resolved} | Pending: ${summary.pending}`);
    console.log(`   Won: ${summary.won} | Lost: ${summary.lost}`);
    console.log(`   Win Rate: ${summary.winRate}`);
    console.log(`   Total Payout: $${summary.totalPayout.toFixed(2)}`);
    console.log(`   Profit/Loss: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}`);
    console.log(`   ROI: ${summary.roi}`);
    console.log('='.repeat(60) + '\n');

    this.telegram.notify(
      `*Copy Trading Bot Stopped*\n\n` +
      `Trades copied: ${this.stats.tradesCopied}\n` +
      `Trades failed: ${this.stats.tradesFailed}\n` +
      `Total spent: $${this.stats.totalSpent.toFixed(2)}\n\n` +
      `*ROI Summary*\n` +
      `Resolved: ${summary.resolved} | Pending: ${summary.pending}\n` +
      `Won: ${summary.won} | Lost: ${summary.lost}\n` +
      `Win Rate: ${summary.winRate}\n` +
      `P/L: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}\n` +
      `ROI: ${summary.roi}`
    );
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const bot = new CopyTradingBot(CONFIG);

  // Graceful shutdown
  process.on('SIGINT', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 2000); // Wait for final save
  });

  process.on('SIGTERM', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 2000);
  });

  try {
    await bot.start();
  } catch (error) {
    console.error('Fatal error:', error);
    bot.stop();
    process.exit(1);
  }
}

main();
