/**
 * SNIPER BOT - DRY RUN
 *
 * Polymarket CLOB WebSocket'ten ticket fiyatlarını izler.
 * Son dakika "kesin kazanan" stratejisi simülasyonu.
 *
 * Mantık:
 * - UP > 70¢ → BTC yukarıda, UP kazanacak
 * - DOWN > 70¢ → BTC aşağıda, DOWN kazanacak
 * - Fark < 60¢ → belirsiz, SKIP
 *
 * Usage:
 *   npx ts-node src_new/copy-trading/sniper-dry-run.ts
 */

import WebSocket from 'ws';
import axios from 'axios';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Entry thresholds
  minWinnerPrice: 0.65,       // Kazanan taraf en az 65¢ olmalı
  maxWinnerPrice: 0.92,       // Kazanan taraf en fazla 92¢ (min %8 kar)

  // Timing (saniye)
  entryWindowStart: 180,      // 3 dakika kala başla izlemeye
  entryWindowEnd: 30,         // 30 saniye kala dur

  // Trade
  tradeAmount: 10,            // $10 per trade

  // Polling
  pollIntervalMs: 500,        // 500ms = 0.5 saniye

  // Target market (BTC 15m)
  targetSlug: 'btc-updown-15m'
};

// ============================================================================
// TYPES
// ============================================================================

interface MarketState {
  slug: string;
  title: string;
  upPrice: number;
  downPrice: number;
  upTokenId: string;
  downTokenId: string;
  endTime: Date;
  lastUpdate: number;
}

interface SimulatedTrade {
  time: string;
  market: string;
  side: 'UP' | 'DOWN';
  entryPrice: number;
  expectedPayout: number;
  expectedProfit: number;
  roi: number;
  remainingSeconds: number;
}

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
  bold: '\x1b[1m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m'
};

// ============================================================================
// MARKET FETCHER
// ============================================================================

async function fetchActiveMarkets(): Promise<MarketState[]> {
  try {
    // Get series events
    const response = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        tag: 'bitcoin',
        active: true,
        closed: false,
        _limit: 20,
        _sort: 'endDate:asc'
      }
    });

    const markets: MarketState[] = [];

    for (const event of response.data) {
      if (!event.slug?.includes('btc-updown-15m')) continue;

      const market = event.markets?.[0];
      if (!market) continue;

      // Parse token IDs
      const tokenIds = typeof market.clobTokenIds === 'string'
        ? JSON.parse(market.clobTokenIds)
        : market.clobTokenIds;

      // Parse prices
      const prices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;

      markets.push({
        slug: event.slug,
        title: event.title,
        upPrice: parseFloat(prices[0]) || 0.5,
        downPrice: parseFloat(prices[1]) || 0.5,
        upTokenId: tokenIds[0] || '',
        downTokenId: tokenIds[1] || '',
        endTime: new Date(event.endDate),
        lastUpdate: Date.now()
      });
    }

    return markets;
  } catch (error: any) {
    console.error(`   ❌ Fetch error: ${error.message}`);
    return [];
  }
}

async function fetchOrderbookPrices(tokenId: string): Promise<{ bid: number; ask: number }> {
  try {
    const response = await axios.get('https://clob.polymarket.com/book', {
      params: { token_id: tokenId }
    });

    const { bids, asks } = response.data;
    const bestBid = bids?.[0]?.price ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks?.[0]?.price ? parseFloat(asks[0].price) : 1;

    return { bid: bestBid, ask: bestAsk };
  } catch {
    return { bid: 0, ask: 1 };
  }
}

// ============================================================================
// DECISION ENGINE
// ============================================================================

interface Decision {
  action: 'BUY_UP' | 'BUY_DOWN' | 'WAIT' | 'SKIP' | 'TOO_LATE';
  reason: string;
  side?: 'UP' | 'DOWN';
  price?: number;
  expectedProfit?: number;
}

