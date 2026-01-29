/**
 * BTC SMART TRADING BOT
 *
 * Gerçek BTC fiyatını takip eder, risk/reward analizi yapar.
 * Whale'i körü körüne kopyalamak yerine akıllı kararlar verir.
 *
 * Strateji:
 * - Binance'den gerçek BTC fiyatını al (WebSocket)
 * - Market strike fiyatını parse et
 * - Fiyat farkı + ticket fiyatına göre karar ver
 *
 * Usage:
 *   npx ts-node src_new/copy-trading/btc-smart-bot.ts --dry
 *   npx ts-node src_new/copy-trading/btc-smart-bot.ts --live
 */

import WebSocket from 'ws';
import axios from 'axios';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Risk parametreleri
  minPriceDistance: 100,      // Minimum $100 fark (strike'dan)
  maxTicketPrice: 0.75,       // Maximum 75¢ ticket fiyatı
  minTicketPrice: 0.10,       // Minimum 10¢ (çok düşük = çok riskli)

  // Scaling - fiyat farkına göre pozisyon büyüklüğü
  // $100 fark = 0.5x, $500 fark = 1x, $1000+ fark = 2x
  baseAmount: 5,              // Base pozisyon: $5

  // Dry run mode
  dryRun: !process.argv.includes('--live'),

  // Log level
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

// ============================================================================
// TYPES
// ============================================================================

interface BTCPrice {
  price: number;
  timestamp: number;
}

interface MarketInfo {
  title: string;
  slug: string;
  strikePrice: number;      // Market'in orta fiyatı (örn: 100000)
  startTime: Date;          // 15dk dilimin başlangıcı
  endTime: Date;            // 15dk dilimin bitişi
  upTokenId: string;
  downTokenId: string;
  upPrice: number;          // UP ticket fiyatı (0-1)
  downPrice: number;        // DOWN ticket fiyatı (0-1)
}

interface TradeDecision {
  action: 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
  reason: string;
  confidence: number;       // 0-100
  suggestedAmount: number;  // $
  riskReward: number;       // Ratio
}

// ============================================================================
// BTC PRICE TRACKER (Binance WebSocket)
// ============================================================================

class BTCPriceTracker {
  private ws: WebSocket | null = null;
  private currentPrice: number = 0;
  private lastUpdate: number = 0;
  private priceHistory: BTCPrice[] = [];
  private onPriceUpdate: ((price: number) => void) | null = null;

  async start(): Promise<void> {
    console.log('📡 Binance BTC price tracker starting...');

    // İlk fiyatı REST ile al
    await this.fetchInitialPrice();

    // WebSocket bağlantısı
    this.connectWebSocket();
  }

