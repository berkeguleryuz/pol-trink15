/**
 * COPY TRADING BOT - Fast Aggregation Version
 *
 * Fill'leri çok kısa sürede (50-100ms) toplar, tek order atar.
 * Maksimum hız + doğru miktar.
 *
 * Usage:
 *   npm run copy:fast:dry   - Dry run
 *   npm run copy:fast:live  - Live mode
 *   npm run copy:fast:live -- --scale=0.1  - %10 scale
 *   npm run copy:fast:live -- --buffer=100 - 100ms buffer
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import { AutoClaimer } from './auto-claimer';

// ============================================================================
// CONFIGURATION
// ============================================================================

const parseScale = (): number => {
  const arg = process.argv.find(a => a.startsWith('--scale='));
  if (arg) {
    const val = parseFloat(arg.split('=')[1]);
    if (!isNaN(val) && val > 0 && val <= 1) return val;
  }
  return 0.1; // Default %10
};

const parseSilence = (): number => {
  const arg = process.argv.find(a => a.startsWith('--silence='));
  if (arg) {
    const val = parseInt(arg.split('=')[1]);
    if (!isNaN(val) && val >= 0 && val <= 500) return val;
  }
  return 0; // Default 0ms = instant execution
};

const parseFixed = (): number | null => {
  const arg = process.argv.find(a => a.startsWith('--fixed='));
  if (arg) {
    const val = parseFloat(arg.split('=')[1]);
    if (!isNaN(val) && val > 0) return val;
  }
  return null; // null = use scale mode
};

const parseMinTrade = (): number => {
  const arg = process.argv.find(a => a.startsWith('--mintrade='));
  if (arg) {
    const val = parseFloat(arg.split('=')[1]);
    if (!isNaN(val) && val >= 0) return val;
  }
  return 0; // Default 0 = no minimum trade value
};

const CONFIG = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase(),
  scale: parseScale(),
  fixedAmount: parseFixed(),      // If set, always use this amount instead of scale
  silenceMs: parseSilence(),      // Execute after X ms of no new fills
  minOrderSize: 1,                // Minimum $1
  minPrice: 0.10,                 // Don't buy below 10 cents (price)
  minTradeValue: parseMinTrade(), // Don't copy trades below this value (e.g., $0.60)
  autoSellThreshold: 0.10,        // Auto-sell when our position drops below 10 cents
  autoBuyWinner: true,            // After auto-sell, also buy the winning side
  dryRun: !process.argv.includes('--live')
};

const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com';

// ============================================================================
// COLORS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',      // Up
  orange: '\x1b[33m',     // Down (yellow/orange)
  red: '\x1b[31m',        // Sell
  cyan: '\x1b[36m',       // Info
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// ============================================================================
// COIN NAME HELPER
// ============================================================================

/**
 * Extract short coin name from title
 * "Bitcoin Up or Down..." -> "BTC"
 * "Ethereum Up or Down..." -> "ETH"
 * "Solana Up or Down..." -> "SOL"
 * "XRP Up or Down..." -> "XRP"
 */
function getCoinName(title: string): string {
  if (title.startsWith('Bitcoin')) return 'BTC';
  if (title.startsWith('Ethereum')) return 'ETH';
  if (title.startsWith('Solana')) return 'SOL';
  if (title.startsWith('XRP')) return 'XRP';
  return '???';
}

// ============================================================================
// SMART FILTERING
// ============================================================================

/**
 * Check if we should skip this trade based on smart filtering
 */
function shouldSkipTrade(price: number): { skip: boolean; reason?: string } {
  // Simple rule: Never buy at or below minimum price (10¢)
  // Use <= to prevent buying at exactly 10¢ then immediately auto-selling
  if (price <= CONFIG.minPrice) {
    return {
      skip: true,
      reason: `Price ${(price * 100).toFixed(0)}¢ <= ${(CONFIG.minPrice * 100).toFixed(0)}¢`
    };
  }

  return { skip: false };
}

// ============================================================================
// TYPES
// ============================================================================

interface Fill {
  asset: string;
  outcome: string;
  size: number;
  price: number;
  title: string;
  slug: string;
  hash: string;
  timestamp: number;
}

interface AggregatedOrder {
  key: string;           // market+outcome unique key
  asset: string;
  outcome: string;
  title: string;
  slug: string;
  fills: Fill[];
  totalValue: number;
  avgPrice: number;
  firstFillAt: number;
  timer: NodeJS.Timeout | null;
}

interface OurPosition {
  asset: string;         // Token ID
  outcome: string;       // "Up" or "Down"
  slug: string;          // Market slug
  title: string;
  shares: number;
  avgBuyPrice: number;
  boughtAt: number;
}

// ============================================================================
// 15-MINUTE PERIOD TRACKING
// ============================================================================

interface PeriodTrade {
  outcome: string;
  shares: number;
  price: number;
  cost: number;
  type: 'copy' | 'stop-loss-sell' | 'recovered-buy';
  timestamp: number;
}

interface MarketPeriod {
  title: string;           // Full title with time
  slug: string;
  asset: string;
  startTime: number;       // When we first saw this market
  trades: PeriodTrade[];

  // Aggregated stats
  upBuyShares: number;
  upBuyCost: number;
  downBuyShares: number;
  downBuyCost: number;

  stopLossSellShares: number;
  stopLossSellRevenue: number;

  recoveredBuyShares: number;
  recoveredBuyCost: number;

  // Last seen market prices (from WebSocket, not our trades)
  lastUpPrice: number;
  lastDownPrice: number;
  lastPriceUpdate: number;

  resolved: boolean;
  winner?: string;         // "Up" or "Down"
}

class PeriodTracker {
  // Key: market title (includes time period)
  private periods: Map<string, MarketPeriod> = new Map();
  private reportedPeriods: Set<string> = new Set();
  private loggedMessages: Set<string> = new Set();  // Prevent duplicate log entries
  private reportFilePath: string;
  private logsDir: string;

