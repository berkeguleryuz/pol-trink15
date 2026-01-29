/**
 * SNIPER BOT v3
 *
 * Son 2.5 dakikada kazanan tarafı sürekli alır.
 * Market discovery + RTDS WebSocket ile real-time fiyat takibi.
 *
 * Mantık:
 * - Gamma API'den aktif 15-min marketleri bul (slug: btc-updown-15m-{timestamp})
 * - RTDS WebSocket'ten trade fiyatlarını al
 * - Market son 2.5 dk içinde:
 *   - UP > DOWN ise → UP al
 *   - DOWN > UP ise → DOWN al
 * - Her fiyat güncellemesinde değerlendir
 * - $2'lik alımlar, 2s cooldown, toplam limit dolana kadar
 * - Fiyat flip ederse DUR
 *
 * Usage:
 *   npm run sniper:dry
 *   npm run sniper:live
 */

import WebSocket from 'ws';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import { AutoClaimer } from './auto-claimer';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Timing (saniye) - market bitimine göre
  entryWindowStart: 240,      // 4 dk kala başla
  entryWindowEnd: 10,         // 10 saniye kala dur

  // Phase boundaries
  phase2Start: 180,           // 3 dk kala → Phase 2
  phase3Start: 60,            // 1 dk kala → Phase 3 (unlimited)

  // Price thresholds per phase
  phase1MinPrice: 0.82,       // Phase 1 (4-3 dk): 82¢+ al
  phase1StopPrice: 0.80,      // Phase 1: 80¢ altına düşerse DUR
  phase2MinPrice: 0.85,       // Phase 2 (3-1 dk): 85¢+ doldur
  phase3MinPrice: 0.90,       // Phase 3 (<1 dk): 90¢+ unlimited

  // Trade sizing
  perTradeAmount: 2,          // Her alım $2
  maxTotalPerMarket: 30,      // Normal limit ($30)
  phase3MaxPerMarket: 500,    // Phase 3'te pratik olarak limit yok

  // Trade cooldown
  tradeCooldownMs: 2000,      // Phase 1 & 2: 2 saniye
  phase3CooldownMs: 100,      // Phase 3: 100ms (sürekli al!)

  // Market refresh
  marketRefreshIntervalMs: 30000,  // 30 saniyede bir market ara

  // Target markets (BTC, ETH, SOL, XRP 15-minute)
  targetCryptos: ['btc', 'eth', 'sol', 'xrp'],

  // Mode
  dryRun: !process.argv.includes('--live'),

  // APIs
  gammaApi: 'https://gamma-api.polymarket.com',
  rtdsWsUrl: 'wss://ws-live-data.polymarket.com'
};

// ============================================================================
// COLORS
// ============================================================================

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

// ============================================================================
// TYPES
// ============================================================================

function getTime(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
}

interface MarketState {
  slug: string;
  title: string;
  coin: string;
  upPrice: number;
  downPrice: number;
  upTokenId: string;
  downTokenId: string;
  endTime: number;
  lastUpdate: number;
  lastTradeTime: number;
  totalSpent: number;
  currentSide: 'Up' | 'Down' | null;
  shares: number;
}

// ============================================================================
// SNIPER BOT
// ============================================================================

class SniperBot {
  private client: ClobClient | null = null;
  private ws: WebSocket | null = null;
  private running = false;
  private isConnected = false;

  // Active markets: slug -> state
  private markets: Map<string, MarketState> = new Map();

  // Timers
  private marketRefreshTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pricePollingTimer: NodeJS.Timeout | null = null;


  // Stats
  private stats = {
    tradesExecuted: 0,
    totalSpent: 0,
    expectedProfit: 0
  };

  // Logging
  private logsDir: string;

  // Auto claimer for resolved markets
  private autoClaimer: AutoClaimer | null = null;

  constructor() {
    // Ensure logs directory exists
    this.logsDir = path.join(__dirname, '../../data/period-logs');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Get log file path for a specific period
   */
  private getPeriodLogPath(title: string): string {
    const match = title.match(/(\w+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}(?:AM|PM))-(\d{1,2}:\d{2}(?:AM|PM))/i);
    if (match) {
      const [, month, day, startTime, endTime] = match;
      const sanitizedTime = `${month}-${day}_${startTime}-${endTime}`.replace(/:/g, '-');
      return path.join(this.logsDir, `sniper_${sanitizedTime}.log`);
    }
    return path.join(this.logsDir, 'sniper_unknown.log');
  }