  private async fetchInitialPrice(): Promise<void> {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
        params: { symbol: 'BTCUSDT' }
      });
      this.currentPrice = parseFloat(response.data.price);
      this.lastUpdate = Date.now();
      console.log(`   ✅ Initial BTC price: $${this.currentPrice.toLocaleString()}`);
    } catch (error: any) {
      console.error(`   ❌ Failed to fetch initial price: ${error.message}`);
    }
  }

  private connectWebSocket(): void {
    const wsUrl = 'wss://stream.binance.com:9443/ws/btcusdt@trade';

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('   ✅ Binance WebSocket connected');
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const trade = JSON.parse(data.toString());
        const price = parseFloat(trade.p);

        this.currentPrice = price;
        this.lastUpdate = Date.now();

        // Keep last 100 prices for trend analysis
        this.priceHistory.push({ price, timestamp: Date.now() });
        if (this.priceHistory.length > 100) {
          this.priceHistory.shift();
        }

        if (this.onPriceUpdate) {
          this.onPriceUpdate(price);
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    this.ws.on('close', () => {
      console.log('   ⚠️ Binance WebSocket closed, reconnecting...');
      setTimeout(() => this.connectWebSocket(), 1000);
    });

    this.ws.on('error', (err) => {
      console.error(`   ❌ Binance WebSocket error: ${err.message}`);
    });
  }

  getPrice(): number {
    return this.currentPrice;
  }

  getLastUpdate(): number {
    return this.lastUpdate;
  }

  // Son X saniyedeki trend (UP/DOWN/FLAT)
  getTrend(seconds: number = 30): 'UP' | 'DOWN' | 'FLAT' {
    const cutoff = Date.now() - (seconds * 1000);
    const recentPrices = this.priceHistory.filter(p => p.timestamp > cutoff);

    if (recentPrices.length < 2) return 'FLAT';

    const first = recentPrices[0].price;
    const last = recentPrices[recentPrices.length - 1].price;
    const change = last - first;

    if (change > 10) return 'UP';
    if (change < -10) return 'DOWN';
    return 'FLAT';
  }

  setOnPriceUpdate(callback: (price: number) => void): void {
    this.onPriceUpdate = callback;
  }

  stop(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// ============================================================================
// MARKET PARSER
// ============================================================================

/**
 * Parse strike price from market title
 * "Bitcoin Up or Down - January 28, 1:00AM-1:15AM ET"
 * Strike fiyat title'da yok, API'den almamız lazım
 */
function parseMarketTitle(title: string): { coin: string; timeSlot: string } | null {
  // "Bitcoin Up or Down - January 28, 1:00AM-1:15AM ET"
  const match = title.match(/^(\w+)\s+Up or Down\s+-\s+(\w+\s+\d+),?\s+(\d{1,2}:\d{2}(?:AM|PM))-(\d{1,2}:\d{2}(?:AM|PM))/i);

  if (!match) return null;

  const [, coin, date, startTime, endTime] = match;
  return {
    coin: coin.toUpperCase(),
    timeSlot: `${date} ${startTime}-${endTime}`
  };
}

/**
 * Fetch current 15-min BTC market from Polymarket
 */
async function fetchCurrentBTCMarket(): Promise<MarketInfo | null> {
  try {
    // Polymarket Gamma API - BTC Up/Down markets
    const response = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        slug_contains: 'btc-updown-15m',
        active: true,
        _limit: 5,
        _sort: 'startDate:desc'
      }
    });

    const events = response.data;
    if (!events || events.length === 0) {
      console.log('   ⚠️ No active BTC 15m markets found');
      return null;
    }

    // En güncel market
    const event = events[0];
    const market = event.markets?.[0];

    if (!market) {
      console.log('   ⚠️ No market data in event');
      return null;
    }

    // Parse token IDs
    const tokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;

    // Parse prices
    const outcomePrices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices;

    // outcomes: ["Up", "Down"]
    const outcomes = typeof market.outcomes === 'string'
      ? JSON.parse(market.outcomes)
      : market.outcomes;

    // Strike price - description'dan parse et
    // Örnek: "Will Bitcoin be above or below $100,000 at 1:15AM ET?"
    const strikeMatch = market.question?.match(/\$?([\d,]+)/);
    const strikePrice = strikeMatch
      ? parseFloat(strikeMatch[1].replace(/,/g, ''))
      : 0;

    const upIndex = outcomes.indexOf('Up');
    const downIndex = outcomes.indexOf('Down');

    return {
      title: event.title,
      slug: event.slug,
      strikePrice: strikePrice,
      startTime: new Date(event.startDate),
      endTime: new Date(event.endDate),
      upTokenId: tokenIds[upIndex] || tokenIds[0],
      downTokenId: tokenIds[downIndex] || tokenIds[1],
      upPrice: parseFloat(outcomePrices[upIndex] || '0.5'),
      downPrice: parseFloat(outcomePrices[downIndex] || '0.5')
    };

  } catch (error: any) {
    console.error(`   ❌ Failed to fetch BTC market: ${error.message}`);
    return null;
  }
}

// ============================================================================
// SMART DECISION ENGINE
// ============================================================================