  constructor() {
    // Create report file path with today's date
    const today = new Date().toISOString().split('T')[0];
    this.reportFilePath = path.join(__dirname, `../../data/period-reports-${today}.txt`);
    this.logsDir = path.join(__dirname, `../../data/period-logs`);

    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Extract short coin name from title
   * "Bitcoin Up or Down..." -> "BTC"
   * "Ethereum Up or Down..." -> "ETH"
   * "Solana Up or Down..." -> "SOL"
   * "XRP Up or Down..." -> "XRP"
   */
  private getCoinName(title: string): string {
    if (title.startsWith('Bitcoin')) return 'BTC';
    if (title.startsWith('Ethereum')) return 'ETH';
    if (title.startsWith('Solana')) return 'SOL';
    if (title.startsWith('XRP')) return 'XRP';
    return '???';
  }

  /**
   * Get log file path for a specific period
   */
  private getPeriodLogPath(title: string): string {
    // Extract time from title: "Bitcoin Up or Down - January 27, 12:00PM-12:15PM ET"
    const match = title.match(/(\w+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}(?:AM|PM))-(\d{1,2}:\d{2}(?:AM|PM))/i);
    if (match) {
      const [, month, day, startTime, endTime] = match;
      const sanitizedTime = `${month}-${day}_${startTime}-${endTime}`.replace(/:/g, '-');
      return path.join(this.logsDir, `${sanitizedTime}.log`);
    }
    return path.join(this.logsDir, 'unknown.log');
  }

  /**
   * Log a trade to the period-specific log file
   */
  logTrade(title: string, message: string): void {
    // Create unique key to prevent duplicate logs
    const logKey = `${title}:${message}`;
    if (this.loggedMessages.has(logKey)) {
      return;  // Already logged this exact message for this market
    }
    this.loggedMessages.add(logKey);

    // Cleanup old entries periodically (keep last 500)
    if (this.loggedMessages.size > 500) {
      const entries = Array.from(this.loggedMessages);
      this.loggedMessages = new Set(entries.slice(-250));
    }

    const logPath = this.getPeriodLogPath(title);
    const timestamp = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const coin = this.getCoinName(title);
    const line = `[${timestamp}] ${coin} ${message}\n`;

    try {
      fs.appendFileSync(logPath, line);
    } catch (e) {
      // Ignore errors
    }
  }

  /**
   * Record a trade for a market period
   */
  recordTrade(
    title: string,
    slug: string,
    asset: string,
    outcome: string,
    shares: number,
    price: number,
    type: 'copy' | 'stop-loss-sell' | 'recovered-buy'
  ): void {
    let period = this.periods.get(title);

    if (!period) {
      period = {
        title,
        slug,
        asset,
        startTime: Date.now(),
        trades: [],
        upBuyShares: 0,
        upBuyCost: 0,
        downBuyShares: 0,
        downBuyCost: 0,
        stopLossSellShares: 0,
        stopLossSellRevenue: 0,
        recoveredBuyShares: 0,
        recoveredBuyCost: 0,
        lastUpPrice: 0,
        lastDownPrice: 0,
        lastPriceUpdate: 0,
        resolved: false
      };
      this.periods.set(title, period);
    }

    const cost = shares * price;

    period.trades.push({
      outcome,
      shares,
      price,
      cost,
      type,
      timestamp: Date.now()
    });

    // Update aggregates
    if (type === 'copy') {
      if (outcome === 'Up') {
        period.upBuyShares += shares;
        period.upBuyCost += cost;
      } else {
        period.downBuyShares += shares;
        period.downBuyCost += cost;
      }
    } else if (type === 'stop-loss-sell') {
      period.stopLossSellShares += shares;
      period.stopLossSellRevenue += cost;
    } else if (type === 'recovered-buy') {
      period.recoveredBuyShares += shares;
      period.recoveredBuyCost += cost;
      // Also add to the winning side
      if (outcome === 'Up') {
        period.upBuyShares += shares;
        period.upBuyCost += cost;
      } else {
        period.downBuyShares += shares;
        period.downBuyCost += cost;
      }
    }
  }

  /**
   * Update last seen price for a market (called for ALL trades, not just ours)
   */
  updateMarketPrice(title: string, outcome: string, price: number): void {
    const period = this.periods.get(title);
    if (!period || period.resolved) return;

    if (outcome === 'Up') {
      period.lastUpPrice = price;
    } else {
      period.lastDownPrice = price;
    }
    period.lastPriceUpdate = Date.now();
  }

  /**
   * Mark a period as resolved and generate report
   */
  resolvePeriod(title: string, winner: string): void {
    const period = this.periods.get(title);
    if (!period || period.resolved) return;

    period.resolved = true;
    period.winner = winner;

    this.generateReport(period);
  }

  /**
   * Parse end time from title and check if period has ended
   * Returns end time in ms (ET timezone) or null
   */
  private getMarketEndTime(title: string): number | null {
    try {
      // Extract: "January 27, 10:30AM-10:45AM"
      const match = title.match(/(\w+)\s+(\d{1,2}),?\s+\d{1,2}:\d{2}(?:AM|PM)-(\d{1,2}):(\d{2})(AM|PM)/i);
      if (!match) return null;

      const [, monthName, dayStr, endHourStr, endMinStr, endAmPm] = match;

      let endHour = parseInt(endHourStr);
      const endMin = parseInt(endMinStr);
      if (endAmPm.toUpperCase() === 'PM' && endHour !== 12) endHour += 12;
      if (endAmPm.toUpperCase() === 'AM' && endHour === 12) endHour = 0;

      const months: { [key: string]: number } = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3,
        'may': 4, 'june': 5, 'july': 6, 'august': 7,
        'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      const month = months[monthName.toLowerCase()];
      const day = parseInt(dayStr);
      if (month === undefined) return null;

      // Create date in ET
      const now = new Date();
      const year = now.getFullYear();

      // Create end time in ET (we'll compare with ET time)
      const endDate = new Date(year, month, day, endHour, endMin, 0);
      return endDate.getTime();
    } catch {
      return null;
    }
  }

