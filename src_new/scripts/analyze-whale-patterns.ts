#!/usr/bin/env npx ts-node
/**
 * WHALE PATTERN ANALYZER
 *
 * Analyzes whale-debug logs to understand:
 * 1. Trade distributions (whale, side, outcome, coin)
 * 2. Price patterns (entry prices, aligned vs contrarian)
 * 3. Timing patterns (when do whales trade)
 * 4. Position building (accumulation patterns)
 * 5. Two-sided trading (hedging)
 *
 * Output: Per-coin folders + combined summary
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const LOG_FILE = path.join(__dirname, '../../data/whale-debug/whale_debug_2026-01-29.log');
const OUTPUT_DIR = path.join(__dirname, '../../data/whale-analysis');

interface WhaleTrade {
  timestamp: string;
  whale: string;
  coin: string;
  slug: string;
  side: 'BUY' | 'SELL';
  outcome: 'Up' | 'Down';
  size: number;
  price: number;
  usdcValue: number;
  priceToBeat: number;
  chainlinkPrice: number;
  priceDiffPct: number;
  isAligned: boolean;
  remainingSec: number;
  fillNumber: number;
  totalFilled: number;
}

interface PeriodStats {
  slug: string;
  coin: string;
  startTime: string;
  trades: WhaleTrade[];
  whaleA: { buys: WhaleTrade[]; sells: WhaleTrade[]; totalBuy: number; totalSell: number };
  whaleB: { buys: WhaleTrade[]; sells: WhaleTrade[]; totalBuy: number; totalSell: number };
  upTrades: WhaleTrade[];
  downTrades: WhaleTrade[];
  alignedCount: number;
  contraryCount: number;
  avgBuyPrice: { up: number; down: number };
  priceToBeat: number;
  finalChainlinkPrice: number;
  winner?: 'Up' | 'Down';
}

// Parse trades from log file
async function parseLogFile(): Promise<WhaleTrade[]> {
  const trades: WhaleTrade[] = [];

  const fileStream = fs.createReadStream(LOG_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.includes('WHALE_TRADE:')) continue;

    try {
      const jsonStr = line.split('WHALE_TRADE: ')[1];
      if (!jsonStr) continue;

      const trade = JSON.parse(jsonStr) as WhaleTrade;
      trades.push(trade);
    } catch {
      // Skip malformed lines
    }
  }

  return trades;
}

// Group trades by period (slug)
function groupByPeriod(trades: WhaleTrade[]): Map<string, PeriodStats> {
  const periods = new Map<string, PeriodStats>();

  for (const trade of trades) {
    if (!trade.slug) continue;

    let period = periods.get(trade.slug);
    if (!period) {
      period = {
        slug: trade.slug,
        coin: trade.coin,
        startTime: trade.timestamp,
        trades: [],
        whaleA: { buys: [], sells: [], totalBuy: 0, totalSell: 0 },
        whaleB: { buys: [], sells: [], totalBuy: 0, totalSell: 0 },
        upTrades: [],
        downTrades: [],
        alignedCount: 0,
        contraryCount: 0,
        avgBuyPrice: { up: 0, down: 0 },
        priceToBeat: trade.priceToBeat,
        finalChainlinkPrice: trade.chainlinkPrice
      };
      periods.set(trade.slug, period);
    }

    period.trades.push(trade);

    // Update final chainlink price
    if (trade.chainlinkPrice > 0) {
      period.finalChainlinkPrice = trade.chainlinkPrice;
    }

    // Track by whale
    const whaleStats = trade.whale === 'Whale-A' ? period.whaleA : period.whaleB;
    if (trade.side === 'BUY') {
      whaleStats.buys.push(trade);
      whaleStats.totalBuy += trade.usdcValue;
    } else {
      whaleStats.sells.push(trade);
      whaleStats.totalSell += trade.usdcValue;
    }

    // Track by outcome
    if (trade.outcome === 'Up') {
      period.upTrades.push(trade);
    } else {
      period.downTrades.push(trade);
    }

    // Track alignment
    if (trade.isAligned) {
      period.alignedCount++;
    } else {
      period.contraryCount++;
    }
  }

  // Calculate averages and winner
  for (const period of periods.values()) {
    const upBuys = period.upTrades.filter(t => t.side === 'BUY');
    const downBuys = period.downTrades.filter(t => t.side === 'BUY');

    if (upBuys.length > 0) {
      period.avgBuyPrice.up = upBuys.reduce((sum, t) => sum + t.price, 0) / upBuys.length;
    }
    if (downBuys.length > 0) {
      period.avgBuyPrice.down = downBuys.reduce((sum, t) => sum + t.price, 0) / downBuys.length;
    }

    // Determine winner based on final price vs priceToBeat
    if (period.priceToBeat > 0 && period.finalChainlinkPrice > 0) {
      period.winner = period.finalChainlinkPrice >= period.priceToBeat ? 'Up' : 'Down';
    }
  }

  return periods;
}

// Analyze patterns
function analyzePatterns(periods: Map<string, PeriodStats>): any {
  const stats = {
    totalPeriods: periods.size,
    byCoin: {} as Record<string, {
      periods: number;
      totalTrades: number;
      whaleATrades: number;
      whaleBTrades: number;
      buyTrades: number;
      sellTrades: number;
      upTrades: number;
      downTrades: number;
      alignedTrades: number;
      contraryTrades: number;
      avgUpBuyPrice: number;
      avgDownBuyPrice: number;
      twoSidedPeriods: number;  // Both Up and Down bought
      hedgingPatterns: any[];
    }>,
    twoSidedTrades: [] as any[],  // When whale buys both Up AND Down
    highConvictionTrades: [] as any[],  // Price > 0.85
    lateSurgeTrades: [] as any[],  // < 45s remaining, big size
    whaleATotal: { trades: 0, buyValue: 0, sellValue: 0 },
    whaleBTotal: { trades: 0, buyValue: 0, sellValue: 0 }
  };

  for (const period of periods.values()) {
    const coin = period.coin;

    if (!stats.byCoin[coin]) {
      stats.byCoin[coin] = {
        periods: 0,
        totalTrades: 0,
        whaleATrades: 0,
        whaleBTrades: 0,
        buyTrades: 0,
        sellTrades: 0,
        upTrades: 0,
        downTrades: 0,
        alignedTrades: 0,
        contraryTrades: 0,
        avgUpBuyPrice: 0,
        avgDownBuyPrice: 0,
        twoSidedPeriods: 0,
        hedgingPatterns: []
      };
    }

    const coinStats = stats.byCoin[coin];
    coinStats.periods++;
    coinStats.totalTrades += period.trades.length;
    coinStats.whaleATrades += period.whaleA.buys.length + period.whaleA.sells.length;
    coinStats.whaleBTrades += period.whaleB.buys.length + period.whaleB.sells.length;
    coinStats.buyTrades += period.upTrades.filter(t => t.side === 'BUY').length + period.downTrades.filter(t => t.side === 'BUY').length;
    coinStats.sellTrades += period.upTrades.filter(t => t.side === 'SELL').length + period.downTrades.filter(t => t.side === 'SELL').length;
    coinStats.upTrades += period.upTrades.length;
    coinStats.downTrades += period.downTrades.length;
    coinStats.alignedTrades += period.alignedCount;
    coinStats.contraryTrades += period.contraryCount;

    // Total whale stats
    stats.whaleATotal.trades += period.whaleA.buys.length + period.whaleA.sells.length;
    stats.whaleATotal.buyValue += period.whaleA.totalBuy;
    stats.whaleATotal.sellValue += period.whaleA.totalSell;
    stats.whaleBTotal.trades += period.whaleB.buys.length + period.whaleB.sells.length;
    stats.whaleBTotal.buyValue += period.whaleB.totalBuy;
    stats.whaleBTotal.sellValue += period.whaleB.totalSell;

    // Check for two-sided trading (hedging)
    const whaleABoughtUp = period.whaleA.buys.some(t => t.outcome === 'Up');
    const whaleABoughtDown = period.whaleA.buys.some(t => t.outcome === 'Down');
    const whaleBBoughtUp = period.whaleB.buys.some(t => t.outcome === 'Up');
    const whaleBBoughtDown = period.whaleB.buys.some(t => t.outcome === 'Down');

    if ((whaleABoughtUp && whaleABoughtDown) || (whaleBBoughtUp && whaleBBoughtDown)) {
      coinStats.twoSidedPeriods++;

      // Record hedging pattern
      const hedgeInfo = {
        slug: period.slug,
        timestamp: period.startTime,
        whaleA: {
          boughtUp: whaleABoughtUp,
          boughtDown: whaleABoughtDown,
          upValue: period.whaleA.buys.filter(t => t.outcome === 'Up').reduce((s, t) => s + t.usdcValue, 0),
          downValue: period.whaleA.buys.filter(t => t.outcome === 'Down').reduce((s, t) => s + t.usdcValue, 0)
        },
        whaleB: {
          boughtUp: whaleBBoughtUp,
          boughtDown: whaleBBoughtDown,
          upValue: period.whaleB.buys.filter(t => t.outcome === 'Up').reduce((s, t) => s + t.usdcValue, 0),
          downValue: period.whaleB.buys.filter(t => t.outcome === 'Down').reduce((s, t) => s + t.usdcValue, 0)
        },
        winner: period.winner
      };

      coinStats.hedgingPatterns.push(hedgeInfo);
      stats.twoSidedTrades.push(hedgeInfo);
    }

    // High conviction trades (price > 0.85)
    for (const trade of period.trades) {
      if (trade.side === 'BUY' && trade.price >= 0.85) {
        stats.highConvictionTrades.push({
          timestamp: trade.timestamp,
          whale: trade.whale,
          coin: trade.coin,
          outcome: trade.outcome,
          price: trade.price,
          usdcValue: trade.usdcValue,
          remainingSec: trade.remainingSec,
          isAligned: trade.isAligned,
          periodWinner: period.winner
        });
      }

      // Late surge (< 45s, > $30)
      if (trade.side === 'BUY' && trade.remainingSec <= 45 && trade.remainingSec >= 0 && trade.usdcValue >= 30) {
        stats.lateSurgeTrades.push({
          timestamp: trade.timestamp,
          whale: trade.whale,
          coin: trade.coin,
          outcome: trade.outcome,
          price: trade.price,
          usdcValue: trade.usdcValue,
          remainingSec: trade.remainingSec,
          isAligned: trade.isAligned,
          periodWinner: period.winner
        });
      }
    }
  }

  // Calculate averages
  for (const coin in stats.byCoin) {
    const cs = stats.byCoin[coin];
    if (cs.upTrades > 0) {
      cs.avgUpBuyPrice /= cs.periods;
    }
    if (cs.downTrades > 0) {
      cs.avgDownBuyPrice /= cs.periods;
    }
  }

  return stats;
}

// Generate reports
function generateReports(
  trades: WhaleTrade[],
  periods: Map<string, PeriodStats>,
  stats: any
): void {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Create per-coin directories
  const coins = ['BTC', 'ETH', 'SOL', 'XRP'];
  for (const coin of coins) {
    const coinDir = path.join(OUTPUT_DIR, coin.toLowerCase());
    if (!fs.existsSync(coinDir)) {
      fs.mkdirSync(coinDir, { recursive: true });
    }

    // Write coin-specific period files
    const coinPeriods = Array.from(periods.values()).filter(p => p.coin === coin);
    for (const period of coinPeriods) {
      const periodFile = path.join(coinDir, `${period.slug}.json`);
      fs.writeFileSync(periodFile, JSON.stringify(period, null, 2));
    }

    // Write coin summary
    const coinSummary = {
      coin,
      stats: stats.byCoin[coin] || {},
      periodCount: coinPeriods.length,
      totalTrades: coinPeriods.reduce((s, p) => s + p.trades.length, 0),
      hedgingPatterns: stats.byCoin[coin]?.hedgingPatterns || []
    };
    fs.writeFileSync(
      path.join(coinDir, '_summary.json'),
      JSON.stringify(coinSummary, null, 2)
    );
  }

  // Write combined summary
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '_combined_summary.json'),
    JSON.stringify(stats, null, 2)
  );

  // Write human-readable report
  const report = generateTextReport(stats);
  fs.writeFileSync(path.join(OUTPUT_DIR, '_report.txt'), report);

  console.log(report);
}

// Generate human-readable report
function generateTextReport(stats: any): string {
  const lines: string[] = [];

  lines.push('=' .repeat(70));
  lines.push('  WHALE PATTERN ANALYSIS REPORT');
  lines.push('  Generated: ' + new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }));
  lines.push('=' .repeat(70));
  lines.push('');

  lines.push('## GENEL İSTATİSTİKLER');
  lines.push('-'.repeat(40));
  lines.push(`Toplam Period Sayısı: ${stats.totalPeriods}`);
  lines.push('');

  lines.push('## WHALE KARŞILAŞTIRMASI');
  lines.push('-'.repeat(40));
  lines.push(`Whale-A: ${stats.whaleATotal.trades} trade`);
  lines.push(`  - Buy Value: $${stats.whaleATotal.buyValue.toFixed(2)}`);
  lines.push(`  - Sell Value: $${stats.whaleATotal.sellValue.toFixed(2)}`);
  lines.push(`Whale-B: ${stats.whaleBTotal.trades} trade`);
  lines.push(`  - Buy Value: $${stats.whaleBTotal.buyValue.toFixed(2)}`);
  lines.push(`  - Sell Value: $${stats.whaleBTotal.sellValue.toFixed(2)}`);
  lines.push('');

  lines.push('## COİN BAZINDA ANALİZ');
  lines.push('-'.repeat(40));
  for (const coin of ['BTC', 'ETH', 'SOL', 'XRP']) {
    const cs = stats.byCoin[coin];
    if (!cs) continue;

    lines.push(`\n### ${coin}`);
    lines.push(`  Periods: ${cs.periods}`);
    lines.push(`  Total Trades: ${cs.totalTrades}`);
    lines.push(`  BUY: ${cs.buyTrades} | SELL: ${cs.sellTrades}`);
    lines.push(`  UP: ${cs.upTrades} | DOWN: ${cs.downTrades}`);
    lines.push(`  Aligned: ${cs.alignedTrades} | Contrary: ${cs.contraryTrades}`);
    lines.push(`  Two-Sided Periods: ${cs.twoSidedPeriods} (hedging)`);
  }
  lines.push('');

  lines.push('## YÜKSEK GÜVEN TRADELERİ (85¢+)');
  lines.push('-'.repeat(40));
  lines.push(`Toplam: ${stats.highConvictionTrades.length}`);

  // Win rate for high conviction
  const hcWins = stats.highConvictionTrades.filter((t: any) => t.outcome === t.periodWinner).length;
  const hcWinRate = stats.highConvictionTrades.length > 0
    ? ((hcWins / stats.highConvictionTrades.length) * 100).toFixed(1)
    : 0;
  lines.push(`Kazanma Oranı: ${hcWinRate}%`);
  lines.push('');

  lines.push('## GEÇ GİRİŞ TRADELERİ (< 45s, > $30)');
  lines.push('-'.repeat(40));
  lines.push(`Toplam: ${stats.lateSurgeTrades.length}`);

  const lsWins = stats.lateSurgeTrades.filter((t: any) => t.outcome === t.periodWinner).length;
  const lsWinRate = stats.lateSurgeTrades.length > 0
    ? ((lsWins / stats.lateSurgeTrades.length) * 100).toFixed(1)
    : 0;
  lines.push(`Kazanma Oranı: ${lsWinRate}%`);
  lines.push('');

  lines.push('## HEDGİNG PATTERN\'LERİ (İki Taraflı Alım)');
  lines.push('-'.repeat(40));
  lines.push(`Toplam Period: ${stats.twoSidedTrades.length}`);
  lines.push('');

  // Sample hedging patterns
  lines.push('Örnek Hedging Pattern\'leri (ilk 5):');
  for (const hedge of stats.twoSidedTrades.slice(0, 5)) {
    lines.push(`  ${hedge.slug}:`);
    if (hedge.whaleA.boughtUp && hedge.whaleA.boughtDown) {
      lines.push(`    Whale-A: UP $${hedge.whaleA.upValue.toFixed(2)} + DOWN $${hedge.whaleA.downValue.toFixed(2)}`);
    }
    if (hedge.whaleB.boughtUp && hedge.whaleB.boughtDown) {
      lines.push(`    Whale-B: UP $${hedge.whaleB.upValue.toFixed(2)} + DOWN $${hedge.whaleB.downValue.toFixed(2)}`);
    }
    lines.push(`    Winner: ${hedge.winner || '?'}`);
  }

  lines.push('');
  lines.push('=' .repeat(70));

  return lines.join('\n');
}

// Main
async function main() {
  console.log('Parsing log file...');
  const trades = await parseLogFile();
  console.log(`Parsed ${trades.length} trades`);

  console.log('Grouping by period...');
  const periods = groupByPeriod(trades);
  console.log(`Found ${periods.size} periods`);

  console.log('Analyzing patterns...');
  const stats = analyzePatterns(periods);

  console.log('Generating reports...');
  generateReports(trades, periods, stats);

  console.log(`\nReports saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