function makeTradeDecision(
  btcPrice: number,
  market: MarketInfo,
  trend: 'UP' | 'DOWN' | 'FLAT'
): TradeDecision {
  const priceDistance = btcPrice - market.strikePrice;
  const absDistance = Math.abs(priceDistance);

  // Base decision factors
  const btcAboveStrike = priceDistance > 0;
  const upTicketPrice = market.upPrice;
  const downTicketPrice = market.downPrice;

  // ============================================================
  // RULE 1: Minimum distance check
  // ============================================================
  if (absDistance < CONFIG.minPriceDistance) {
    return {
      action: 'SKIP',
      reason: `BTC sadece $${absDistance.toFixed(0)} uzakta (min: $${CONFIG.minPriceDistance})`,
      confidence: 0,
      suggestedAmount: 0,
      riskReward: 0
    };
  }

  // ============================================================
  // RULE 2: Price direction + ticket price check
  // ============================================================

  if (btcAboveStrike) {
    // BTC strike'ın üstünde → UP kazanır
    // UP ticket'ın fiyatı makul mü?

    if (upTicketPrice > CONFIG.maxTicketPrice) {
      return {
        action: 'SKIP',
        reason: `UP ticket çok pahalı: ${(upTicketPrice * 100).toFixed(0)}¢ (max: ${(CONFIG.maxTicketPrice * 100).toFixed(0)}¢)`,
        confidence: 0,
        suggestedAmount: 0,
        riskReward: 0
      };
    }

    if (upTicketPrice < CONFIG.minTicketPrice) {
      return {
        action: 'SKIP',
        reason: `UP ticket çok ucuz: ${(upTicketPrice * 100).toFixed(0)}¢ - muhtemelen kayıp pozisyon`,
        confidence: 0,
        suggestedAmount: 0,
        riskReward: 0
      };
    }

    // Risk/Reward hesabı
    // Eğer UP kazanırsa: 1 - upTicketPrice kar
    // Eğer kaybedersek: upTicketPrice zarar
    const potentialProfit = 1 - upTicketPrice;
    const potentialLoss = upTicketPrice;
    const riskReward = potentialProfit / potentialLoss;

    // Confidence: fiyat farkı + trend
    let confidence = Math.min(100, (absDistance / 10)); // Her $10 = 1% confidence
    if (trend === 'UP') confidence += 15;  // Trend bizim tarafımızda
    if (trend === 'DOWN') confidence -= 10; // Trend ters

    // Amount scaling: fiyat farkına göre
    let amountMultiplier = 1;
    if (absDistance >= 1000) amountMultiplier = 2;
    else if (absDistance >= 500) amountMultiplier = 1.5;
    else if (absDistance < 200) amountMultiplier = 0.5;

    const suggestedAmount = CONFIG.baseAmount * amountMultiplier;

    return {
      action: 'BUY_UP',
      reason: `BTC $${priceDistance.toFixed(0)} üstte, UP ${(upTicketPrice * 100).toFixed(0)}¢, R/R: ${riskReward.toFixed(2)}`,
      confidence: Math.round(confidence),
      suggestedAmount,
      riskReward
    };

  } else {
    // BTC strike'ın altında → DOWN kazanır

    if (downTicketPrice > CONFIG.maxTicketPrice) {
      return {
        action: 'SKIP',
        reason: `DOWN ticket çok pahalı: ${(downTicketPrice * 100).toFixed(0)}¢ (max: ${(CONFIG.maxTicketPrice * 100).toFixed(0)}¢)`,
        confidence: 0,
        suggestedAmount: 0,
        riskReward: 0
      };
    }

    if (downTicketPrice < CONFIG.minTicketPrice) {
      return {
        action: 'SKIP',
        reason: `DOWN ticket çok ucuz: ${(downTicketPrice * 100).toFixed(0)}¢ - muhtemelen kayıp pozisyon`,
        confidence: 0,
        suggestedAmount: 0,
        riskReward: 0
      };
    }

    const potentialProfit = 1 - downTicketPrice;
    const potentialLoss = downTicketPrice;
    const riskReward = potentialProfit / potentialLoss;

    let confidence = Math.min(100, (absDistance / 10));
    if (trend === 'DOWN') confidence += 15;
    if (trend === 'UP') confidence -= 10;

    let amountMultiplier = 1;
    if (absDistance >= 1000) amountMultiplier = 2;
    else if (absDistance >= 500) amountMultiplier = 1.5;
    else if (absDistance < 200) amountMultiplier = 0.5;

    const suggestedAmount = CONFIG.baseAmount * amountMultiplier;

    return {
      action: 'BUY_DOWN',
      reason: `BTC $${Math.abs(priceDistance).toFixed(0)} altta, DOWN ${(downTicketPrice * 100).toFixed(0)}¢, R/R: ${riskReward.toFixed(2)}`,
      confidence: Math.round(confidence),
      suggestedAmount,
      riskReward
    };
  }
}