  /**
   * Check and report any periods that should be done (based on actual market end time)
   * Reports generated 1 minute after market ends (xx:01, xx:16, xx:31, xx:46)
   */
  checkExpiredPeriods(currentTrades: Map<string, any>): void {
    // Get current time in ET
    const now = new Date();
    const etTimeStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etNow = new Date(etTimeStr);

    for (const [title, period] of this.periods) {
      if (period.resolved || this.reportedPeriods.has(title)) continue;

      // Get market end time
      const marketEndTime = this.getMarketEndTime(title);
      if (!marketEndTime) continue;

      // Create comparable ET date
      const marketEndDate = new Date(marketEndTime);

      // Check if current ET time is past market end + 1 minute
      const etNowMinutes = etNow.getHours() * 60 + etNow.getMinutes();
      const marketEndMinutes = marketEndDate.getHours() * 60 + marketEndDate.getMinutes();

      // Also check if same day
      const sameDay = etNow.getDate() === marketEndDate.getDate() &&
                      etNow.getMonth() === marketEndDate.getMonth();

      if (sameDay && etNowMinutes >= marketEndMinutes + 1) {
        // Market has ended! Determine winner from last seen prices
        let winner = 'Unknown';

        // Use last seen market prices (from WebSocket)
        if (period.lastUpPrice > 0.90) {
          winner = 'Up';
        } else if (period.lastDownPrice > 0.90) {
          winner = 'Down';
        } else if (period.lastUpPrice > 0 && period.lastDownPrice > 0) {
          // Use higher price as winner
          winner = period.lastUpPrice > period.lastDownPrice ? 'Up' : 'Down';
        } else if (period.lastUpPrice > 0) {
          winner = period.lastUpPrice > 0.5 ? 'Up' : 'Down';
        } else if (period.lastDownPrice > 0) {
          winner = period.lastDownPrice > 0.5 ? 'Down' : 'Up';
        }

        period.resolved = true;
        period.winner = winner;
        this.generateReport(period);
      }
    }
  }

  /**
   * Generate and print period report
   */
  private generateReport(period: MarketPeriod): void {
    if (this.reportedPeriods.has(period.title)) return;
    this.reportedPeriods.add(period.title);

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const nowFull = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

    // Calculate totals
    const totalBuyCost = period.upBuyCost + period.downBuyCost;
    const totalBuyShares = period.upBuyShares + period.downBuyShares;
    const avgBuyPrice = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;

    // Calculate profit/loss
    let profit = 0;
    let winningShares = 0;
    let losingShares = 0;

    if (period.winner === 'Up') {
      winningShares = period.upBuyShares;
      losingShares = period.downBuyShares;
      // Up shares pay $1 each, Down shares worth $0
      profit = period.upBuyShares * 1 - totalBuyCost + period.stopLossSellRevenue;
    } else if (period.winner === 'Down') {
      winningShares = period.downBuyShares;
      losingShares = period.upBuyShares;
      profit = period.downBuyShares * 1 - totalBuyCost + period.stopLossSellRevenue;
    }

    const winnerEmoji = period.winner === 'Up' ? '📈' : period.winner === 'Down' ? '📉' : '❓';
    const profitEmoji = profit >= 0 ? '✅' : '❌';
    const profitSign = profit >= 0 ? '+' : '';
    const roi = totalBuyCost > 0 ? (profit / totalBuyCost) * 100 : 0;

    // Build report string (for both console and file)
    const lines = [
      '',
      '═'.repeat(60),
      `📊 15-DAKİKA PERIOD RAPORU [${nowFull}]`,
      '═'.repeat(60),
      `   ${period.title}`,
      `   Son fiyatlar: Up=${(period.lastUpPrice * 100).toFixed(0)}¢ Down=${(period.lastDownPrice * 100).toFixed(0)}¢`,
      '─'.repeat(60),
      '',
      `   📈 UP Pozisyonları:`,
      `      Alınan: ${period.upBuyShares.toFixed(2)} shares`,
      `      Maliyet: $${period.upBuyCost.toFixed(2)}`,
      `      Ortalama: ${period.upBuyShares > 0 ? ((period.upBuyCost / period.upBuyShares) * 100).toFixed(0) : 0}¢`,
      '',
      `   📉 DOWN Pozisyonları:`,
      `      Alınan: ${period.downBuyShares.toFixed(2)} shares`,
      `      Maliyet: $${period.downBuyCost.toFixed(2)}`,
      `      Ortalama: ${period.downBuyShares > 0 ? ((period.downBuyCost / period.downBuyShares) * 100).toFixed(0) : 0}¢`,
      '',
      `   🛑 Stop-Loss Satışları:`,
      `      Satılan: ${period.stopLossSellShares.toFixed(2)} shares`,
      `      Recovered: $${period.stopLossSellRevenue.toFixed(2)}`,
      '',
      `   🔄 Recovered ile Alımlar:`,
      `      Alınan: ${period.recoveredBuyShares.toFixed(2)} shares`,
      `      Maliyet: $${period.recoveredBuyCost.toFixed(2)}`,
      '',
      '─'.repeat(60),
      `   💰 ÖZET:`,
      `      Total Buy: ${totalBuyShares.toFixed(2)} shares = $${totalBuyCost.toFixed(2)}`,
      `      Ortalama Alış: ${(avgBuyPrice * 100).toFixed(0)}¢`,
      `      Stop-Loss Revenue: $${period.stopLossSellRevenue.toFixed(2)}`,
      '─'.repeat(60),
      `   🏆 KAZANAN: ${winnerEmoji} ${period.winner}`,
      `      Kazanan shares: ${winningShares.toFixed(2)} (→ $${winningShares.toFixed(2)})`,
      `      Kaybeden shares: ${losingShares.toFixed(2)} (→ $0)`,
      '',
      '─'.repeat(60),
      `   💵 FİNALİZE:`,
      `      Total Harcanan: $${totalBuyCost.toFixed(2)}`,
      `      Stop-Loss Recovered: $${period.stopLossSellRevenue.toFixed(2)}`,
      `      Claimed (kazanan): $${winningShares.toFixed(2)}`,
      '',
      `   ${profitEmoji} NET KAR/ZARAR: ${profitSign}$${profit.toFixed(2)}`,
      `   📈 ROI: ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`,
      '═'.repeat(60),
      ''
    ];

    // Print to console
    lines.forEach(line => console.log(line));

    // Save to main report file
    this.saveReportToFile(lines.join('\n'));

    // Also save to period-specific log file
    const periodLogPath = this.getPeriodLogPath(period.title);
    try {
      fs.appendFileSync(periodLogPath, '\n' + lines.join('\n') + '\n');
    } catch (e) {}
  }

  /**
   * Save report to file
   */
  private saveReportToFile(report: string): void {
    try {
      const dir = path.dirname(this.reportFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.reportFilePath, report + '\n');
    } catch (e) {
      console.error('Failed to save report:', e);
    }
  }