function makeDecision(market: MarketState, remainingSeconds: number): Decision {
  const { upPrice, downPrice } = market;

  // Timing check
  if (remainingSeconds > CONFIG.entryWindowStart) {
    return {
      action: 'WAIT',
      reason: `${remainingSeconds}s kaldı, ${CONFIG.entryWindowStart}s'de başlayacak`
    };
  }

  if (remainingSeconds < CONFIG.entryWindowEnd) {
    return {
      action: 'TOO_LATE',
      reason: `Sadece ${remainingSeconds}s kaldı, çok geç`
    };
  }

  // Determine winner
  const upIsWinner = upPrice > downPrice;
  const winnerPrice = upIsWinner ? upPrice : downPrice;
  const winnerSide = upIsWinner ? 'UP' : 'DOWN';

  // Price checks
  if (winnerPrice < CONFIG.minWinnerPrice) {
    return {
      action: 'SKIP',
      reason: `Belirsiz: ${winnerSide} sadece ${(winnerPrice * 100).toFixed(0)}¢ (min: ${(CONFIG.minWinnerPrice * 100).toFixed(0)}¢)`
    };
  }

  if (winnerPrice > CONFIG.maxWinnerPrice) {
    return {
      action: 'SKIP',
      reason: `Çok pahalı: ${winnerSide} ${(winnerPrice * 100).toFixed(0)}¢ (max: ${(CONFIG.maxWinnerPrice * 100).toFixed(0)}¢)`
    };
  }

  // Good to go!
  const expectedProfit = (1 - winnerPrice) * CONFIG.tradeAmount;
  const roi = ((1 - winnerPrice) / winnerPrice) * 100;

  return {
    action: upIsWinner ? 'BUY_UP' : 'BUY_DOWN',
    reason: `${winnerSide} ${(winnerPrice * 100).toFixed(0)}¢ → $${expectedProfit.toFixed(2)} kar (${roi.toFixed(1)}% ROI)`,
    side: winnerSide,
    price: winnerPrice,
    expectedProfit
  };
}

// ============================================================================
// MAIN BOT
// ============================================================================