// ============================================================================
// COLORS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

// ============================================================================
// MAIN BOT
// ============================================================================

class BTCSmartBot {
  private priceTracker: BTCPriceTracker;
  private currentMarket: MarketInfo | null = null;
  private lastDecision: TradeDecision | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private marketRefreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.priceTracker = new BTCPriceTracker();
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   BTC SMART TRADING BOT');
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Min Distance: $${CONFIG.minPriceDistance}`);
    console.log(`   Max Ticket: ${(CONFIG.maxTicketPrice * 100).toFixed(0)}¢`);
    console.log(`   Base Amount: $${CONFIG.baseAmount}`);
    console.log('='.repeat(60) + '\n');

    // Start BTC price tracking
    await this.priceTracker.start();

    // Fetch initial market
    await this.refreshMarket();

    // Update market every 30 seconds
    this.marketRefreshInterval = setInterval(() => {
      this.refreshMarket();
    }, 30000);

    // Main analysis loop - every 5 seconds
    this.updateInterval = setInterval(() => {
      this.analyze();
    }, 5000);

    console.log('\n🚀 Bot started. Analyzing every 5 seconds...\n');
  }

  private async refreshMarket(): Promise<void> {
    const market = await fetchCurrentBTCMarket();
    if (market) {
      this.currentMarket = market;
      const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      console.log(`[${now}] 📊 Market: ${market.title}`);
      console.log(`         Strike: $${market.strikePrice.toLocaleString()} | UP: ${(market.upPrice * 100).toFixed(0)}¢ | DOWN: ${(market.downPrice * 100).toFixed(0)}¢`);
    }
  }

  private analyze(): void {
    if (!this.currentMarket) {
      return;
    }

    const btcPrice = this.priceTracker.getPrice();
    if (btcPrice === 0) {
      return;
    }

    const trend = this.priceTracker.getTrend(30);
    const decision = makeTradeDecision(btcPrice, this.currentMarket, trend);

    const now = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
    const priceDistance = btcPrice - this.currentMarket.strikePrice;
    const distanceStr = priceDistance >= 0 ? `+$${priceDistance.toFixed(0)}` : `-$${Math.abs(priceDistance).toFixed(0)}`;

    // Color based on position
    let color = COLORS.dim;
    if (decision.action === 'BUY_UP') color = COLORS.green;
    else if (decision.action === 'BUY_DOWN') color = COLORS.red;

    // Compact output
    const actionEmoji = decision.action === 'BUY_UP' ? '🟢' : decision.action === 'BUY_DOWN' ? '🔴' : '⏸️';
    const trendEmoji = trend === 'UP' ? '📈' : trend === 'DOWN' ? '📉' : '➡️';

    console.log(`[${now}] BTC: $${btcPrice.toLocaleString()} (${distanceStr}) ${trendEmoji} | ${actionEmoji} ${color}${decision.action}${COLORS.reset} | ${decision.reason}`);

    // If action changed, highlight it
    if (this.lastDecision?.action !== decision.action && decision.action !== 'SKIP') {
      console.log(`         ${color}💡 Öneri: $${decision.suggestedAmount.toFixed(2)} | Confidence: ${decision.confidence}% | R/R: ${decision.riskReward.toFixed(2)}${COLORS.reset}`);

      if (!CONFIG.dryRun) {
        // TODO: Execute trade
        console.log(`         🚀 EXECUTING TRADE...`);
      }
    }

    this.lastDecision = decision;
  }

  stop(): void {
    console.log('\n🛑 Stopping bot...');

    if (this.updateInterval) clearInterval(this.updateInterval);
    if (this.marketRefreshInterval) clearInterval(this.marketRefreshInterval);
    this.priceTracker.stop();

    console.log('   ✅ Bot stopped\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new BTCSmartBot();

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