  /**
   * Get summary of all periods
   */
  getSummary(): { active: number; resolved: number; totalProfit: number; totalSpent: number; totalClaimed: number } {
    let active = 0;
    let resolved = 0;
    let totalProfit = 0;
    let totalSpent = 0;
    let totalClaimed = 0;

    for (const period of this.periods.values()) {
      if (period.resolved) {
        resolved++;
        const periodCost = period.upBuyCost + period.downBuyCost;
        totalSpent += periodCost;

        if (period.winner === 'Up') {
          totalClaimed += period.upBuyShares;
          totalProfit += period.upBuyShares - periodCost + period.stopLossSellRevenue;
        } else if (period.winner === 'Down') {
          totalClaimed += period.downBuyShares;
          totalProfit += period.downBuyShares - periodCost + period.stopLossSellRevenue;
        }
      } else {
        active++;
      }
    }

    return { active, resolved, totalProfit, totalSpent, totalClaimed };
  }

  /**
   * Get report file path
   */
  getReportFilePath(): string {
    return this.reportFilePath;
  }

  /**
   * Get logs directory path
   */
  getLogsDir(): string {
    return this.logsDir;
  }
}

// ============================================================================
// FAST COPY BOT
// ============================================================================

class FastCopyBot {
  private client: ClobClient | null = null;
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private periodCheckInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private miniHeartbeatInterval: NodeJS.Timeout | null = null;
  private autoClaimer: AutoClaimer | null = null;
  private lastMessageTime: number = Date.now();
  private readonly HEARTBEAT_TIMEOUT_MS = 60000;  // Reconnect if no message for 60 seconds

  // Aggregation: key -> pending order
  private pendingOrders: Map<string, AggregatedOrder> = new Map();

  // Our positions: slug:outcome -> position
  private ourPositions: Map<string, OurPosition> = new Map();

  // Period tracking for 15-min reports
  private periodTracker: PeriodTracker = new PeriodTracker();

  // Tracking
  private copiedHashes: Set<string> = new Set();

  // Current period tracking (resets each 15-min period)
  private currentPeriodKey: string = '';  // e.g., "5:00PM-5:15PM"
  private periodStats = {
    fillsReceived: 0,
    ordersPlaced: 0,
    ordersFailed: 0,
    spent: 0,
    targetTotal: 0,
    autoSells: 0
  };

  // Session totals (never reset)
  private sessionStats = {
    totalFills: 0,
    totalOrders: 0,
    totalSpent: 0,
    totalAutoSells: 0
  };

  // Debug counters (reset each heartbeat)
  private debugStats = {
    totalTrades: 0,
    targetTrades: 0,
    lastResetTime: Date.now()
  };