class SniperDryRun {
  private markets: Map<string, MarketState> = new Map();
  private simulatedTrades: SimulatedTrade[] = [];
  private activePosition: { slug: string; side: 'UP' | 'DOWN'; entryPrice: number } | null = null;
  private running = false;
  private stats = {
    opportunities: 0,
    skipped: 0,
    simTrades: 0,
    totalSimProfit: 0
  };

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}🎯 SNIPER BOT - DRY RUN${C.reset}`);
    console.log('='.repeat(60));
    console.log(`   Min Winner Price: ${(CONFIG.minWinnerPrice * 100).toFixed(0)}¢`);
    console.log(`   Max Winner Price: ${(CONFIG.maxWinnerPrice * 100).toFixed(0)}¢`);
    console.log(`   Entry Window: ${CONFIG.entryWindowStart}s - ${CONFIG.entryWindowEnd}s before end`);
    console.log(`   Poll Interval: ${CONFIG.pollIntervalMs}ms`);
    console.log(`   Trade Amount: $${CONFIG.tradeAmount}`);
    console.log('='.repeat(60) + '\n');

    console.log('🔍 Fetching active BTC markets...\n');
    await this.refreshMarkets();

    this.running = true;
    this.runLoop();
  }

  private async refreshMarkets(): Promise<void> {
    const newMarkets = await fetchActiveMarkets();

    for (const market of newMarkets) {
      this.markets.set(market.slug, market);
    }

    if (newMarkets.length > 0) {
      console.log(`   📊 Found ${newMarkets.length} active BTC markets`);
      for (const m of newMarkets.slice(0, 3)) {
        const remaining = Math.floor((m.endTime.getTime() - Date.now()) / 1000);
        console.log(`      - ${m.title} (${remaining}s remaining)`);
      }
      console.log('');
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      await this.tick();
      await this.sleep(CONFIG.pollIntervalMs);
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const timeStr = new Date().toLocaleTimeString('de-DE', { hour12: false });

    // Refresh markets every 30 seconds
    if (now % 30000 < CONFIG.pollIntervalMs) {
      await this.refreshMarkets();
    }

    // Check each market
    for (const [slug, market] of this.markets) {
      const remainingMs = market.endTime.getTime() - now;
      const remainingSeconds = Math.floor(remainingMs / 1000);

      // Skip if market ended
      if (remainingSeconds < 0) {
        this.markets.delete(slug);
        continue;
      }

      // Update prices from orderbook
      if (market.upTokenId) {
        const upBook = await fetchOrderbookPrices(market.upTokenId);
        market.upPrice = (upBook.bid + upBook.ask) / 2;
        market.downPrice = 1 - market.upPrice;
        market.lastUpdate = now;
      }

      // Make decision
      const decision = makeDecision(market, remainingSeconds);

      // Log based on action
      const upStr = `UP:${(market.upPrice * 100).toFixed(0)}¢`;
      const downStr = `DOWN:${(market.downPrice * 100).toFixed(0)}¢`;

      let actionColor = C.dim;
      let emoji = '⏳';

      if (decision.action === 'BUY_UP') { actionColor = C.green; emoji = '🟢'; }
      else if (decision.action === 'BUY_DOWN') { actionColor = C.red; emoji = '🔴'; }
      else if (decision.action === 'SKIP') { actionColor = C.yellow; emoji = '⏭️'; }
      else if (decision.action === 'TOO_LATE') { actionColor = C.dim; emoji = '⌛'; }

      // Only log interesting states (within entry window or actionable)
      if (remainingSeconds <= CONFIG.entryWindowStart || decision.action !== 'WAIT') {
        console.log(`[${timeStr}] ${remainingSeconds}s | ${upStr} ${downStr} | ${emoji} ${actionColor}${decision.action}${C.reset} | ${decision.reason}`);
      }

      // Simulate trade
      if ((decision.action === 'BUY_UP' || decision.action === 'BUY_DOWN') && !this.activePosition) {
        this.simulateTrade(market, decision, remainingSeconds);
      }

      // Check if our position should close (market ending)
      if (this.activePosition && this.activePosition.slug === slug && remainingSeconds < 5) {
        this.closePosition(market);
      }

      // Check stop-loss: if winner flipped to other side
      if (this.activePosition && this.activePosition.slug === slug) {
        const currentWinner = market.upPrice > market.downPrice ? 'UP' : 'DOWN';
        if (currentWinner !== this.activePosition.side) {
          console.log(`\n   ${C.bgRed}${C.bold} ⚠️ STOP LOSS: Winner flipped to ${currentWinner}! ${C.reset}`);
          this.closePosition(market, true);
        }
      }
    }
  }

  private simulateTrade(market: MarketState, decision: Decision, remainingSeconds: number): void {
    if (!decision.side || !decision.price) return;

    this.activePosition = {
      slug: market.slug,
      side: decision.side,
      entryPrice: decision.price
    };

    const trade: SimulatedTrade = {
      time: new Date().toLocaleTimeString('de-DE', { hour12: false }),
      market: market.title.split(' - ')[1] || market.slug,
      side: decision.side,
      entryPrice: decision.price,
      expectedPayout: CONFIG.tradeAmount / decision.price,
      expectedProfit: decision.expectedProfit || 0,
      roi: ((1 - decision.price) / decision.price) * 100,
      remainingSeconds
    };

    this.simulatedTrades.push(trade);
    this.stats.simTrades++;
    this.stats.totalSimProfit += trade.expectedProfit;

    console.log(`\n   ${C.bgGreen}${C.bold} 🎯 SIMULATED TRADE ${C.reset}`);
    console.log(`   ${C.green}Side: ${trade.side} @ ${(trade.entryPrice * 100).toFixed(0)}¢${C.reset}`);
    console.log(`   Amount: $${CONFIG.tradeAmount} → ${trade.expectedPayout.toFixed(2)} shares`);
    console.log(`   Expected: $${trade.expectedProfit.toFixed(2)} profit (${trade.roi.toFixed(1)}% ROI)`);
    console.log(`   Time left: ${remainingSeconds}s\n`);
  }

  private closePosition(market: MarketState, isStopLoss: boolean = false): void {
    if (!this.activePosition) return;

    const winner = market.upPrice > market.downPrice ? 'UP' : 'DOWN';
    const won = winner === this.activePosition.side;

    if (isStopLoss) {
      console.log(`   ${C.red}Position closed with STOP LOSS${C.reset}\n`);
    } else {
      const emoji = won ? '✅' : '❌';
      const color = won ? C.green : C.red;
      console.log(`\n   ${color}${emoji} Position closed: ${won ? 'WIN' : 'LOSS'} (Winner: ${winner})${C.reset}\n`);
    }

    this.activePosition = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    this.running = false;

    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}📊 DRY RUN SUMMARY${C.reset}`);
    console.log('='.repeat(60));
    console.log(`   Simulated trades: ${this.stats.simTrades}`);
    console.log(`   Total sim profit: $${this.stats.totalSimProfit.toFixed(2)}`);
    console.log('');

    if (this.simulatedTrades.length > 0) {
      console.log('   Recent trades:');
      for (const t of this.simulatedTrades.slice(-5)) {
        console.log(`   - [${t.time}] ${t.side} @ ${(t.entryPrice * 100).toFixed(0)}¢ → $${t.expectedProfit.toFixed(2)}`);
      }
    }

    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new SniperDryRun();

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