  /**
   * Log to period file
   */
  private logToPeriod(market: MarketState, message: string): void {
    const logPath = this.getPeriodLogPath(market.title);
    const timestamp = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const line = `[${timestamp}] ${market.coin} ${message}\n`;

    try {
      fs.appendFileSync(logPath, line);
    } catch {
      // Ignore errors
    }
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}🎯 SNIPER BOT v5${C.reset} - Phased Entry Strategy`);
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Per Trade: $${CONFIG.perTradeAmount}`);
    console.log('');
    console.log(`   1️⃣  Phase 1 (4-3 dk): 82¢+ al, <80¢ dur | 2s`);
    console.log(`   2️⃣  Phase 2 (3-1 dk): 85¢+ doldur $${CONFIG.maxTotalPerMarket} | 2s`);
    console.log(`   🚀 Phase 3 (<1 dk):  90¢+ SPAM AL! | ${CONFIG.phase3CooldownMs}ms`);
    console.log(`      <90¢ düşerse dur, >90¢ devam`);
    console.log('='.repeat(60) + '\n');

    // Init client for live mode
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
      console.log('   ✅ Client ready');

      // Initialize auto-claimer
      console.log('📡 Initializing auto-claimer...');
      this.autoClaimer = new AutoClaimer();
      this.autoClaimer.start(60000); // Check every 60 seconds
      console.log('   ✅ Auto-claimer ready\n');
    }

    this.running = true;

    // Initial market discovery
    await this.discoverMarkets();

    // Connect to RTDS WebSocket
    this.connectWebSocket();

    // Periodic market refresh
    this.marketRefreshTimer = setInterval(() => {
      this.discoverMarkets();
    }, CONFIG.marketRefreshIntervalMs);

    // Periodic orderbook polling (every 1 second for markets near entry window)
    this.pricePollingTimer = setInterval(() => {
      this.pollOrderbookPrices();
    }, 1000);

    console.log('🎯 Sniper active! Watching for markets in last 2.5 minutes...\n');
  }

  /**
   * Poll prices from Gamma API for all markets
   */
  private async pollOrderbookPrices(): Promise<void> {
    const now = Date.now();

    for (const market of this.markets.values()) {
      const remainingSeconds = Math.floor((market.endTime - now) / 1000);

      // Skip expired markets
      if (remainingSeconds <= 0) continue;

      try {
        // Fetch prices from Gamma API
        const prices = await this.fetchGammaPrices(market.slug);

        if (prices) {
          const oldUp = market.upPrice;
          const oldDown = market.downPrice;

          market.upPrice = prices.upPrice;
          market.downPrice = prices.downPrice;
          market.lastUpdate = now;

          // Determine winner
          const winner = prices.upPrice > prices.downPrice ? 'UP' : 'DOWN';
          const winnerPrice = Math.max(prices.upPrice, prices.downPrice);
          const color = winner === 'UP' ? C.green : C.red;

          // Log price changes
          const time = getTime();
          const inWindow = remainingSeconds <= CONFIG.entryWindowStart;
          const windowStatus = inWindow ? `${C.bold}[IN WINDOW]${C.reset}` : '';

          // Only log if price changed OR every 10 seconds
          if (Math.abs(prices.upPrice - oldUp) > 0.005 || Math.abs(prices.downPrice - oldDown) > 0.005 || remainingSeconds % 10 === 0) {
            // Extract time from title
            const timeMatch = market.title.match(/(\d+:\d+[AP]M)-(\d+:\d+[AP]M)/i);
            const timeRange = timeMatch ? `${timeMatch[1]}-${timeMatch[2]}` : '';
            console.log(`[${time}] ${color}${market.coin}${C.reset} [${timeRange}] UP:${(prices.upPrice * 100).toFixed(0)}¢ DOWN:${(prices.downPrice * 100).toFixed(0)}¢ → ${color}${winner} ${(winnerPrice * 100).toFixed(0)}¢${C.reset} | ${remainingSeconds}s ${windowStatus}`);

            // Log to period file
            this.logToPeriod(market, `UP:${(prices.upPrice * 100).toFixed(0)}¢ DOWN:${(prices.downPrice * 100).toFixed(0)}¢ → ${winner} ${(winnerPrice * 100).toFixed(0)}¢ | ${remainingSeconds}s ${inWindow ? '[IN WINDOW]' : ''}`);
          }

          // Evaluate trade opportunity (only in entry window)
          if (inWindow) {
            await this.evaluateAndTrade(market);
          }
        }
      } catch {
        // Ignore fetch errors
      }
    }
  }

  /**
   * Fetch prices from Gamma API
   */
  private async fetchGammaPrices(slug: string): Promise<{ upPrice: number; downPrice: number } | null> {
    try {
      const response = await axios.get(`${CONFIG.gammaApi}/markets`, {
        params: { slug },
        timeout: 3000
      });

      if (!response.data || response.data.length === 0) return null;

      const market = response.data[0];
      const outcomes = JSON.parse(market.outcomes || '[]');
      const prices = JSON.parse(market.outcomePrices || '[]');

      let upPrice = 0.5, downPrice = 0.5;

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i].toLowerCase();
        if (outcome === 'up') {
          upPrice = parseFloat(prices[i] || '0.5');
        } else if (outcome === 'down') {
          downPrice = parseFloat(prices[i] || '0.5');
        }
      }

      return { upPrice, downPrice };
    } catch {
      return null;
    }
  }


  /**
   * Discover active 15-minute crypto markets
   */
  private async discoverMarkets(): Promise<void> {
    console.log(`[${getTime()}] 🔍 Searching for active 15-min crypto markets...`);

    const now = Date.now();
    const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    const nextInterval = currentInterval + (15 * 60 * 1000);

    const timestamps = [
      Math.floor(currentInterval / 1000),
      Math.floor(nextInterval / 1000)
    ];

    for (const crypto of CONFIG.targetCryptos) {
      let foundMarket = false;

      for (const timestamp of timestamps) {
        if (foundMarket) break;

        try {
          const slug = `${crypto}-updown-15m-${timestamp}`;
          const url = `${CONFIG.gammaApi}/markets?slug=${slug}`;

          const response = await axios.get(url, { timeout: 10000 });

          if (!response.data || response.data.length === 0) continue;

          const market = response.data[0];
          if (market.closed) continue;

          const endTime = new Date(market.endDate || market.endDateIso).getTime();
          if (endTime < now || endTime > now + 20 * 60 * 1000) continue;

          const outcomes = JSON.parse(market.outcomes || '[]');
          const prices = JSON.parse(market.outcomePrices || '[]');
          const tokenIds = JSON.parse(market.clobTokenIds || '[]');

          if (outcomes.length < 2 || tokenIds.length < 2) continue;

          let upTokenId = '', downTokenId = '';
          let upPrice = 0.5, downPrice = 0.5;

          for (let i = 0; i < outcomes.length; i++) {
            const outcome = outcomes[i].toLowerCase();
            if (outcome === 'up') {
              upTokenId = tokenIds[i];
              upPrice = parseFloat(prices[i] || '0.5');
            } else if (outcome === 'down') {
              downTokenId = tokenIds[i];
              downPrice = parseFloat(prices[i] || '0.5');
            }
          }

          if (!upTokenId || !downTokenId) continue;

          // Update existing or create new
          const existing = this.markets.get(slug);
          if (existing) {
            existing.upPrice = upPrice;
            existing.downPrice = downPrice;
            existing.lastUpdate = now;
          } else {
            this.markets.set(slug, {
              slug,
              title: market.question || market.title,
              coin: crypto.toUpperCase(),
              upPrice,
              downPrice,
              upTokenId,
              downTokenId,
              endTime,
              lastUpdate: now,
              lastTradeTime: 0,
              totalSpent: 0,
              currentSide: null,
              shares: 0
            });

            const remainingSecs = Math.round((endTime - now) / 1000);
            // Extract time range from title
            const title = market.question || market.title || '';
            const timeMatch = title.match(/(\w+\s+\d+),?\s+(\d+:\d+[AP]M)-(\d+:\d+[AP]M)\s*ET/i);
            const timeRange = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}-${timeMatch[3]} ET` : '';

            console.log(`   ${C.green}✅ ${crypto.toUpperCase()}${C.reset}: ${timeRange}`);
            console.log(`      Slug: ${slug}`);
            console.log(`      UP: ${(upPrice * 100).toFixed(0)}¢ | DOWN: ${(downPrice * 100).toFixed(0)}¢ | ${remainingSecs}s left`);

            // Log market discovery to period file
            const marketState = this.markets.get(slug)!;
            this.logToPeriod(marketState, `=== MARKET DISCOVERED === ${timeRange} | Slug: ${slug}`);
            this.logToPeriod(marketState, `Initial: UP:${(upPrice * 100).toFixed(0)}¢ DOWN:${(downPrice * 100).toFixed(0)}¢ | ${remainingSecs}s left`);
          }

          foundMarket = true;
        } catch {
          continue;
        }
      }

      if (!foundMarket) {
        console.log(`   ${C.dim}⚠️  ${crypto.toUpperCase()}: No active market${C.reset}`);
      }
    }

    // Clean expired
    for (const [slug, market] of this.markets) {
      if (market.endTime < now) {
        console.log(`   ${C.dim}🗑️  Expired: ${slug}${C.reset}`);
        this.markets.delete(slug);
      }
    }

    console.log(`[${getTime()}] 📊 Tracking ${this.markets.size} market(s)\n`);
  }

  /**
   * Connect to RTDS WebSocket
   */
  private connectWebSocket(): void {
    console.log(`[${getTime()}] 🔌 Connecting to RTDS WebSocket...`);

    this.ws = new WebSocket(CONFIG.rtdsWsUrl);

    this.ws.on('open', () => {
      console.log(`[${getTime()}] ✅ WebSocket connected`);
      this.isConnected = true;

      // Subscribe to activity trades
      this.ws!.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{ topic: 'activity', type: 'trades' }]
      }));
      console.log(`[${getTime()}] 📡 Subscribed to trade feed\n`);

      // Start ping keepalive (every 5 seconds)
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 5000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleTradeMessage(msg);
      } catch {
        // Ignore
      }
    });

    this.ws.on('close', () => {
      console.log(`[${getTime()}] ⚠️ WebSocket closed`);
      this.isConnected = false;
      this.stopPing();

      if (this.running) {
        console.log(`[${getTime()}] 🔄 Reconnecting in 1s...`);
        setTimeout(() => this.connectWebSocket(), 1000);
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[${getTime()}] ❌ WebSocket error: ${err.message}`);
    });
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Handle trade message from RTDS
   */
  private handleTradeMessage(msg: any): void {
    if (msg.topic !== 'activity' || msg.type !== 'trades') return;

    const payload = msg.payload;
    if (!payload?.slug || !payload?.price || !payload?.outcome) return;

    // Check if this is one of our markets
    const market = this.markets.get(payload.slug);
    if (!market) return;

    // Update price
    const newPrice = parseFloat(payload.price);
    const outcome = payload.outcome.toLowerCase();

    if (outcome === 'up') {
      market.upPrice = newPrice;
      market.downPrice = 1 - newPrice;
    } else if (outcome === 'down') {
      market.downPrice = newPrice;
      market.upPrice = 1 - newPrice;
    }
    market.lastUpdate = Date.now();

    // Evaluate trade opportunity
    this.evaluateAndTrade(market);
  }

  /**
   * Evaluate market and potentially trade
   *
   * Phase 1 (4-3 dk): 82¢+ al, <80¢ olursa dur
   * Phase 2 (3-1 dk): 85¢+ doldur ($30'a kadar)
   * Phase 3 (<1 dk):  90¢+ unlimited al
   */
  private async evaluateAndTrade(market: MarketState): Promise<void> {
    const now = Date.now();
    const remainingSeconds = Math.floor((market.endTime - now) / 1000);
    const { upPrice, downPrice, totalSpent, coin } = market;
    const time = getTime();

    // Timing check
    if (remainingSeconds > CONFIG.entryWindowStart || remainingSeconds < CONFIG.entryWindowEnd) {
      return;
    }

    // Determine winner
    const upIsWinner = upPrice > downPrice;
    const winnerSide: 'Up' | 'Down' = upIsWinner ? 'Up' : 'Down';
    const winnerPrice = upIsWinner ? upPrice : downPrice;
    const winnerTokenId = upIsWinner ? market.upTokenId : market.downTokenId;

    // Determine phase and price requirements
    let phase: 1 | 2 | 3;
    let minPrice: number;
    let maxSpend: number;

    if (remainingSeconds > CONFIG.phase2Start) {
      // Phase 1: 4-3 dk kala
      phase = 1;
      minPrice = CONFIG.phase1MinPrice; // 82¢
      maxSpend = CONFIG.maxTotalPerMarket; // $30

      // Phase 1 special: stop if price drops below 80¢
      if (winnerPrice < CONFIG.phase1StopPrice) {
        return;
      }
    } else if (remainingSeconds > CONFIG.phase3Start) {
      // Phase 2: 3-1 dk kala
      phase = 2;
      minPrice = CONFIG.phase2MinPrice; // 85¢
      maxSpend = CONFIG.maxTotalPerMarket; // $30
    } else {
      // Phase 3: <1 dk kala - UNLIMITED
      phase = 3;
      minPrice = CONFIG.phase3MinPrice; // 90¢
      maxSpend = CONFIG.phase3MaxPerMarket; // $100 (no real limit)
    }

    // Price check for current phase
    if (winnerPrice < minPrice) {
      return;
    }

    // Cooldown check (Phase 3 = 100ms, others = 2s)
    const cooldown = phase === 3 ? CONFIG.phase3CooldownMs : CONFIG.tradeCooldownMs;
    if (market.lastTradeTime > 0 && (now - market.lastTradeTime) < cooldown) {
      return;
    }

    // Flip check
    if (market.currentSide && market.currentSide !== winnerSide) {
      console.log(`[${time}] ${C.yellow}⚠️ ${coin} FLIP! ${market.currentSide} → ${winnerSide}. STOP.${C.reset}`);
      return;
    }

    // Limit check (phase 3 has higher limit)
    if (totalSpent >= maxSpend) {
      return;
    }

    // Execute trade
    const tradeAmount = Math.min(CONFIG.perTradeAmount, maxSpend - totalSpent);
    const shares = tradeAmount / winnerPrice;
    const profit = (1 - winnerPrice) * tradeAmount;
    const roi = ((1 - winnerPrice) / winnerPrice) * 100;
    const phaseEmoji = phase === 1 ? '1️⃣' : phase === 2 ? '2️⃣' : '🚀'; // Phase indicator

    const color = winnerSide === 'Up' ? C.green : C.red;
    const limitStr = phase === 3 ? '∞' : `$${maxSpend}`;
    const tradeLog = `${phaseEmoji} ${winnerSide} @ ${(winnerPrice * 100).toFixed(0)}¢ | $${tradeAmount} → ${shares.toFixed(2)} sh | +$${profit.toFixed(2)} (${roi.toFixed(0)}%) | ${remainingSeconds}s | $${(totalSpent + tradeAmount).toFixed(0)}/${limitStr}`;
    console.log(`[${time}] ${color}${tradeLog}${C.reset}`);

    // Log trade to period file
    this.logToPeriod(market, tradeLog);

    market.lastTradeTime = now;

    if (CONFIG.dryRun) {
      market.totalSpent += tradeAmount;
      market.currentSide = winnerSide;
      market.shares += shares;
      this.stats.tradesExecuted++;
      this.stats.totalSpent += tradeAmount;
      this.stats.expectedProfit += profit;
    } else {
      try {
        const order = await this.client!.createMarketOrder({
          tokenID: winnerTokenId,
          amount: tradeAmount,
          side: Side.BUY
        });

        const response = await this.client!.postOrder(order, OrderType.FOK);
        console.log(`         ${C.green}✅ ${response.orderID?.slice(0, 12)}...${C.reset}`);

        market.totalSpent += tradeAmount;
        market.currentSide = winnerSide;
        market.shares += shares;
        this.stats.tradesExecuted++;
        this.stats.totalSpent += tradeAmount;
        this.stats.expectedProfit += profit;

        // Track position for auto-claim
        if (this.autoClaimer) {
          await this.autoClaimer.addPosition(
            winnerTokenId,
            winnerSide,
            shares,
            winnerPrice,
            market.slug,
            market.title
          );
        }
      } catch (error: any) {
        console.log(`         ${C.red}❌ ${error.message}${C.reset}`);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.stopPing();

    if (this.marketRefreshTimer) {
      clearInterval(this.marketRefreshTimer);
    }

    if (this.pricePollingTimer) {
      clearInterval(this.pricePollingTimer);
    }

    if (this.ws) {
      this.ws.close();
    }

    // Stop auto-claimer
    if (this.autoClaimer) {
      this.autoClaimer.stop();
    }

    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}📊 SESSION STATS${C.reset}`);
    console.log('='.repeat(60));
    console.log(`   Markets: ${this.markets.size}`);
    console.log(`   Trades: ${this.stats.tradesExecuted}`);
    console.log(`   Spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log(`   Profit: $${this.stats.expectedProfit.toFixed(2)}`);

    if (this.stats.totalSpent > 0) {
      console.log(`   ROI: ${((this.stats.expectedProfit / this.stats.totalSpent) * 100).toFixed(1)}%`);
    }

    if (this.markets.size > 0) {
      console.log('\n   Positions:');
      for (const m of this.markets.values()) {
        if (m.totalSpent > 0) {
          console.log(`   - ${m.coin} ${m.currentSide}: ${m.shares.toFixed(2)} sh ($${m.totalSpent.toFixed(2)})`);
        }
      }
    }

    // Show auto-claimer summary
    if (this.autoClaimer) {
      const summary = this.autoClaimer.getSummary();
      console.log(`\n   Auto-Claimer: ${summary.claimed}/${summary.total} claimed, ${summary.pending} pending`);
    }

    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new SniperBot();

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
