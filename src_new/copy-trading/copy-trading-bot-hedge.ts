/**
 * COPY TRADING BOT - Hedge-Aware Version
 *
 * Target wallet'in hedge/arbitrage stratejisini kopyalar.
 * Aynı markette hem Up hem Down alıyorsa ikisini de kopyalar.
 *
 * Usage:
 *   npm run copy:hedge:dry   - Dry run mode
 *   npm run copy:hedge:live  - Live mode
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import WebSocket from 'ws';
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

const parseAmount = (): number => {
  const amountArg = process.argv.find(arg => arg.startsWith('--amount='));
  if (amountArg) {
    const val = parseFloat(amountArg.split('=')[1]);
    if (!isNaN(val) && val >= 1) return val;
  }
  return 5; // Default $5 for hedge strategy (need more for both sides)
};

const CONFIG: CopyTradingConfig = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase(),
  pollIntervalMs: 300,
  fixedAmount: parseAmount(),
  copyBuysOnly: true,  // Only copy BUY trades (hedge requires buying both sides)
  dryRun: !process.argv.includes('--live'),
  enableTelegram: true,
  maxRetries: 1,
  dataApiUrl: 'https://data-api.polymarket.com',
  persistPath: path.join(__dirname, '../../data/copied-trades-hedge.json')
};

// Buffer time to detect hedges (ms)
const HEDGE_BUFFER_MS = 5000;

// RTDS WebSocket endpoint
const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 3000;

// ============================================================================
// TYPES
// ============================================================================

interface RTDSMessage {
  topic: string;
  type: string;
  timestamp: number;
  connection_id: string;
  payload: RTDSTradePayload | any;
}

interface RTDSTradePayload {
  id?: string;
  asset?: string;
  conditionId?: string;
  side?: string;
  size?: string;
  price?: string;
  timestamp?: number;
  title?: string;
  slug?: string;
  outcome?: string;
  proxyWallet?: string;
  name?: string;
  transactionHash?: string;
  eventSlug?: string;
}

interface BufferedTrade {
  trade: PolymarketTrade;
  receivedAt: number;
  marketKey: string; // slug + title combo for grouping
}

interface HedgeGroup {
  marketKey: string;
  title: string;
  slug: string;
  trades: PolymarketTrade[];
  outcomes: Set<string>;
  totalUp: number;    // Total $ on Up
  totalDown: number;  // Total $ on Down
  avgPriceUp: number;
  avgPriceDown: number;
}

// ============================================================================
// TRADE TRACKER
// ============================================================================

class TradeTracker {
  private copiedHashes: Set<string> = new Set();
  private records: CopiedTradeRecord[] = [];
  private persistPath: string;
  private persistInterval: NodeJS.Timeout | null = null;

  constructor(persistPath: string) {
    this.persistPath = persistPath;
    this.load();
    this.startPersistInterval();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
        this.records = data.records || [];
        this.copiedHashes = new Set(this.records.map(r => r.transactionHash));
        console.log(`   📂 Loaded ${this.copiedHashes.size} previously copied trades`);
      }
    } catch (error) {
      console.warn('   ⚠️ Could not load copied trades:', error);
    }
  }

  private startPersistInterval(): void {
    this.persistInterval = setInterval(() => this.persist(), 30000);
  }

  persist(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const resolved = this.records.filter(r => r.resolved);
      const won = resolved.filter(r => r.won);
      const totalSpent = this.records.filter(r => r.status === 'success').reduce((sum, r) => sum + (r.amount || 0), 0);
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
        records: this.records.slice(-1000)
      }, null, 2));
    } catch (error) {
      console.error('   ❌ Persist error:', error);
    }
  }

  isCopied(hash: string): boolean {
    return this.copiedHashes.has(hash);
  }

  markCopied(
    trade: PolymarketTrade,
    orderId?: string,
    status: 'success' | 'failed' | 'skipped' = 'success',
    error?: string,
    amount?: number,
    isHedge?: boolean
  ): void {
    this.copiedHashes.add(trade.transactionHash);
    this.records.push({
      transactionHash: trade.transactionHash,
      copiedAt: new Date().toISOString(),
      orderId,
      status,
      error,
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

  getROISummary() {
    const resolved = this.records.filter(r => r.resolved);
    const pending = this.records.filter(r => r.status === 'success' && !r.resolved);
    const won = resolved.filter(r => r.won);
    const totalSpent = this.records.filter(r => r.status === 'success').reduce((sum, r) => sum + (r.amount || 0), 0);
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

  getAllRecords(): CopiedTradeRecord[] {
    return [...this.records];
  }

  stop(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persist();
    }
  }
}

// ============================================================================
// TELEGRAM NOTIFIER
// ============================================================================

class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!(this.botToken && this.chatId);

    if (!this.enabled) {
      console.log('   📵 Telegram disabled (missing credentials)');
    }
  }

  async notify(message: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      // Fire and forget
    }
  }
}

// ============================================================================
// RTDS WEBSOCKET CLIENT
// ============================================================================

class RTDSClient {
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private shouldReconnect: boolean = true;
  private onTradeCallback: ((trade: RTDSTradePayload) => void) | null = null;

  onTrade(callback: (trade: RTDSTradePayload) => void): void {
    this.onTradeCallback = callback;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    console.log('   🔌 Connecting to RTDS WebSocket...');
    this.ws = new WebSocket(RTDS_WS_URL);

    this.ws.on('open', () => {
      console.log('   ✅ RTDS WebSocket connected!');
      this.isConnected = true;
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as RTDSMessage;
        this.handleMessage(message);
      } catch (error) {}
    });

    this.ws.on('close', () => {
      console.log('   ⚠️ RTDS WebSocket disconnected');
      this.isConnected = false;
      this.stopPing();

      if (this.shouldReconnect) {
        console.log(`   🔄 Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        this.reconnectTimeout = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });

    this.ws.on('error', (error) => {
      console.error('   ❌ RTDS WebSocket error:', error.message);
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMsg = {
      action: 'subscribe',
      subscriptions: [{ topic: 'activity', type: 'trades' }]
    };

    this.ws.send(JSON.stringify(subscribeMsg));
    console.log('   📡 Subscribed to activity:trades channel');
  }

  private handleMessage(message: RTDSMessage): void {
    if (message.topic === 'activity' && message.type === 'trades') {
      const payload = message.payload as RTDSTradePayload;
      if (this.onTradeCallback && payload) {
        this.onTradeCallback(payload);
      }
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

// ============================================================================
// HEDGE-AWARE COPY TRADING BOT
// ============================================================================

class HedgeCopyBot {
  private config: CopyTradingConfig;
  private client: ClobClient | null = null;
  private tracker: TradeTracker;
  private telegram: TelegramNotifier;
  private rtds: RTDSClient;
  private stats: CopyTradingStats;

  // Trade buffering for hedge detection
  private tradeBuffer: BufferedTrade[] = [];
  private bufferTimer: NodeJS.Timeout | null = null;

  // Token ID cache: outcome -> tokenId
  private tokenCache: Map<string, { upToken: string; downToken: string }> = new Map();

  constructor(config: CopyTradingConfig) {
    this.config = config;
    this.tracker = new TradeTracker(config.persistPath);
    this.telegram = new TelegramNotifier();
    this.rtds = new RTDSClient();
    this.stats = {
      startedAt: new Date(),
      tradesDetected: 0,
      tradesCopied: 0,
      tradesFailed: 0,
      tradesSkipped: 0,
      totalSpent: 0,
      tradesResolved: 0,
      tradesWon: 0,
      tradesLost: 0,
      totalPayout: 0,
      totalProfit: 0
    };
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   HEDGE-AWARE COPY TRADING BOT');
    console.log('='.repeat(60));
    console.log(`   Mode: ${this.config.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Target: ${this.config.targetWallet}`);
    console.log(`   Budget per hedge: $${this.config.fixedAmount}`);
    console.log(`   Hedge buffer: ${HEDGE_BUFFER_MS}ms`);
    console.log(`   Strategy: Detect & copy hedge positions`);
    console.log('='.repeat(60) + '\n');

    if (!this.config.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
    } else {
      console.log('🧪 DRY RUN - Client not initialized\n');
    }

    this.rtds.onTrade((trade) => this.handleIncomingTrade(trade));
    this.rtds.connect();

    await this.telegram.notify(
      `*Hedge Copy Bot Started*\n\n` +
      `Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}\n` +
      `Budget: $${this.config.fixedAmount}/hedge\n` +
      `Buffer: ${HEDGE_BUFFER_MS}ms`
    );

    console.log('🚀 Bot started! Listening for hedge opportunities...\n');
  }

  /**
   * Handle incoming trade - buffer it for hedge detection
   */
  private handleIncomingTrade(trade: RTDSTradePayload): void {
    const tradeWallet = (trade.proxyWallet || '').toLowerCase();
    if (tradeWallet !== this.config.targetWallet) return;
    if (trade.side !== 'BUY') return;
    if (!trade.transactionHash || this.tracker.isCopied(trade.transactionHash)) return;

    const polyTrade: PolymarketTrade = {
      transactionHash: trade.transactionHash,
      side: 'BUY',
      asset: trade.asset || '',
      size: trade.size || '0',
      price: trade.price || '0',
      timestamp: String(trade.timestamp || Date.now()),
      title: trade.title || '',
      slug: trade.slug || '',
      outcome: trade.outcome || ''
    };

    // Create market key from slug (unique per market)
    const marketKey = trade.slug || trade.title || '';

    const buffered: BufferedTrade = {
      trade: polyTrade,
      receivedAt: Date.now(),
      marketKey
    };

    this.tradeBuffer.push(buffered);
    this.stats.tradesDetected++;

    const now = new Date().toLocaleTimeString('tr-TR');
    console.log(`[${now}] 📥 Buffered: ${trade.outcome} @ ${trade.price} (${trade.title?.slice(0, 40)}...)`);

    // Cache token ID for this outcome
    if (trade.slug && trade.asset && trade.outcome) {
      const cached = this.tokenCache.get(trade.slug) || { upToken: '', downToken: '' };
      if (trade.outcome === 'Up') {
        cached.upToken = trade.asset;
      } else if (trade.outcome === 'Down') {
        cached.downToken = trade.asset;
      }
      this.tokenCache.set(trade.slug, cached);
    }

    // Reset or start buffer timer
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.processBuffer(), HEDGE_BUFFER_MS);
  }

  /**
   * Process buffered trades - detect hedges
   */
  private async processBuffer(): Promise<void> {
    if (this.tradeBuffer.length === 0) return;

    const now = Date.now();
    const trades = [...this.tradeBuffer];
    this.tradeBuffer = [];

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`⚡ Processing ${trades.length} buffered trades...`);

    // Group by market
    const groups: Map<string, HedgeGroup> = new Map();

    for (const bt of trades) {
      const key = bt.marketKey;
      if (!groups.has(key)) {
        groups.set(key, {
          marketKey: key,
          title: bt.trade.title,
          slug: bt.trade.slug,
          trades: [],
          outcomes: new Set(),
          totalUp: 0,
          totalDown: 0,
          avgPriceUp: 0,
          avgPriceDown: 0
        });
      }

      const group = groups.get(key)!;
      group.trades.push(bt.trade);
      group.outcomes.add(bt.trade.outcome);

      const amount = parseFloat(bt.trade.size) * parseFloat(bt.trade.price);
      if (bt.trade.outcome === 'Up') {
        group.totalUp += amount;
        group.avgPriceUp = parseFloat(bt.trade.price); // Simplified - last price
      } else if (bt.trade.outcome === 'Down') {
        group.totalDown += amount;
        group.avgPriceDown = parseFloat(bt.trade.price);
      }
    }

    // Process each group
    for (const [key, group] of groups) {
      const isHedge = group.outcomes.has('Up') && group.outcomes.has('Down');

      console.log(`\n📊 Market: ${group.title}`);
      console.log(`   Trades: ${group.trades.length} | Outcomes: ${Array.from(group.outcomes).join(', ')}`);

      if (isHedge) {
        console.log(`   🛡️ HEDGE DETECTED!`);
        console.log(`   Up: $${group.totalUp.toFixed(2)} @ ${group.avgPriceUp}`);
        console.log(`   Down: $${group.totalDown.toFixed(2)} @ ${group.avgPriceDown}`);

        const combinedPrice = group.avgPriceUp + group.avgPriceDown;
        const margin = ((1 - combinedPrice) * 100).toFixed(2);
        console.log(`   Combined price: ${combinedPrice.toFixed(3)} (${margin}% margin)`);

        await this.executeHedge(group);
      } else {
        // Single-side trade - copy normally
        console.log(`   📈 Single-side trade`);
        for (const trade of group.trades) {
          await this.executeSingleTrade(trade);
        }
      }
    }

    console.log(`${'─'.repeat(60)}\n`);
  }

  /**
   * Execute hedge - buy both sides proportionally
   */
  private async executeHedge(group: HedgeGroup): Promise<void> {
    const budget = this.config.fixedAmount;

    // Calculate proportions based on target's spending
    const totalTarget = group.totalUp + group.totalDown;
    const upRatio = group.totalUp / totalTarget;
    const downRatio = group.totalDown / totalTarget;

    const upAmount = budget * upRatio;
    const downAmount = budget * downRatio;

    console.log(`\n   💰 Our hedge allocation:`);
    console.log(`      Up: $${upAmount.toFixed(2)} (${(upRatio * 100).toFixed(1)}%)`);
    console.log(`      Down: $${downAmount.toFixed(2)} (${(downRatio * 100).toFixed(1)}%)`);

    // Get token IDs
    const tokens = this.tokenCache.get(group.slug);
    if (!tokens || !tokens.upToken || !tokens.downToken) {
      console.log(`   ⚠️ Missing token IDs, fetching...`);
      await this.fetchTokenIds(group.slug);
    }

    const cachedTokens = this.tokenCache.get(group.slug);

    // Execute both sides
    const upTrade = group.trades.find(t => t.outcome === 'Up');
    const downTrade = group.trades.find(t => t.outcome === 'Down');

    if (upTrade && cachedTokens?.upToken) {
      const result = await this.executeOrder(cachedTokens.upToken, upAmount, group.avgPriceUp);
      if (result.success) {
        this.stats.tradesCopied++;
        this.stats.totalSpent += upAmount;
        this.tracker.markCopied(upTrade, result.orderId, 'success', undefined, upAmount, true);
        console.log(`   ✅ Up: Order ${result.orderId?.slice(0, 12)}...`);
      } else {
        this.stats.tradesFailed++;
        this.tracker.markCopied(upTrade, undefined, 'failed', result.error, 0, true);
        console.log(`   ❌ Up failed: ${result.error}`);
      }
    }

    if (downTrade && cachedTokens?.downToken) {
      const result = await this.executeOrder(cachedTokens.downToken, downAmount, group.avgPriceDown);
      if (result.success) {
        this.stats.tradesCopied++;
        this.stats.totalSpent += downAmount;
        this.tracker.markCopied(downTrade, result.orderId, 'success', undefined, downAmount, true);
        console.log(`   ✅ Down: Order ${result.orderId?.slice(0, 12)}...`);
      } else {
        this.stats.tradesFailed++;
        this.tracker.markCopied(downTrade, undefined, 'failed', result.error, 0, true);
        console.log(`   ❌ Down failed: ${result.error}`);
      }
    }

    // Mark remaining trades as processed
    for (const trade of group.trades) {
      if (!this.tracker.isCopied(trade.transactionHash)) {
        this.tracker.markCopied(trade, undefined, 'skipped', 'Part of hedge group', 0, true);
      }
    }

    await this.telegram.notify(
      `🛡️ *Hedge Copied!*\n\n` +
      `Market: ${group.title}\n` +
      `Up: $${upAmount.toFixed(2)} @ ${group.avgPriceUp}\n` +
      `Down: $${downAmount.toFixed(2)} @ ${group.avgPriceDown}\n` +
      `Total: $${budget.toFixed(2)}`
    );
  }

  /**
   * Execute single-side trade
   */
  private async executeSingleTrade(trade: PolymarketTrade): Promise<void> {
    const amount = this.config.fixedAmount;

    const result = await this.executeOrder(trade.asset, amount, parseFloat(trade.price));

    if (result.success) {
      this.stats.tradesCopied++;
      this.stats.totalSpent += amount;
      this.tracker.markCopied(trade, result.orderId, 'success', undefined, amount, false);
      console.log(`   ✅ Single trade copied: ${trade.outcome} @ ${trade.price}`);

      await this.telegram.notify(
        `📈 *Trade Copied*\n\n` +
        `${trade.title}\n` +
        `${trade.outcome} @ ${trade.price}\n` +
        `Amount: $${amount}`
      );
    } else {
      this.stats.tradesFailed++;
      this.tracker.markCopied(trade, undefined, 'failed', result.error, 0, false);
      console.log(`   ❌ Failed: ${result.error}`);
    }
  }

  /**
   * Execute order on Polymarket
   */
  private async executeOrder(tokenId: string, amount: number, price: number): Promise<OrderResult> {
    const startTime = Date.now();

    if (this.config.dryRun) {
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        success: true,
        orderId: `dry-${Date.now().toString(16)}`,
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
      const orderObj = await this.client.createMarketOrder({
        tokenID: tokenId,
        amount: amount,
        side: Side.BUY
      });

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
   * Fetch token IDs for a market
   */
  private async fetchTokenIds(slug: string): Promise<void> {
    try {
      const url = `https://gamma-api.polymarket.com/markets?slug=${slug}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data && response.data[0]) {
        const market = response.data[0];
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');

        if (tokenIds.length >= 2 && outcomes.length >= 2) {
          const cached = { upToken: '', downToken: '' };
          for (let i = 0; i < outcomes.length; i++) {
            if (outcomes[i] === 'Up') cached.upToken = tokenIds[i];
            if (outcomes[i] === 'Down') cached.downToken = tokenIds[i];
          }
          this.tokenCache.set(slug, cached);
        }
      }
    } catch (error) {
      console.error('   Failed to fetch token IDs:', error);
    }
  }

  stop(): void {
    console.log('\n🛑 Stopping bot...');

    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.rtds.disconnect();
    this.tracker.stop();
    this.printFinalStats();
  }

  private printFinalStats(): void {
    const summary = this.tracker.getROISummary();
    const runtime = Math.round((Date.now() - this.stats.startedAt.getTime()) / 1000 / 60);

    console.log('\n' + '='.repeat(60));
    console.log('   📈 FINAL STATISTICS');
    console.log('='.repeat(60));
    console.log(`   Runtime: ${runtime} minutes`);
    console.log(`   Trades detected: ${this.stats.tradesDetected}`);
    console.log(`   Trades copied: ${this.stats.tradesCopied}`);
    console.log(`   Trades failed: ${this.stats.tradesFailed}`);
    console.log(`   Total spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log('');
    console.log('   --- ROI ---');
    console.log(`   Pending: ${summary.pending}`);
    console.log(`   Profit/Loss: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}`);
    console.log(`   ROI: ${summary.roi}`);
    console.log('='.repeat(60) + '\n');

    this.telegram.notify(
      `*Hedge Bot Stopped*\n\n` +
      `Runtime: ${runtime}m\n` +
      `Copied: ${this.stats.tradesCopied}\n` +
      `Spent: $${this.stats.totalSpent.toFixed(2)}\n` +
      `ROI: ${summary.roi}`
    );
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const bot = new HedgeCopyBot(CONFIG);

  process.on('SIGINT', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 3000);
  });

  process.on('SIGTERM', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 3000);
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