  // Track last trade message time (separate from ping/pong)
  private lastTradeTime: number = Date.now();
  private readonly TRADE_TIMEOUT_MS = 30000;  // Re-subscribe if no trades for 30 seconds

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   FAST COPY BOT - Fill Aggregation');
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Target: ${CONFIG.targetWallet.slice(0, 10)}...`);
    if (CONFIG.fixedAmount !== null) {
      console.log(`   💵 FIXED AMOUNT: $${CONFIG.fixedAmount} (per trade)`);
    } else {
      console.log(`   Scale: ${(CONFIG.scale * 100).toFixed(0)}%`);
      console.log(`   Min order: $${CONFIG.minOrderSize}`);
    }
    if (CONFIG.minTradeValue > 0) {
      console.log(`   🎯 MIN TRADE VALUE: $${CONFIG.minTradeValue} (skip smaller)`);
    }
    console.log(`   Silence trigger: ${CONFIG.silenceMs}ms`);
    console.log(`   Skip price below: ${(CONFIG.minPrice * 100).toFixed(0)}¢`);
    console.log(`   Auto-sell below: ${(CONFIG.autoSellThreshold * 100).toFixed(0)}¢`);
    console.log(`   Auto-buy winner: ${CONFIG.autoBuyWinner ? '✅ YES' : '❌ NO'}`);
    console.log('='.repeat(60) + '\n');

    // Init client
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
      console.log('   ✅ Client ready');

      // Init auto-claimer
      console.log('💰 Initializing auto-claimer...');
      this.autoClaimer = new AutoClaimer();
      this.autoClaimer.start(60000); // Check every 60 seconds
      console.log('   ✅ Auto-claimer ready\n');
    }

    // Connect WebSocket
    this.connectWS();

    // Periodic check for expired periods (every 15 seconds to catch xx:01, xx:16, xx:31, xx:46)
    this.periodCheckInterval = setInterval(() => {
      try {
        this.periodTracker.checkExpiredPeriods(this.ourPositions);
      } catch (e) {
        const err = e as Error;
        console.error(`   ❌ Period check error: ${err.message}`);
        console.error(err.stack);
      }
    }, 15000);

    // Heartbeat check - reconnect if no messages received for too long
    // Also serves as "still alive" indicator
    this.heartbeatInterval = setInterval(() => {
      try {
        const silentMs = Date.now() - this.lastMessageTime;
        const tradeSilentMs = Date.now() - this.lastTradeTime;
        const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
        const wsState = this.ws?.readyState;
        const wsStatus = wsState === WebSocket.OPEN ? 'OPEN' : wsState === WebSocket.CONNECTING ? 'CONNECTING' : wsState === WebSocket.CLOSING ? 'CLOSING' : 'CLOSED';

        // Always log heartbeat for debugging - include debug stats
        const debugPeriodSec = Math.floor((Date.now() - this.debugStats.lastResetTime) / 1000);
        console.log(`[${now}] 💓 Heartbeat: WS=${wsStatus}, tradeSilent=${(tradeSilentMs / 1000).toFixed(0)}s | Last ${debugPeriodSec}s: trades=${this.debugStats.totalTrades}, target=${this.debugStats.targetTrades} | Period[${this.currentPeriodKey || 'N/A'}]: $${this.periodStats.spent.toFixed(2)} | Session: $${this.sessionStats.totalSpent.toFixed(2)}`);

        // Reset debug stats for next period
        this.debugStats.totalTrades = 0;
        this.debugStats.targetTrades = 0;
        this.debugStats.lastResetTime = Date.now();

        // Check for trade silence - re-subscribe if no trades for 30s but WS is open
        if (tradeSilentMs > this.TRADE_TIMEOUT_MS && wsState === WebSocket.OPEN) {
          console.log(`[${now}] ⚠️ No trades for ${(tradeSilentMs / 1000).toFixed(0)}s - re-subscribing...`);
          this.resubscribe();
        }

        if (silentMs > this.HEARTBEAT_TIMEOUT_MS) {
          console.log(`[${now}] ⚠️ No message for ${(silentMs / 1000).toFixed(0)}s - forcing reconnect`);
          this.scheduleReconnect();
        }
      } catch (e) {
        const err = e as Error;
        console.error(`   ❌ Heartbeat error: ${err.message}`);
      }
    }, 30000);  // Check every 30 seconds

    // Mini heartbeat - just prints a tick every 10 seconds to show bot is alive
    this.miniHeartbeatInterval = setInterval(() => {
      process.stdout.write('.');  // Just a dot, no newline
    }, 10000);

    console.log('🚀 Listening... (dots = alive every 10s)\n');
  }

  // Hash persistence removed - not needed for 15-min markets
  // In-memory Set is sufficient to prevent duplicates within session

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;  // Max attempts before giving up
  private isReconnecting = false;

  private connectWS(): void {
    if (this.isReconnecting) return;

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    console.log(`[${now}] 🔌 Connecting to RTDS...`);
    this.ws = new WebSocket(RTDS_WS_URL);

    this.ws.on('open', () => {
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.log(`[${now}] ✅ WebSocket Connected!`);
      this.reconnectAttempts = 0;  // Reset on successful connection
      this.lastMessageTime = Date.now();  // Reset heartbeat timer

      this.ws!.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{ topic: 'activity', type: 'trades' }]
      }));
      console.log(`[${now}]    Subscribed to activity:trades\n`);

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
      }, 5000);
    });

    // Pong response also counts as a message for heartbeat
    this.ws.on('pong', () => {
      this.lastMessageTime = Date.now();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        this.lastMessageTime = Date.now();  // Track last message time for heartbeat

        const str = data.toString();
        // Skip empty or non-JSON messages silently
        if (!str || str.length < 2 || !str.startsWith('{')) {
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(str);
        } catch (parseErr) {
          // Only log parse errors for messages that look like they should be JSON
          if (str.startsWith('{') && str.length > 10) {
            console.error('   ❌ JSON parse error:', (parseErr as Error).message);
          }
          return;
        }

        if (msg.topic === 'activity' && msg.type === 'trades') {
          const payload = msg.payload;

          if (!payload) {
            console.log('   ⚠️ Empty payload received');
            return;
          }

          // Debug: count all trades and track last trade time
          this.debugStats.totalTrades++;
          this.lastTradeTime = Date.now();

          // Debug: count target trades
          const wallet = (payload.proxyWallet || '').toLowerCase();
          if (wallet === CONFIG.targetWallet) {
            this.debugStats.targetTrades++;
          }

          // Update market prices for ALL trades (for winner detection)
          if (payload.title && payload.outcome && payload.price) {
            this.periodTracker.updateMarketPrice(
              payload.title,
              payload.outcome,
              parseFloat(payload.price)
            );
          }

          // Check for auto-sell opportunity on ALL trades (not just target)
          this.checkAutoSell(payload).catch(e => {
            console.error('   ❌ AutoSell error:', e.message || e);
          });

          // Handle copy trading for target wallet
          this.handleFill(payload);
        }
      } catch (e) {
        const err = e as Error;
        console.error('   ❌ Message handler error:', err.message);
        console.error(err.stack);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.log(`\n[${now}] ⚠️ WebSocket CLOSED (code: ${code}, reason: ${reason.toString() || 'none'})`);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.error(`\n[${now}] ❌ WebSocket ERROR: ${err.message}`);
      // Don't reconnect here - close event will follow
    });

    // Also handle unexpected close without close event
    this.ws.on('unexpected-response', (req, res) => {
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.error(`\n[${now}] ❌ Unexpected response: ${res.statusCode}`);
      this.scheduleReconnect();
    });
  }

  private resubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    try {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{ topic: 'activity', type: 'trades' }]
      }));
      console.log(`[${now}]    ✅ Re-subscribed to activity:trades`);
      this.lastTradeTime = Date.now();  // Reset timer to avoid immediate re-subscribe
    } catch (e) {
      console.error(`[${now}]    ❌ Re-subscribe failed: ${(e as Error).message}`);
      this.scheduleReconnect();  // If re-subscribe fails, do full reconnect
    }
  }

  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    this.isReconnecting = true;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch (e) {}
      this.ws = null;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`\n❌ Max reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping bot.`);
      this.stop();
      process.exit(1);
    }

    // Quick reconnect - 500ms base, max 5 seconds
    const delay = Math.min(500 * this.reconnectAttempts, 5000);
    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    console.log(`[${now}] 🔄 Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.isReconnecting = false;
      this.connectWS();
    }, delay);
  }

  /**
   * Extract period key from title, e.g., "5:00PM-5:15PM" from "Bitcoin Up or Down - January 27, 5:00PM-5:15PM ET"
   */
  private extractPeriodKey(title: string): string {
    const match = title.match(/(\d{1,2}:\d{2}(?:AM|PM))-(\d{1,2}:\d{2}(?:AM|PM))/i);
    return match ? match[0] : '';
  }

  /**
   * Check if we moved to a new period and reset stats if so
   */
  private checkPeriodChange(title: string): void {
    const periodKey = this.extractPeriodKey(title);
    if (!periodKey) return;

    if (this.currentPeriodKey && periodKey !== this.currentPeriodKey) {
      // Period changed! Print summary and reset
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.log(`\n[${now}] 🔄 NEW PERIOD: ${this.currentPeriodKey} → ${periodKey}`);
      console.log(`         📊 Period Summary: Fills=${this.periodStats.fillsReceived}, Orders=${this.periodStats.ordersPlaced}, Spent=$${this.periodStats.spent.toFixed(2)}, AutoSells=${this.periodStats.autoSells}`);
      console.log('');

      // Reset period stats
      this.periodStats = {
        fillsReceived: 0,
        ordersPlaced: 0,
        ordersFailed: 0,
        spent: 0,
        targetTotal: 0,
        autoSells: 0
      };
    }

    this.currentPeriodKey = periodKey;
  }

  private handleFill(payload: any): void {
    // Filter
    const wallet = (payload.proxyWallet || '').toLowerCase();
    const isTarget = wallet === CONFIG.targetWallet;

    if (!isTarget) return;

    // Debug: Target wallet trade detected
    const ts = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const targetCoin = getCoinName(payload.title || '');
    console.log(`[${ts}] 🔍 ${targetCoin} TARGET: side=${payload.side} outcome=${payload.outcome} price=${payload.price}`);

    if (payload.side !== 'BUY') {
      console.log(`[${ts}]    ↳ ${targetCoin} Skipped: not BUY (side=${payload.side})`);
      return;
    }

    if (!payload.transactionHash) {
      console.log(`[${ts}]    ↳ Skipped: no transactionHash`);
      return;
    }

    if (this.copiedHashes.has(payload.transactionHash)) {
      console.log(`[${ts}]    ↳ Skipped: already copied (hash=${payload.transactionHash.slice(0, 12)}...)`);
      return;
    }

    this.copiedHashes.add(payload.transactionHash);

    const fill: Fill = {
      asset: payload.asset || '',
      outcome: payload.outcome || '',
      size: parseFloat(payload.size || '0'),
      price: parseFloat(payload.price || '0'),
      title: payload.title || '',
      slug: payload.slug || '',
      hash: payload.transactionHash,
      timestamp: Date.now()
    };

    // Check for period change before processing
    this.checkPeriodChange(fill.title);

    this.periodStats.fillsReceived++;
    this.sessionStats.totalFills++;

    const value = fill.size * fill.price;
    this.periodStats.targetTotal += value;

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });

    // ========== SMART FILTERING ==========
    const coin = getCoinName(fill.title);

    // Skip small trade values (e.g., $0.08 trades when minTradeValue=$0.60)
    if (CONFIG.minTradeValue > 0 && value < CONFIG.minTradeValue) {
      console.log(`[${now}] ${COLORS.dim}⏭️ ${coin} SKIP: ${fill.outcome} $${value.toFixed(2)} < $${CONFIG.minTradeValue} min${COLORS.reset}`);
      this.periodTracker.logTrade(fill.title, `SKIP ${fill.outcome} $${value.toFixed(2)} < $${CONFIG.minTradeValue} min`);
      return;
    }

    // Skip low-price trades (< 10¢)
    const skipCheck = shouldSkipTrade(fill.price);
    if (skipCheck.skip) {
      console.log(`[${now}] ${COLORS.dim}⏭️ ${coin} SKIP: ${fill.outcome} @ ${(fill.price * 100).toFixed(0)}¢ - ${skipCheck.reason}${COLORS.reset}`);
      // Log skip to period file
      this.periodTracker.logTrade(fill.title, `SKIP ${fill.outcome} @ ${(fill.price * 100).toFixed(0)}¢ - ${skipCheck.reason}`);
      return;
    }

    // Create unique key for this market+outcome
    const key = `${fill.slug}:${fill.outcome}`;

    // Check if we have a pending order for this key
    let pending = this.pendingOrders.get(key);

    if (pending) {
      // Add to existing pending order
      pending.fills.push(fill);
      pending.totalValue += value;
      pending.avgPrice = pending.totalValue / pending.fills.reduce((sum, f) => sum + f.size, 0);

      // RESET timer - wait for silence again (or execute instantly if silence=0)
      if (pending.timer) clearTimeout(pending.timer);
      if (CONFIG.silenceMs === 0) {
        // Instant mode - execute immediately
        setImmediate(() => this.executeOrder(key));
      } else {
        pending.timer = setTimeout(() => {
          this.executeOrder(key);
        }, CONFIG.silenceMs);
      }

      const color = fill.outcome === 'Up' ? COLORS.green : COLORS.orange;
      console.log(`[${now}] ${color}📥 ${coin} +Fill: ${fill.outcome} @ ${fill.price.toFixed(2)} +$${value.toFixed(2)}${COLORS.reset} (total: $${pending.totalValue.toFixed(2)}, ${pending.fills.length} fills)`);
    } else {
      // Create new pending order
      pending = {
        key,
        asset: fill.asset,
        outcome: fill.outcome,
        title: fill.title,
        slug: fill.slug,
        fills: [fill],
        totalValue: value,
        avgPrice: fill.price,
        firstFillAt: Date.now(),
        timer: null
      };
      this.pendingOrders.set(key, pending);

      const color = fill.outcome === 'Up' ? COLORS.green : COLORS.orange;
      console.log(`[${now}] ${color}⚡ ${coin} NEW: ${fill.outcome} @ ${fill.price.toFixed(2)} $${value.toFixed(2)}${COLORS.reset}`);

      // Start timer - execute after silence period (or instantly if silence=0)
      if (CONFIG.silenceMs === 0) {
        // Instant mode - execute immediately
        setImmediate(() => this.executeOrder(key));
      } else {
        pending.timer = setTimeout(() => {
          this.executeOrder(key);
        }, CONFIG.silenceMs);
      }
    }
  }

  private async executeOrder(key: string): Promise<void> {
    const pending = this.pendingOrders.get(key);
    if (!pending) return;

    this.pendingOrders.delete(key);

    const latency = Date.now() - pending.firstFillAt;
    // Use fixed amount if set, otherwise calculate from scale
    let ourAmount = CONFIG.fixedAmount !== null
      ? CONFIG.fixedAmount
      : pending.totalValue * CONFIG.scale;

    // Round up to minimum if needed
    if (ourAmount < CONFIG.minOrderSize) {
      ourAmount = CONFIG.minOrderSize;
    }

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const coin = getCoinName(pending.title);
    const color = pending.outcome === 'Up' ? COLORS.green : COLORS.orange;
    console.log(`[${now}] ${color}🚀 ${coin} EXECUTE: ${pending.outcome}${COLORS.reset} | Target: $${pending.totalValue.toFixed(2)} (${pending.fills.length} fills) → Us: ${color}$${ourAmount.toFixed(2)}${COLORS.reset}`);

    const result = await this.placeOrder(pending.asset, ourAmount);

    if (result.success) {
      this.periodStats.ordersPlaced++;
      this.periodStats.spent += ourAmount;
      this.sessionStats.totalOrders++;
      this.sessionStats.totalSpent += ourAmount;
      console.log(`         ${color}✅ Order ${result.orderId?.slice(0, 12)}...${COLORS.reset} | Latency: ${latency}ms`);

      // Track our position for auto-sell
      const shares = ourAmount / pending.avgPrice;
      const posKey = `${pending.slug}:${pending.outcome}`;
      const existing = this.ourPositions.get(posKey);

      if (existing) {
        // Add to existing position
        const totalShares = existing.shares + shares;
        existing.avgBuyPrice = (existing.avgBuyPrice * existing.shares + pending.avgPrice * shares) / totalShares;
        existing.shares = totalShares;
      } else {
        // New position
        this.ourPositions.set(posKey, {
          asset: pending.asset,
          outcome: pending.outcome,
          slug: pending.slug,
          title: pending.title,
          shares: shares,
          avgBuyPrice: pending.avgPrice,
          boughtAt: Date.now()
        });
      }

      // Track for 15-minute period report
      this.periodTracker.recordTrade(
        pending.title,
        pending.slug,
        pending.asset,
        pending.outcome,
        shares,
        pending.avgPrice,
        'copy'
      );

      // Log to period-specific file
      this.periodTracker.logTrade(
        pending.title,
        `BUY ${pending.outcome} | ${shares.toFixed(2)} shares @ ${(pending.avgPrice * 100).toFixed(0)}¢ = $${ourAmount.toFixed(2)}`
      );

      // Track position for auto-claim
      if (this.autoClaimer) {
        await this.autoClaimer.addPosition(
          pending.asset,
          pending.outcome,
          shares,
          pending.avgPrice,
          pending.slug,
          pending.title
        );
      }
    } else {
      this.periodStats.ordersFailed++;
      console.log(`         ❌ Failed: ${result.error}`);
    }

    // Print running stats (period stats)
    const actualScale = this.periodStats.targetTotal > 0 ? (this.periodStats.spent / this.periodStats.targetTotal) * 100 : 0;
    const claimSummary = this.autoClaimer ? this.autoClaimer.getSummary() : { pending: 0 };
    const activePositions = this.ourPositions.size;
    console.log(`         📊 [${this.currentPeriodKey}] Fills: ${this.periodStats.fillsReceived} | Orders: ${this.periodStats.ordersPlaced} | Spent: $${this.periodStats.spent.toFixed(2)} (${actualScale.toFixed(1)}%)`);
    console.log(`         📊 Positions: ${activePositions} | Auto-sells: ${this.periodStats.autoSells} | Session: $${this.sessionStats.totalSpent.toFixed(2)}\n`);
  }

  /**
   * Check if we should auto-sell a losing position
   * When opposite outcome price rises above threshold, our position is losing
   */
  private async checkAutoSell(payload: any): Promise<void> {
    const slug = payload.slug || '';
    const tradeOutcome = payload.outcome || '';
    const tradePrice = parseFloat(payload.price || '0');
    const winningAsset = payload.asset || '';
    const title = payload.title || '';

    // Track high price for winner detection (but don't trigger report yet - wait for market end time)
    // Report will be triggered by checkExpiredPeriods at xx:01, xx:16, xx:31, xx:46

    // If opposite outcome is trading high (>90 cents), our position is losing
    if (tradePrice < (1 - CONFIG.autoSellThreshold)) return;

    // Check if we have a position on the OPPOSITE outcome
    const losingOutcome = tradeOutcome === 'Up' ? 'Down' : 'Up';
    const ourKey = `${slug}:${losingOutcome}`;
    const ourPosition = this.ourPositions.get(ourKey);

    if (!ourPosition || ourPosition.shares <= 0) return;

    // Our position is worth < 10 cents, AUTO-SELL!
    const ourPrice = 1 - tradePrice; // Approximate our price
    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const coin = getCoinName(ourPosition.title);

    console.log(`\n[${now}] ${COLORS.red}🔴 ${coin} AUTO-SELL TRIGGERED!${COLORS.reset}`);
    console.log(`         ${COLORS.red}${ourPosition.outcome} position @ ~${(ourPrice * 100).toFixed(0)}¢${COLORS.reset}`);
    console.log(`         Opposite (${tradeOutcome}) trading @ ${(tradePrice * 100).toFixed(0)}¢`);

    // Execute sell
    const sellResult = await this.placeSellOrder(ourPosition.asset, ourPosition.shares);

    if (sellResult.success) {
      this.periodStats.autoSells++;
      this.sessionStats.totalAutoSells++;
      const loss = ourPosition.shares * ourPosition.avgBuyPrice - ourPosition.shares * ourPrice;
      console.log(`         ${COLORS.red}✅ SOLD ${ourPosition.shares.toFixed(2)} shares | Loss: ~$${loss.toFixed(2)}${COLORS.reset}`);

      // Track stop-loss sell for period report
      this.periodTracker.recordTrade(
        ourPosition.title,
        ourPosition.slug,
        ourPosition.asset,
        ourPosition.outcome,
        ourPosition.shares,
        ourPrice,
        'stop-loss-sell'
      );

      // Log to period-specific file
      this.periodTracker.logTrade(
        ourPosition.title,
        `STOP-LOSS SELL ${ourPosition.outcome} | ${ourPosition.shares.toFixed(2)} shares @ ${(ourPrice * 100).toFixed(0)}¢ = $${(ourPosition.shares * ourPrice).toFixed(2)} | Loss: $${loss.toFixed(2)}`
      );

      // Remove losing position
      this.ourPositions.delete(ourKey);

      // === AUTO-BUY WINNER ===
      // Buy the winning side with the amount we recovered from selling
      if (CONFIG.autoBuyWinner && winningAsset) {
        // Calculate: we sold X shares at ~Y price, use that money to buy winner
        const recoveredAmount = ourPosition.shares * ourPrice;
        const buyAmount = Math.max(recoveredAmount, CONFIG.minOrderSize); // At least $1
        const buyColor = tradeOutcome === 'Up' ? COLORS.green : COLORS.orange;
        console.log(`         ${buyColor}🟢 ${coin} AUTO-BUY: ${tradeOutcome} @ ${(tradePrice * 100).toFixed(0)}¢${COLORS.reset}`);
        console.log(`         💰 Recovered $${recoveredAmount.toFixed(2)} → Buying ${buyColor}$${buyAmount.toFixed(2)}${COLORS.reset} of winner`);

        const buyResult = await this.placeOrder(winningAsset, buyAmount);

        if (buyResult.success) {
          this.periodStats.ordersPlaced++;
          this.periodStats.spent += buyAmount;
          this.sessionStats.totalOrders++;
          this.sessionStats.totalSpent += buyAmount;
          console.log(`         ${buyColor}✅ Bought winner: ${buyResult.orderId?.slice(0, 12)}...${COLORS.reset}`);

          // Track the new winning position
          const shares = buyAmount / tradePrice;
          const winnerKey = `${slug}:${tradeOutcome}`;
          const existing = this.ourPositions.get(winnerKey);

          if (existing) {
            const totalShares = existing.shares + shares;
            existing.avgBuyPrice = (existing.avgBuyPrice * existing.shares + tradePrice * shares) / totalShares;
            existing.shares = totalShares;
          } else {
            this.ourPositions.set(winnerKey, {
              asset: winningAsset,
              outcome: tradeOutcome,
              slug: slug,
              title: title,
              shares: shares,
              avgBuyPrice: tradePrice,
              boughtAt: Date.now()
            });
          }

          // Track recovered buy for period report
          this.periodTracker.recordTrade(
            title,
            slug,
            winningAsset,
            tradeOutcome,
            shares,
            tradePrice,
            'recovered-buy'
          );

          // Log to period-specific file
          this.periodTracker.logTrade(
            title,
            `RECOVERED BUY ${tradeOutcome} | ${shares.toFixed(2)} shares @ ${(tradePrice * 100).toFixed(0)}¢ = $${buyAmount.toFixed(2)}`
          );

          // Track for auto-claim
          if (this.autoClaimer) {
            await this.autoClaimer.addPosition(winningAsset, tradeOutcome, shares, tradePrice, slug, title);
          }
        } else {
          console.log(`         ❌ Auto-buy failed: ${buyResult.error}`);
        }
      }
    } else {
      console.log(`         ❌ Sell failed: ${sellResult.error}`);
    }
  }

  private async placeSellOrder(tokenId: string, shares: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (CONFIG.dryRun) {
      return { success: true, orderId: `dry-sell-${Date.now().toString(16)}` };
    }

    if (!this.client) {
      return { success: false, error: 'No client' };
    }

    try {
      const order = await this.client.createMarketOrder({
        tokenID: tokenId,
        amount: shares,
        side: Side.SELL
      });

      const response = await this.client.postOrder(order, OrderType.FOK);
      return { success: true, orderId: response.orderID || response.id };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async placeOrder(tokenId: string, amount: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
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

    // Execute any pending orders immediately
    for (const [key, pending] of this.pendingOrders) {
      if (pending.timer) clearTimeout(pending.timer);
      // Don't execute on stop - they might be incomplete
    }
    this.pendingOrders.clear();

    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.periodCheckInterval) clearInterval(this.periodCheckInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.miniHeartbeatInterval) clearInterval(this.miniHeartbeatInterval);
    if (this.ws) this.ws.close();

    // Stop auto-claimer
    if (this.autoClaimer) {
      this.autoClaimer.stop();
    }

    const claimSummary = this.autoClaimer ? this.autoClaimer.getSummary() : { total: 0, pending: 0, claimed: 0 };

    console.log('\n' + '='.repeat(60));
    console.log('   📊 SESSION STATS');
    console.log('='.repeat(60));
    console.log(`   Total fills: ${this.sessionStats.totalFills}`);
    console.log(`   Total orders: ${this.sessionStats.totalOrders}`);
    console.log(`   Total spent: $${this.sessionStats.totalSpent.toFixed(2)}`);
    console.log(`   Total auto-sells: ${this.sessionStats.totalAutoSells}`);
    console.log('');
    console.log('   --- AUTO-CLAIM ---');
    console.log(`   Positions tracked: ${claimSummary.total}`);
    console.log(`   Pending claim: ${claimSummary.pending}`);
    console.log(`   Already claimed: ${claimSummary.claimed}`);
    console.log('');
    const periodSummary = this.periodTracker.getSummary();
    console.log('   --- 15-DAKİKA PERİODLAR ---');
    console.log(`   Aktif periodlar: ${periodSummary.active}`);
    console.log(`   Tamamlanan: ${periodSummary.resolved}`);
    console.log(`   Toplam harcanan: $${periodSummary.totalSpent.toFixed(2)}`);
    console.log(`   Toplam claimed: $${periodSummary.totalClaimed.toFixed(2)}`);
    console.log(`   Toplam kar/zarar: $${periodSummary.totalProfit.toFixed(2)}`);
    if (periodSummary.totalSpent > 0) {
      const overallRoi = (periodSummary.totalProfit / periodSummary.totalSpent) * 100;
      console.log(`   Overall ROI: ${overallRoi >= 0 ? '+' : ''}${overallRoi.toFixed(1)}%`);
    }
    console.log(`\n   📁 Özet Rapor: ${this.periodTracker.getReportFilePath()}`);
    console.log(`   📁 Period Logları: ${this.periodTracker.getLogsDir()}/`);
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new FastCopyBot();

// Graceful shutdown handlers
process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

// Global error handlers - prevent silent crashes
process.on('uncaughtException', (err: Error, origin: string) => {
  const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
  console.error(`\n[${now}] 💥 UNCAUGHT EXCEPTION (${origin}): ${err.message}`);
  console.error(err.stack);
  console.log('   Bot continues running...\n');
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
  console.error(`\n[${now}] 💥 UNHANDLED REJECTION: ${reason?.message || reason}`);
  if (reason?.stack) console.error(reason.stack);
  console.log('   Bot continues running...\n');
});

// Catch any other process events
process.on('warning', (warning) => {
  console.warn(`\n⚠️ PROCESS WARNING: ${warning.name} - ${warning.message}`);
});

process.on('exit', (code) => {
  const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
  console.log(`\n[${now}] 🚪 PROCESS EXIT with code: ${code}`);
});

process.on('beforeExit', (code) => {
  const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
  console.log(`\n[${now}] 🚪 BEFORE EXIT with code: ${code}`);
});

bot.start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
