/**
 * LAST MINUTE SNIPER BOT
 *
 * Son 2.5 dakika kala "kesin kazanan" tarafı alır.
 * Polymarket'ten gerçek zamanlı fiyat takibi yapar.
 *
 * Strateji:
 * - Current Price > Strike → UP kazanacak → UP al
 * - Current Price < Strike → DOWN kazanacak → DOWN al
 * - Fiyat farkı yeterli değilse SKIP
 *
 * Usage:
 *   npx ts-node src_new/copy-trading/last-minute-sniper.ts --dry
 *   npx ts-node src_new/copy-trading/last-minute-sniper.ts --live
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { PolymarketClientWrapper } from '../trading/polymarket-client';

const execAsync = promisify(exec);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Entry timing
  entrySecondsBeforeEnd: 150,  // 2.5 dakika = 150 saniye kala gir
  exitSecondsBeforeEnd: 30,    // 30 saniye kala çık (güvenlik)

  // Risk parametreleri
  minPriceDistance: 50,        // Minimum $50 fark (strike'dan)
  maxTicketPrice: 0.95,        // Maximum 95¢ (en az %5 kar)
  minTicketPrice: 0.50,        // Minimum 50¢ (çok ucuzsa şüpheli)

  // Position sizing
  tradeAmount: 10,             // Her trade $10

  // Stop loss
  stopLossDistance: 30,        // Strike'a $30 yaklaşırsa sat

  // Polling interval
  pollIntervalMs: 2000,        // Her 2 saniyede kontrol

  // Mode
  dryRun: !process.argv.includes('--live'),
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

// ============================================================================
// TYPES
// ============================================================================

interface MarketData {
  title: string;
  slug: string;
  strikePrice: number;
  currentPrice: number;
  priceDistance: number;      // current - strike
  upTicketPrice: number;
  downTicketPrice: number;
  remainingSeconds: number;
  upTokenId: string;
  downTokenId: string;
}

interface Position {
  side: 'UP' | 'DOWN';
  entryPrice: number;
  shares: number;
  entryTime: number;
  marketSlug: string;
}

// ============================================================================
// BROWSER SCRAPER
// ============================================================================

async function fetchMarketDataFromBrowser(marketSlug?: string): Promise<MarketData | null> {
  try {
    // Eğer slug verilmişse o marketi aç
    if (marketSlug) {
      await execAsync(`agent-browser open "https://polymarket.com/event/${marketSlug}" 2>/dev/null`);
      await sleep(2000);
    }

    // Snapshot al
    const { stdout: snapshot } = await execAsync(`agent-browser snapshot 2>/dev/null`);

    // Parse: price to beat (strike)
    const strikeMatch = snapshot.match(/price to beat \$([0-9,]+\.?\d*)/i);
    const strikePrice = strikeMatch
      ? parseFloat(strikeMatch[1].replace(/,/g, ''))
      : 0;

    // Parse: current price (animated, look for pattern)
    // "$ 9 0 , 0 3 7 . 9 4" → $90,037.94
    const currentMatch = snapshot.match(/\$ (\d(?: \d)*) , (\d(?: \d)*) \. (\d(?: \d)*)/);
    let currentPrice = 0;
    if (currentMatch) {
      const intPart = currentMatch[1].replace(/ /g, '') + currentMatch[2].replace(/ /g, '');
      const decPart = currentMatch[3].replace(/ /g, '');
      currentPrice = parseFloat(`${intPart}.${decPart}`);
    }

    // Fallback: direct price match
    if (currentPrice === 0) {
      const directMatch = snapshot.match(/current price.*?\$([0-9,]+\.?\d*)/i);
      if (directMatch) {
        currentPrice = parseFloat(directMatch[1].replace(/,/g, ''));
      }
    }

    // Parse: ticket prices "Up 94¢" "Down 7¢"
    const upMatch = snapshot.match(/Up (\d+)¢/i);
    const downMatch = snapshot.match(/Down (\d+)¢/i);
    const upTicketPrice = upMatch ? parseInt(upMatch[1]) / 100 : 0.5;
    const downTicketPrice = downMatch ? parseInt(downMatch[1]) / 100 : 0.5;

    // Parse: remaining time "MINS SECS"
    const timeMatch = snapshot.match(/(\d+)\s*MINS?\s*(\d+)\s*SECS?/i);
    const remainingSeconds = timeMatch
      ? parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])
      : 999;

    // Parse: title and slug
    const titleMatch = snapshot.match(/Bitcoin Up or Down - ([\w\s,:-]+ET)/i);
    const title = titleMatch ? `Bitcoin Up or Down - ${titleMatch[1]}` : 'Unknown';

    // Slug from URL (get from current page)
    const { stdout: urlOutput } = await execAsync(`agent-browser get url 2>/dev/null`);
    const slugMatch = urlOutput.match(/btc-updown-15m-\d+/);
    const slug = slugMatch ? slugMatch[0] : marketSlug || 'unknown';

    // Token IDs - API'den almamız lazım
    const tokenIds = await fetchTokenIds(slug);

    if (strikePrice === 0 || currentPrice === 0) {
      console.log('   ⚠️ Could not parse prices from page');
      return null;
    }

    return {
      title,
      slug,
      strikePrice,
      currentPrice,
      priceDistance: currentPrice - strikePrice,
      upTicketPrice,
      downTicketPrice,
      remainingSeconds,
      upTokenId: tokenIds.up,
      downTokenId: tokenIds.down
    };

  } catch (error: any) {
    console.error(`   ❌ Browser scrape error: ${error.message}`);
    return null;
  }
}

async function fetchTokenIds(slug: string): Promise<{ up: string; down: string }> {
  try {
    const { stdout } = await execAsync(
      `curl -s "https://gamma-api.polymarket.com/events?slug=${slug}&_limit=1" | jq -r '.[0].markets[0].clobTokenIds' 2>/dev/null`
    );
    const tokenIds = JSON.parse(stdout.trim());
    return {
      up: tokenIds[0],    // First token is usually "Up"
      down: tokenIds[1]   // Second token is "Down"
    };
  } catch {
    return { up: '', down: '' };
  }
}

// ============================================================================
// DECISION ENGINE
// ============================================================================

interface TradeDecision {
  action: 'BUY_UP' | 'BUY_DOWN' | 'WAIT' | 'SKIP';
  reason: string;
  expectedProfit: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

function makeDecision(market: MarketData): TradeDecision {
  const { priceDistance, upTicketPrice, downTicketPrice, remainingSeconds } = market;
  const absDistance = Math.abs(priceDistance);

  // ============================================================
  // TIMING CHECK
  // ============================================================
  if (remainingSeconds > CONFIG.entrySecondsBeforeEnd) {
    return {
      action: 'WAIT',
      reason: `${remainingSeconds}s kaldı, ${CONFIG.entrySecondsBeforeEnd}s kala girilecek`,
      expectedProfit: 0,
      riskLevel: 'LOW'
    };
  }

  if (remainingSeconds < CONFIG.exitSecondsBeforeEnd) {
    return {
      action: 'SKIP',
      reason: `Sadece ${remainingSeconds}s kaldı, çok geç`,
      expectedProfit: 0,
      riskLevel: 'HIGH'
    };
  }

  // ============================================================
  // DISTANCE CHECK
  // ============================================================
  if (absDistance < CONFIG.minPriceDistance) {
    return {
      action: 'SKIP',
      reason: `Fiyat farkı $${absDistance.toFixed(0)} (min: $${CONFIG.minPriceDistance})`,
      expectedProfit: 0,
      riskLevel: 'HIGH'
    };
  }

  // ============================================================
  // DIRECTION & PRICE CHECK
  // ============================================================
  const btcAboveStrike = priceDistance > 0;
  const winningTicketPrice = btcAboveStrike ? upTicketPrice : downTicketPrice;
  const winningDirection = btcAboveStrike ? 'UP' : 'DOWN';

  // Ticket too expensive?
  if (winningTicketPrice > CONFIG.maxTicketPrice) {
    return {
      action: 'SKIP',
      reason: `${winningDirection} ticket ${(winningTicketPrice * 100).toFixed(0)}¢ çok pahalı`,
      expectedProfit: 0,
      riskLevel: 'MEDIUM'
    };
  }

  // Ticket too cheap? (suspicious)
  if (winningTicketPrice < CONFIG.minTicketPrice) {
    return {
      action: 'SKIP',
      reason: `${winningDirection} ticket ${(winningTicketPrice * 100).toFixed(0)}¢ çok ucuz, şüpheli`,
      expectedProfit: 0,
      riskLevel: 'HIGH'
    };
  }

  // ============================================================
  // CALCULATE PROFIT
  // ============================================================
  const expectedProfit = (1 - winningTicketPrice) * CONFIG.tradeAmount;
  const roi = ((1 - winningTicketPrice) / winningTicketPrice) * 100;

  // Risk level based on distance
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (absDistance > 200) riskLevel = 'LOW';
  else if (absDistance < 100) riskLevel = 'HIGH';

  return {
    action: btcAboveStrike ? 'BUY_UP' : 'BUY_DOWN',
    reason: `BTC $${priceDistance >= 0 ? '+' : ''}${priceDistance.toFixed(0)} | ${winningDirection} ${(winningTicketPrice * 100).toFixed(0)}¢ | ROI: ${roi.toFixed(1)}%`,
    expectedProfit,
    riskLevel
  };
}

// ============================================================================
// TRADE EXECUTOR
// ============================================================================

class TradeExecutor {
  private client: ClobClient | null = null;

  async init(): Promise<void> {
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
      console.log('   ✅ Client ready\n');
    }
  }

  async buy(tokenId: string, amount: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
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

  async sell(tokenId: string, shares: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
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
}

// ============================================================================
// COLORS & UTILS
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
}

// ============================================================================
// MAIN BOT
// ============================================================================

class LastMinuteSniper {
  private executor: TradeExecutor;
  private currentPosition: Position | null = null;
  private running: boolean = false;
  private stats = {
    trades: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0
  };

  constructor() {
    this.executor = new TradeExecutor();
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   🎯 LAST MINUTE SNIPER BOT');
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Entry: ${CONFIG.entrySecondsBeforeEnd}s before end`);
    console.log(`   Min Distance: $${CONFIG.minPriceDistance}`);
    console.log(`   Trade Amount: $${CONFIG.tradeAmount}`);
    console.log(`   Max Ticket: ${(CONFIG.maxTicketPrice * 100).toFixed(0)}¢`);
    console.log('='.repeat(60) + '\n');

    await this.executor.init();

    // Open initial page
    console.log('🌐 Opening Polymarket BTC page...');
    await execAsync(`agent-browser open "https://polymarket.com/markets?_c=crypto-prices" 2>/dev/null`);
    await sleep(3000);

    // Find current active BTC market
    await this.findActiveBTCMarket();

    this.running = true;
    console.log('\n🚀 Sniper active! Monitoring...\n');

    // Main loop
    while (this.running) {
      await this.tick();
      await sleep(CONFIG.pollIntervalMs);
    }
  }

  private async findActiveBTCMarket(): Promise<void> {
    try {
      // BTC up or down sayfasını aç
      await execAsync(`agent-browser open "https://polymarket.com/event/btc-updown-15m-1769605200" 2>/dev/null`);
      await sleep(2000);

      // Aktif market butonlarını kontrol et
      const { stdout } = await execAsync(`agent-browser snapshot -i 2>/dev/null | grep -E "link.*AM.*ref" | head -5`);
      console.log('   📊 Available markets:', stdout.trim() || 'checking...');

    } catch (error: any) {
      console.log(`   ⚠️ Market search: ${error.message}`);
    }
  }

  private async tick(): Promise<void> {
    const time = formatTime();

    // Fetch current market data
    const market = await fetchMarketDataFromBrowser();

    if (!market) {
      console.log(`[${time}] ⚠️ Could not fetch market data`);
      return;
    }

    // Make decision
    const decision = makeDecision(market);

    // Color based on action
    let color = COLORS.dim;
    let emoji = '⏳';
    if (decision.action === 'BUY_UP') { color = COLORS.green; emoji = '🟢'; }
    else if (decision.action === 'BUY_DOWN') { color = COLORS.red; emoji = '🔴'; }
    else if (decision.action === 'SKIP') { color = COLORS.yellow; emoji = '⏭️'; }

    // Log status
    const distStr = market.priceDistance >= 0 ? `+$${market.priceDistance.toFixed(0)}` : `-$${Math.abs(market.priceDistance).toFixed(0)}`;
    console.log(`[${time}] BTC: $${market.currentPrice.toLocaleString()} (${distStr}) | ${market.remainingSeconds}s | UP: ${(market.upTicketPrice * 100).toFixed(0)}¢ DOWN: ${(market.downTicketPrice * 100).toFixed(0)}¢`);
    console.log(`         ${emoji} ${color}${decision.action}${COLORS.reset} | ${decision.reason}`);

    // Execute if action needed
    if (decision.action === 'BUY_UP' || decision.action === 'BUY_DOWN') {
      if (!this.currentPosition) {
        await this.executeEntry(market, decision);
      } else {
        // Check stop loss
        await this.checkStopLoss(market);
      }
    }

    // New market detection (remaining < 30s means market ending soon)
    if (market.remainingSeconds < 30 && this.currentPosition) {
      console.log(`\n   📊 Market ending! Position will resolve.\n`);
      this.currentPosition = null;
    }
  }

  private async executeEntry(market: MarketData, decision: TradeDecision): Promise<void> {
    const side = decision.action === 'BUY_UP' ? 'UP' : 'DOWN';
    const tokenId = side === 'UP' ? market.upTokenId : market.downTokenId;
    const ticketPrice = side === 'UP' ? market.upTicketPrice : market.downTicketPrice;

    console.log(`\n   ${COLORS.bold}🎯 EXECUTING: ${side} @ ${(ticketPrice * 100).toFixed(0)}¢${COLORS.reset}`);

    const result = await this.executor.buy(tokenId, CONFIG.tradeAmount);

    if (result.success) {
      const shares = CONFIG.tradeAmount / ticketPrice;
      this.currentPosition = {
        side,
        entryPrice: ticketPrice,
        shares,
        entryTime: Date.now(),
        marketSlug: market.slug
      };

      this.stats.trades++;
      console.log(`   ✅ Bought ${shares.toFixed(2)} shares | Order: ${result.orderId?.slice(0, 12)}...`);
      console.log(`   💰 Expected profit: $${decision.expectedProfit.toFixed(2)}\n`);
    } else {
      console.log(`   ❌ Buy failed: ${result.error}\n`);
    }
  }

  private async checkStopLoss(market: MarketData): Promise<void> {
    if (!this.currentPosition) return;

    const { priceDistance } = market;
    const absDistance = Math.abs(priceDistance);

    // Stop loss: price getting too close to strike
    if (absDistance < CONFIG.stopLossDistance) {
      console.log(`\n   ${COLORS.red}🛑 STOP LOSS: Price too close to strike ($${absDistance.toFixed(0)})${COLORS.reset}`);

      const tokenId = this.currentPosition.side === 'UP' ? market.upTokenId : market.downTokenId;
      const result = await this.executor.sell(tokenId, this.currentPosition.shares);

      if (result.success) {
        console.log(`   ✅ Sold position | Order: ${result.orderId?.slice(0, 12)}...`);
        this.stats.losses++;
      } else {
        console.log(`   ❌ Sell failed: ${result.error}`);
      }

      this.currentPosition = null;
    }
  }

  stop(): void {
    console.log('\n🛑 Stopping sniper...');
    this.running = false;

    console.log('\n' + '='.repeat(60));
    console.log('   📊 SESSION STATS');
    console.log('='.repeat(60));
    console.log(`   Total trades: ${this.stats.trades}`);
    console.log(`   Wins: ${this.stats.wins}`);
    console.log(`   Losses: ${this.stats.losses}`);
    console.log(`   Total profit: $${this.stats.totalProfit.toFixed(2)}`);
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new LastMinuteSniper();

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
