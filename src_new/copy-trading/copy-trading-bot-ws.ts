/**
 * COPY TRADING BOT - WebSocket Version
 *
 * Polymarket RTDS (Real-Time Data Service) ile anlık trade takibi.
 * Target wallet'ın her BUY işlemini $1 sabit miktarla kopyalar.
 *
 * Usage:
 *   npm run copy:ws:dry   - Dry run mode (trade yapmaz)
 *   npm run copy:ws:live  - Live mode (gerçek trade)
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

// Parse CLI amount: --amount=5 or default to 5
const parseAmount = (): number => {
  const amountArg = process.argv.find(arg => arg.startsWith('--amount='));
  if (amountArg) {
    const val = parseFloat(amountArg.split('=')[1]);
    if (!isNaN(val) && val >= 1) return val;
  }
  return 1; // Default $1
};

const CONFIG: CopyTradingConfig = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase(),
  pollIntervalMs: 300,           // Fallback polling (not primary)
  fixedAmount: parseAmount(),    // CLI: --amount=1 (default $1)
  copyBuysOnly: false,           // BUY + SELL kopyala
  dryRun: !process.argv.includes('--live'),
  enableTelegram: true,
  maxRetries: 1,
  dataApiUrl: 'https://data-api.polymarket.com',
  persistPath: path.join(__dirname, '../../data/copied-trades-ws.json')
};

// RTDS WebSocket endpoint
const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL_MS = 5000;  // Keep-alive every 5 seconds
const RECONNECT_DELAY_MS = 3000;

// ============================================================================
// RTDS MESSAGE TYPES
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
  side?: string;           // "BUY" | "SELL"
  size?: string;
  price?: string;
  timestamp?: number;
  title?: string;
  slug?: string;
  outcome?: string;
  proxyWallet?: string;    // User's wallet address!
  name?: string;           // User's pseudonym
  transactionHash?: string;
  eventSlug?: string;
}

// ============================================================================
// COPY TRADE TRACKER
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
    amount?: number
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

  getUnresolvedTrades(): CopiedTradeRecord[] {
    return this.records.filter(r => r.status === 'success' && !r.resolved);
  }

  markResolved(transactionHash: string, won: boolean, payout: number): void {
    const record = this.records.find(r => r.transactionHash === transactionHash);
    if (record) {
      record.resolved = true;
      record.won = won;
      record.payout = payout;
      record.profit = payout - (record.amount || 0);
    }
  }

  getROISummary() {
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
   * Get all records for reporting
   */
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
// MARKET RESOLVER
// ============================================================================

class MarketResolver {
  private dataApiUrl: string;

  constructor(dataApiUrl: string) {
    this.dataApiUrl = dataApiUrl;
  }

