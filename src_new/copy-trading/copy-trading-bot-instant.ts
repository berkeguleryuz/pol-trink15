/**
 * COPY TRADING BOT - Instant 1:1 Version
 *
 * Target wallet'ın her işlemini ANLIK ve BİRE BİR kopyalar.
 * Buffer yok, gecikme yok. Trade geldi → hemen kopyala.
 *
 * Usage:
 *   npm run copy:instant:dry   - Dry run
 *   npm run copy:instant:live  - Live mode
 *   npm run copy:instant:live -- --amount=5  - $5 per trade
 *   npm run copy:instant:live -- --scale=0.1 - Target'ın %10'u kadar
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import WebSocket from 'ws';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketClientWrapper } from '../trading/polymarket-client';

// ============================================================================
// CONFIGURATION
// ============================================================================

const parseAmount = (): number | null => {
  const amountArg = process.argv.find(arg => arg.startsWith('--amount='));
  if (amountArg) {
    const val = parseFloat(amountArg.split('=')[1]);
    if (!isNaN(val) && val >= 1) return val;
  }
  return null; // null = use scale mode
};

const parseScale = (): number => {
  const scaleArg = process.argv.find(arg => arg.startsWith('--scale='));
  if (scaleArg) {
    const val = parseFloat(scaleArg.split('=')[1]);
    if (!isNaN(val) && val > 0 && val <= 1) return val;
  }
  return 0.1; // Default: target'ın %10'u
};

const CONFIG = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase(),
  fixedAmount: parseAmount(),      // null = scale mode
  scale: parseScale(),             // Target'ın yüzdesi
  minOrderSize: 1,                 // Polymarket minimum $1
  dryRun: !process.argv.includes('--live'),
  persistPath: path.join(__dirname, '../../data/copied-trades-instant.json')
};

const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com';
const PING_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 3000;

// ============================================================================
// TYPES
// ============================================================================

interface RTDSTradePayload {
  asset?: string;
  side?: string;
  size?: string;
  price?: string;
  timestamp?: number;
  title?: string;
  slug?: string;
  outcome?: string;
  proxyWallet?: string;
  transactionHash?: string;
}

interface TradeRecord {
  hash: string;
  time: string;
  market: string;
  outcome: string;
  side: string;
  targetSize: number;
  targetPrice: number;
  ourSize: number;
  ourPrice: number;
  orderId?: string;
  status: 'success' | 'failed';
  error?: string;
  latencyMs: number;
}

// ============================================================================
// INSTANT COPY BOT
// ============================================================================

class InstantCopyBot {
  private client: ClobClient | null = null;
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private copiedHashes: Set<string> = new Set();
  private records: TradeRecord[] = [];
  private stats = {
    detected: 0,
    copied: 0,
    failed: 0,
    roundedUp: 0,  // Minimum'a yuvarlanan trade sayısı
    totalSpent: 0,
    // Target analysis
    targetTrades: [] as number[],
    targetTotal: 0
  };

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   INSTANT COPY BOT - Bire Bir Kopyalama');
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Target: ${CONFIG.targetWallet.slice(0, 10)}...`);

    if (CONFIG.fixedAmount) {
      console.log(`   Amount: Fixed $${CONFIG.fixedAmount} per trade`);
    } else {
      console.log(`   Amount: Scale ${(CONFIG.scale * 100).toFixed(0)}% of target`);
    }

    console.log(`   Delay: 0ms (instant)`);
    console.log('='.repeat(60) + '\n');

    // Load previous trades
    this.loadRecords();

    // Init client
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
      console.log('   ✅ Client ready\n');
    }

    // Connect WebSocket
    this.connectWS();

    console.log('🚀 Listening for trades... (Ctrl+C to stop)\n');
  }

  private loadRecords(): void {
    try {
      if (fs.existsSync(CONFIG.persistPath)) {
        const data = JSON.parse(fs.readFileSync(CONFIG.persistPath, 'utf-8'));
        this.records = data.records || [];
        this.copiedHashes = new Set(this.records.map(r => r.hash));
        console.log(`   📂 Loaded ${this.copiedHashes.size} previous trades\n`);
      }
    } catch (e) {
      // Ignore
    }
  }

  private saveRecords(): void {
    try {
      const dir = path.dirname(CONFIG.persistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(CONFIG.persistPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        stats: this.stats,
        records: this.records.slice(-500)
      }, null, 2));
    } catch (e) {
      // Ignore
    }
  }

  private connectWS(): void {
    console.log('   🔌 Connecting to RTDS...');
    this.ws = new WebSocket(RTDS_WS_URL);

    this.ws.on('open', () => {
      console.log('   ✅ Connected!\n');

      // Subscribe
      this.ws!.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{ topic: 'activity', type: 'trades' }]
      }));

      // Ping keepalive
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, PING_INTERVAL_MS);
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.topic === 'activity' && msg.type === 'trades') {
          this.handleTrade(msg.payload);
        }
      } catch (e) {}
    });

    this.ws.on('close', () => {
      console.log('   ⚠️ Disconnected, reconnecting...');
      if (this.pingInterval) clearInterval(this.pingInterval);
      setTimeout(() => this.connectWS(), RECONNECT_DELAY_MS);
    });

    this.ws.on('error', (err) => {
      console.error('   ❌ WS Error:', err.message);
    });
  }

  private async handleTrade(trade: RTDSTradePayload): Promise<void> {
    // Filter: only target wallet
    if ((trade.proxyWallet || '').toLowerCase() !== CONFIG.targetWallet) return;

    // Filter: only BUY
    if (trade.side !== 'BUY') return;

    // Filter: no duplicates
    if (!trade.transactionHash || this.copiedHashes.has(trade.transactionHash)) return;

    this.stats.detected++;
    this.copiedHashes.add(trade.transactionHash);

    const startTime = Date.now();
    const targetSize = parseFloat(trade.size || '0');
    const targetPrice = parseFloat(trade.price || '0');
    const targetValue = targetSize * targetPrice;

    // Track target's spending for analysis
    this.stats.targetTrades.push(targetValue);
    this.stats.targetTotal += targetValue;

    // Calculate our amount
    let ourAmount: number;
    if (CONFIG.fixedAmount) {
      ourAmount = CONFIG.fixedAmount;
    } else {
      ourAmount = targetValue * CONFIG.scale;
    }

    // If below minimum, round up to minimum (don't skip)
    const originalAmount = ourAmount;
    if (ourAmount < CONFIG.minOrderSize) {
      ourAmount = CONFIG.minOrderSize;
    }

    const now = new Date().toLocaleTimeString('tr-TR');
    const roundedNote = originalAmount < CONFIG.minOrderSize ? ` (min'e yuvarlandı)` : '';
    console.log(`[${now}] ⚡ ${trade.outcome} @ ${targetPrice.toFixed(2)} | Target: $${targetValue.toFixed(2)} → Us: $${ourAmount.toFixed(2)}${roundedNote}`);
    console.log(`         ${trade.title?.slice(0, 50)}...`);

    // Execute immediately
    const result = await this.executeOrder(trade.asset!, ourAmount);
    const latency = Date.now() - startTime;

    const record: TradeRecord = {
      hash: trade.transactionHash,
      time: new Date().toISOString(),
      market: trade.title || '',
      outcome: trade.outcome || '',
      side: 'BUY',
      targetSize,
      targetPrice,
      ourSize: ourAmount,
      ourPrice: targetPrice,
      orderId: result.orderId,
      status: result.success ? 'success' : 'failed',
      error: result.error,
      latencyMs: latency
    };

    this.records.push(record);

    if (result.success) {
      this.stats.copied++;
      this.stats.totalSpent += ourAmount;
      if (originalAmount < CONFIG.minOrderSize) {
        this.stats.roundedUp++;
      }
      console.log(`         ✅ Copied in ${latency}ms | Order: ${result.orderId?.slice(0, 12)}...`);
    } else {
      this.stats.failed++;
      console.log(`         ❌ Failed: ${result.error}`);
    }

    this.printAnalysis();

    // Save periodically
    if (this.stats.detected % 10 === 0) {
      this.saveRecords();
    }
  }

  private printAnalysis(): void {
    if (this.stats.targetTrades.length === 0) return;

    const trades = this.stats.targetTrades;
    const avg = this.stats.targetTotal / trades.length;
    const min = Math.min(...trades);
    const max = Math.max(...trades);
    const sorted = [...trades].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // How many trades needed rounding
    const roundedCount = trades.filter(t => t * CONFIG.scale < CONFIG.minOrderSize).length;
    const roundedPercent = ((roundedCount / trades.length) * 100).toFixed(1);

    console.log(`\n         📊 TARGET ANALİZİ (${trades.length} trade)`);
    console.log(`         ├─ Min: $${min.toFixed(2)} | Max: $${max.toFixed(2)}`);
    console.log(`         ├─ Avg: $${avg.toFixed(2)} | Median: $${median.toFixed(2)}`);
    console.log(`         ├─ Target Total: $${this.stats.targetTotal.toFixed(2)}`);
    console.log(`         ├─ Our Total: $${this.stats.totalSpent.toFixed(2)}`);
    console.log(`         ├─ Scale: ${(CONFIG.scale * 100).toFixed(0)}%`);
    console.log(`         └─ $1'e yuvarlandı: ${this.stats.roundedUp} (${roundedPercent}%)\n`);
  }

  private async executeOrder(tokenId: string, amount: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (CONFIG.dryRun) {
      return { success: true, orderId: `dry-${Date.now().toString(16)}` };
    }

    if (!this.client) {
      return { success: false, error: 'No client' };
    }

    try {
      const order = await this.client.createMarketOrder({
        tokenID: tokenId,
        amount: amount,
        side: Side.BUY
      });

      const response = await this.client.postOrder(order, OrderType.FOK);
      return { success: true, orderId: response.orderID || response.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    console.log('\n🛑 Stopping...');

    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) this.ws.close();

    this.saveRecords();

    const trades = this.stats.targetTrades;
    const avg = trades.length > 0 ? this.stats.targetTotal / trades.length : 0;
    const min = trades.length > 0 ? Math.min(...trades) : 0;
    const max = trades.length > 0 ? Math.max(...trades) : 0;

    console.log('\n' + '='.repeat(60));
    console.log('   📊 FINAL STATS');
    console.log('='.repeat(60));
    console.log(`   Detected: ${this.stats.detected}`);
    console.log(`   Copied: ${this.stats.copied}`);
    console.log(`   Failed: ${this.stats.failed}`);
    console.log(`   Rounded to $1: ${this.stats.roundedUp}`);
    console.log(`   Total Spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log('');
    console.log('   --- TARGET ANALİZİ ---');
    console.log(`   Target Trades: ${trades.length}`);
    console.log(`   Target Total: $${this.stats.targetTotal.toFixed(2)}`);
    console.log(`   Target Min: $${min.toFixed(2)}`);
    console.log(`   Target Max: $${max.toFixed(2)}`);
    console.log(`   Target Avg: $${avg.toFixed(2)}`);
    console.log('');
    console.log(`   --- ORAN ---`);
    const actualScale = this.stats.targetTotal > 0 ? (this.stats.totalSpent / this.stats.targetTotal) * 100 : 0;
    console.log(`   Hedef scale: ${(CONFIG.scale * 100).toFixed(0)}%`);
    console.log(`   Gerçek scale: ${actualScale.toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new InstantCopyBot();

process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

bot.start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