  async checkTokenPrice(tokenId: string): Promise<{ price: number; resolved: boolean }> {
    try {
      const url = `${this.dataApiUrl}/prices?tokenIds=${tokenId}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data && response.data[tokenId]) {
        const price = parseFloat(response.data[tokenId]);
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
// RTDS WEBSOCKET CLIENT
// ============================================================================

class RTDSClient {
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private shouldReconnect: boolean = true;
  private onTradeCallback: ((trade: RTDSTradePayload) => void) | null = null;

  constructor() {}

  /**
   * Set callback for trade messages
   */
  onTrade(callback: (trade: RTDSTradePayload) => void): void {
    this.onTradeCallback = callback;
  }

  /**
   * Connect to RTDS WebSocket
   */
  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    console.log('   🔌 Connecting to RTDS WebSocket...');
    this.ws = new WebSocket(RTDS_WS_URL);

    this.ws.on('open', () => {
      console.log('   ✅ RTDS WebSocket connected!');
      this.isConnected = true;

      // Subscribe to activity trades
      this.subscribe();

      // Start ping keepalive
      this.startPing();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as RTDSMessage;
        this.handleMessage(message);
      } catch (error) {
        // Ignore parse errors (ping/pong etc)
      }
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

  /**
   * Subscribe to activity trades channel
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subscribeMsg = {
      action: 'subscribe',
      subscriptions: [
        {
          topic: 'activity',
          type: 'trades'
        }
      ]
    };

    this.ws.send(JSON.stringify(subscribeMsg));
    console.log('   📡 Subscribed to activity:trades channel');
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: RTDSMessage): void {
    // Filter for trade messages on activity topic
    if (message.topic === 'activity' && message.type === 'trades') {
      const payload = message.payload as RTDSTradePayload;

      if (this.onTradeCallback && payload) {
        this.onTradeCallback(payload);
      }
    }
  }

  /**
   * Start ping keepalive
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  /**
   * Stop ping keepalive
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Check if connected
   */
  isReady(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// ============================================================================
// COPY TRADING BOT (WebSocket Version)
// ============================================================================

class CopyTradingBotWS {
  private config: CopyTradingConfig;
  private client: ClobClient | null = null;
  private tracker: CopyTradeTracker;
  private telegram: SimpleTelegramNotifier;
  private resolver: MarketResolver;
  private rtds: RTDSClient;
  private stats: CopyTradingStats;
  private roiCheckTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  // Position tracking: tokenId -> { shares, avgPrice, title, outcome }
  private positions: Map<string, { shares: number; avgPrice: number; title: string; outcome: string }> = new Map();

  constructor(config: CopyTradingConfig) {
    this.config = config;
    this.tracker = new CopyTradeTracker(config.persistPath);
    this.telegram = new SimpleTelegramNotifier();
    this.resolver = new MarketResolver(config.dataApiUrl);
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

  /**
   * Initialize and start the bot
   */
  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   COPY TRADING BOT - WebSocket Version');
    console.log('='.repeat(60));
    console.log(`   Mode: ${this.config.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Target: ${this.config.targetWallet}`);
    console.log(`   Fixed amount: $${this.config.fixedAmount}`);
    console.log(`   Copy: 🟢 BUY + 🔴 SELL`);
    console.log(`   Data source: RTDS WebSocket (real-time)`);
    console.log('='.repeat(60) + '\n');

    // Initialize Polymarket client
    if (!this.config.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
    } else {
      console.log('🧪 DRY RUN - Polymarket client not initialized\n');
    }

    // Set up RTDS trade handler
    this.rtds.onTrade((trade) => this.handleIncomingTrade(trade));

    // Connect to RTDS
    this.rtds.connect();

    // Start ROI checker
    this.startROIChecker();

    this.isRunning = true;

    // Startup notification
    await this.telegram.notify(
      `*Copy Trading Bot Started (WS)*\n\n` +
      `Target: \`${this.config.targetWallet.slice(0, 10)}...\`\n` +
      `Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}\n` +
      `Amount: $${this.config.fixedAmount}\n` +
      `Data: Real-time WebSocket`
    );

    console.log('\n🚀 Bot started! Listening for trades via WebSocket...\n');
  }

  /**
   * Handle incoming trade from RTDS
   */
  private async handleIncomingTrade(trade: RTDSTradePayload): Promise<void> {
    // Check if this is from our target wallet
    const tradeWallet = (trade.proxyWallet || '').toLowerCase();
    if (tradeWallet !== this.config.targetWallet) {
      return; // Not our target
    }

    // Check if BUY only
    if (this.config.copyBuysOnly && trade.side !== 'BUY') {
      return;
    }

    // Check for duplicate
    if (!trade.transactionHash || this.tracker.isCopied(trade.transactionHash)) {
      return;
    }

    // Convert to our trade format
    const polyTrade: PolymarketTrade = {
      transactionHash: trade.transactionHash,
      side: trade.side as 'BUY' | 'SELL',
      asset: trade.asset || '',
      size: trade.size || '0',
      price: trade.price || '0',
      timestamp: String(trade.timestamp || Date.now()),
      title: trade.title || '',
      slug: trade.slug || '',
      outcome: trade.outcome || ''
    };

    // Process the trade
    await this.copyTrade(polyTrade);
  }

  /**
   * Copy a single trade
   */
  private async copyTrade(trade: PolymarketTrade): Promise<void> {
    this.stats.tradesDetected++;
    const isBuy = trade.side === 'BUY';
    const isSell = trade.side === 'SELL';

    const now = new Date().toLocaleTimeString('tr-TR');
    console.log(`\n[${now}] ⚡ REAL-TIME ${trade.side} DETECTED!`);
    console.log('─'.repeat(50));
    console.log(`   📊 Title: ${trade.title}`);
    console.log(`   🎯 Outcome: ${trade.outcome}`);
    console.log(`   📈 Side: ${isBuy ? '🟢 BUY' : '🔴 SELL'}`);
    console.log(`   💰 Size: $${parseFloat(trade.size).toFixed(2)}`);
    console.log(`   💵 Price: ${trade.price}`);
    console.log(`   🔗 TX: ${trade.transactionHash.slice(0, 16)}...`);

    // For SELL, check if we have position
    if (isSell) {
      const position = this.positions.get(trade.asset);
      if (!position || position.shares <= 0) {
        console.log(`   ⏭️ SKIP: No position to sell`);
        console.log('─'.repeat(50));
        this.stats.tradesSkipped++;
        this.tracker.markCopied(trade, undefined, 'skipped', 'No position to sell', 0);
        return;
      }
      console.log(`   📦 Our position: ${position.shares.toFixed(2)} shares`);
    }
    console.log('─'.repeat(50));

    // Execute copy
    const result = await this.executeCopy(trade);

    if (result.success) {
      this.stats.tradesCopied++;

      if (isBuy) {
        // Track new position
        const shares = this.config.fixedAmount / parseFloat(trade.price);
        const existing = this.positions.get(trade.asset);
        if (existing) {
          existing.shares += shares;
          existing.avgPrice = (existing.avgPrice + parseFloat(trade.price)) / 2;
        } else {
          this.positions.set(trade.asset, {
            shares,
            avgPrice: parseFloat(trade.price),
            title: trade.title,
            outcome: trade.outcome
          });
        }
        this.stats.totalSpent += this.config.fixedAmount;
        this.tracker.markCopied(trade, result.orderId, 'success', undefined, this.config.fixedAmount);

        const potentialPayout = this.config.fixedAmount / parseFloat(trade.price);
        console.log(`   ✅ BUY COPIED! Order: ${result.orderId?.slice(0, 12)}...`);
        console.log(`   💵 Amount: $${this.config.fixedAmount} @ ${trade.price}`);
        console.log(`   🎰 Potential payout: $${potentialPayout.toFixed(2)}`);
        console.log(`   ⏱️ Execution: ${result.executionTimeMs}ms`);

        this.telegram.notify(
          `🟢 *BUY Copied!*\n\n` +
          `Market: ${trade.title}\n` +
          `Outcome: ${trade.outcome}\n` +
          `Amount: $${this.config.fixedAmount}\n` +
          `Price: ${trade.price}\n` +
          `Potential: $${potentialPayout.toFixed(2)}\n` +
          `Latency: ${result.executionTimeMs}ms`
        );
      } else {
        // SELL - remove position
        const position = this.positions.get(trade.asset);
        const soldShares = position?.shares || 0;
        const soldValue = soldShares * parseFloat(trade.price);
        this.positions.delete(trade.asset);
        this.tracker.markCopied(trade, result.orderId, 'success', undefined, soldValue);

        console.log(`   ✅ SELL COPIED! Order: ${result.orderId?.slice(0, 12)}...`);
        console.log(`   📤 Sold: ${soldShares.toFixed(2)} shares @ ${trade.price}`);
        console.log(`   💰 Value: $${soldValue.toFixed(2)}`);
        console.log(`   ⏱️ Execution: ${result.executionTimeMs}ms`);

        this.telegram.notify(
          `🔴 *SELL Copied!*\n\n` +
          `Market: ${trade.title}\n` +
          `Outcome: ${trade.outcome}\n` +
          `Sold: ${soldShares.toFixed(2)} shares\n` +
          `Price: ${trade.price}\n` +
          `Value: $${soldValue.toFixed(2)}\n` +
          `Latency: ${result.executionTimeMs}ms`
        );
      }
    } else {
      this.stats.tradesFailed++;
      this.tracker.markCopied(trade, undefined, 'failed', result.error, 0);

      console.log(`   ❌ FAILED: ${result.error}`);

      this.telegram.notify(
        `❌ *${trade.side} Failed!*\n\n` +
        `Market: ${trade.title}\n` +
        `Error: ${result.error}`
      );
    }

    this.stats.lastTradeAt = new Date();
  }

  /**
   * Execute the copy order (BUY or SELL)
   */
  private async executeCopy(trade: PolymarketTrade): Promise<OrderResult> {
    const startTime = Date.now();
    const isSell = trade.side === 'SELL';

    if (this.config.dryRun) {
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
      // For SELL, use our position size; for BUY, use fixed amount
      let amount = this.config.fixedAmount;
      if (isSell) {
        const position = this.positions.get(trade.asset);
        if (!position || position.shares <= 0) {
          return {
            success: false,
            error: 'No position to sell',
            executionTimeMs: Date.now() - startTime
          };
        }
        amount = position.shares;
      }

      const orderObj = await this.client.createMarketOrder({
        tokenID: trade.asset,
        amount: amount,
        side: isSell ? Side.SELL : Side.BUY
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
   * Start periodic ROI checking
   */
  private startROIChecker(): void {
    this.roiCheckTimer = setInterval(() => this.checkROI(), 30000);
    setTimeout(() => this.checkROI(), 10000);
  }

  /**
   * Check resolution status
   */
  private async checkROI(): Promise<void> {
    const unresolved = this.tracker.getUnresolvedTrades();
    if (unresolved.length === 0) return;

    let newResolutions = 0;

    for (const trade of unresolved) {
      if (!trade.tokenId) continue;

      const { price, resolved } = await this.resolver.checkTokenPrice(trade.tokenId);

      if (resolved) {
        const won = price >= 0.99;
        const shares = (trade.amount || 0) / (trade.buyPrice || 0.5);
        const payout = won ? shares : 0;

        this.tracker.markResolved(trade.transactionHash, won, payout);

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
        console.log(`         ${won ? '✅ WON' : '❌ LOST'} | P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}`);

        this.telegram.notify(
          `*Trade Resolved ${won ? '✅' : '❌'}*\n\n` +
          `Market: ${trade.marketTitle}\n` +
          `Result: ${won ? 'WON' : 'LOST'}\n` +
          `P/L: ${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)}`
        );
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (newResolutions > 0) {
      this.printROISummary();
    }
  }

  /**
   * Print ROI summary
   */
  private printROISummary(): void {
    const summary = this.tracker.getROISummary();

    console.log('\n' + '─'.repeat(50));
    console.log('   📊 ROI SUMMARY');
    console.log('─'.repeat(50));
    console.log(`   Resolved: ${summary.resolved} | Pending: ${summary.pending}`);
    console.log(`   Won: ${summary.won} | Lost: ${summary.lost}`);
    console.log(`   Win Rate: ${summary.winRate}`);
    console.log(`   Profit: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}`);
    console.log(`   ROI: ${summary.roi}`);
    console.log('─'.repeat(50) + '\n');
  }

  /**
   * Stop the bot
   */
  stop(): void {
    console.log('\n🛑 Stopping bot...');
    this.isRunning = false;

    if (this.roiCheckTimer) {
      clearInterval(this.roiCheckTimer);
    }

    this.rtds.disconnect();

    // Generate report immediately, don't wait for ROI check
    this.tracker.stop();
    this.printFinalStats();

    // Then do final ROI check in background
    this.checkROI().catch(() => {});
  }

  /**
   * Print final statistics
   */
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
    console.log(`   Resolved: ${summary.resolved} | Pending: ${summary.pending}`);
    console.log(`   Won: ${summary.won} | Lost: ${summary.lost}`);
    console.log(`   Win Rate: ${summary.winRate}`);
    console.log(`   Profit/Loss: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}`);
    console.log(`   ROI: ${summary.roi}`);
    console.log('='.repeat(60) + '\n');

    // Generate detailed report file
    this.generateReport(runtime, summary);

    this.telegram.notify(
      `*Bot Stopped*\n\n` +
      `Runtime: ${runtime}m\n` +
      `Copied: ${this.stats.tradesCopied}\n` +
      `Spent: $${this.stats.totalSpent.toFixed(2)}\n\n` +
      `*ROI*\n` +
      `Won: ${summary.won} | Lost: ${summary.lost}\n` +
      `Win Rate: ${summary.winRate}\n` +
      `P/L: ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}\n` +
      `ROI: ${summary.roi}`
    );
  }

  /**
   * Generate detailed report file
   */
  private generateReport(runtime: number, summary: any): void {
    const reportPath = path.join(__dirname, '../../data/copy-trading-report.txt');
    const now = new Date().toLocaleString('tr-TR');

    // Get all trade records from tracker
    const allRecords = this.tracker.getAllRecords();

    let report = '';
    report += '═'.repeat(70) + '\n';
    report += '                    COPY TRADING BOT - RAPOR\n';
    report += '═'.repeat(70) + '\n';
    report += `Tarih: ${now}\n`;
    report += `Mode: ${this.config.dryRun ? 'DRY RUN (Simülasyon)' : 'LIVE'}\n`;
    report += `Target Wallet: ${this.config.targetWallet}\n`;
    report += `Çalışma Süresi: ${runtime} dakika\n`;
    report += '═'.repeat(70) + '\n\n';

    // Summary
    report += '┌─────────────────────────────────────────────────────────────────────┐\n';
    report += '│                           ÖZET                                      │\n';
    report += '├─────────────────────────────────────────────────────────────────────┤\n';
    report += `│  Tespit Edilen Trade:     ${String(this.stats.tradesDetected).padStart(6)}                                  │\n`;
    report += `│  Kopyalanan Trade:        ${String(this.stats.tradesCopied).padStart(6)}                                  │\n`;
    report += `│  Başarısız Trade:         ${String(this.stats.tradesFailed).padStart(6)}                                  │\n`;
    report += `│  Atlanan Trade:           ${String(this.stats.tradesSkipped).padStart(6)}                                  │\n`;
    report += '├─────────────────────────────────────────────────────────────────────┤\n';
    report += `│  Toplam Harcanan:       $${this.stats.totalSpent.toFixed(2).padStart(7)}                                  │\n`;
    report += `│  Toplam Geri Dönüş:     $${summary.totalPayout.toFixed(2).padStart(7)}                                  │\n`;
    report += `│  ──────────────────────────────────                                 │\n`;
    const profitStr = (summary.profit >= 0 ? '+' : '') + '$' + summary.profit.toFixed(2);
    report += `│  NET KAR/ZARAR:         ${profitStr.padStart(8)}                                  │\n`;
    report += '├─────────────────────────────────────────────────────────────────────┤\n';
    report += `│  Çözümlenen:  ${summary.resolved}    Bekleyen:  ${summary.pending}                                   │\n`;
    report += `│  Kazanan:     ${summary.won}    Kaybeden:  ${summary.lost}                                   │\n`;
    report += `│  Kazanma Oranı: ${summary.winRate.padStart(6)}    ROI: ${summary.roi.padStart(7)}                            │\n`;
    report += '└─────────────────────────────────────────────────────────────────────┘\n\n';

    // Trade details
    report += '┌─────────────────────────────────────────────────────────────────────┐\n';
    report += '│                      TÜM İŞLEMLER                                   │\n';
    report += '└─────────────────────────────────────────────────────────────────────┘\n\n';

    if (allRecords.length === 0) {
      report += '  Henüz işlem yapılmadı.\n\n';
    } else {
      for (let i = 0; i < allRecords.length; i++) {
        const r = allRecords[i];
        const status = r.resolved
          ? (r.won ? '✅ KAZANDI' : '❌ KAYBETTİ')
          : '⏳ BEKLEMEDE';

        report += `─── İşlem #${i + 1} ───────────────────────────────────────────────────\n`;
        report += `  Market:    ${r.marketTitle || 'N/A'}\n`;
        report += `  Outcome:   ${r.outcome || 'N/A'}\n`;
        report += `  Zaman:     ${r.copiedAt}\n`;
        report += `  Fiyat:     $${(r.buyPrice || 0).toFixed(2)}\n`;
        report += `  Miktar:    $${(r.amount || 0).toFixed(2)}\n`;
        report += `  Durum:     ${status}\n`;

        if (r.resolved) {
          const profit = (r.payout || 0) - (r.amount || 0);
          report += `  Geri Dönüş: $${(r.payout || 0).toFixed(2)}\n`;
          report += `  Kar/Zarar: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}\n`;
        }
        report += '\n';
      }
    }

    // Position summary
    report += '┌─────────────────────────────────────────────────────────────────────┐\n';
    report += '│                    AÇIK POZİSYONLAR                                 │\n';
    report += '└─────────────────────────────────────────────────────────────────────┘\n\n';

    if (this.positions.size === 0) {
      report += '  Açık pozisyon yok.\n\n';
    } else {
      this.positions.forEach((pos, tokenId) => {
        report += `  ${pos.title} - ${pos.outcome}\n`;
        report += `    Shares: ${pos.shares.toFixed(2)} @ $${pos.avgPrice.toFixed(2)}\n`;
        report += `    Değer: $${(pos.shares * pos.avgPrice).toFixed(2)}\n\n`;
      });
    }

    // Footer
    report += '═'.repeat(70) + '\n';
    report += `Rapor oluşturulma zamanı: ${now}\n`;
    report += `Dosya: ${reportPath}\n`;
    report += '═'.repeat(70) + '\n';

    // Write to file
    try {
      const dir = path.dirname(reportPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(reportPath, report);
      console.log(`\n📄 Detaylı rapor kaydedildi: ${reportPath}\n`);
    } catch (error) {
      console.error('Rapor yazılamadı:', error);
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const bot = new CopyTradingBotWS(CONFIG);

  process.on('SIGINT', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 5000); // Wait longer for report
  });

  process.on('SIGTERM', () => {
    bot.stop();
    setTimeout(() => process.exit(0), 5000);
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
