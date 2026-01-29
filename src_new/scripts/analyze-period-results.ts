#!/usr/bin/env npx ts-node
/**
 * PERIOD RESULTS ANALYZER
 *
 * Analyzes whale trades with period outcomes to calculate:
 * - Which whale trades won/lost
 * - Actual profit/loss per trade
 * - Best entry prices
 * - Optimal timing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const LOG_FILE = path.join(__dirname, '../../data/whale-debug/whale_debug_2026-01-29.log');

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
  remainingSec: number;
  isAligned: boolean;
}

interface PeriodResult {
  slug: string;
  coin: string;
  priceToBeat: number;
  finalPrice: number;
  priceDiffPct: number;
  winner: 'Up' | 'Down';
}

interface TradeWithResult extends WhaleTrade {
  won: boolean;
  profit: number;  // For BUY: won ? (1/price - 1) * usdcValue : -usdcValue
  returnPct: number;
}

async function parseLogFile(): Promise<{ trades: WhaleTrade[]; results: PeriodResult[] }> {
  const trades: WhaleTrade[] = [];
  const results: PeriodResult[] = [];

  const fileStream = fs.createReadStream(LOG_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      if (line.includes('WHALE_TRADE:')) {
        const jsonStr = line.split('WHALE_TRADE: ')[1];
        if (jsonStr) {
          const trade = JSON.parse(jsonStr) as WhaleTrade;
          trades.push(trade);
        }
      } else if (line.includes('PERIOD_RESULT:')) {
        const jsonStr = line.split('PERIOD_RESULT: ')[1];
        if (jsonStr) {
          const result = JSON.parse(jsonStr) as PeriodResult;
          results.push(result);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { trades, results };
}

function analyzeResults(trades: WhaleTrade[], results: PeriodResult[]): void {
  // Create result lookup by slug
  const resultBySlug = new Map<string, PeriodResult>();
  for (const result of results) {
    resultBySlug.set(result.slug, result);
  }

  console.log('=' .repeat(70));
  console.log('  WHALE TRADE RESULTS ANALYSIS');
  console.log('=' .repeat(70));
  console.log(`\nTotal trades: ${trades.length}`);
  console.log(`Periods with results: ${results.length}\n`);

  // Match trades with results
  const tradesWithResults: TradeWithResult[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const trade of trades) {
    const result = resultBySlug.get(trade.slug);
    if (!result) {
      unmatchedCount++;
      continue;
    }
    matchedCount++;

    const won = trade.side === 'BUY'
      ? trade.outcome === result.winner
      : trade.outcome !== result.winner;

    // Calculate profit
    let profit = 0;
    let returnPct = 0;

    if (trade.side === 'BUY') {
      if (won) {
        // Won: get $1 per token, paid price per token
        // Profit = (1 - price) * size = size - usdcValue
        profit = trade.size - trade.usdcValue;
        returnPct = ((1 / trade.price) - 1) * 100;
      } else {
        // Lost: tokens worth $0
        profit = -trade.usdcValue;
        returnPct = -100;
      }
    } else {
      // SELL logic (less common)
      if (won) {
        profit = trade.usdcValue; // Kept the money
        returnPct = 0;
      } else {
        profit = -trade.size + trade.usdcValue; // Lost potential
        returnPct = -((1 - trade.price) / trade.price) * 100;
      }
    }

    tradesWithResults.push({
      ...trade,
      won,
      profit,
      returnPct
    });
  }

  console.log(`Matched with results: ${matchedCount}`);
  console.log(`No result yet: ${unmatchedCount}\n`);

  if (tradesWithResults.length === 0) {
    console.log('No trades with results yet. Keep collecting data!');
    return;
  }

  // Analyze by whale
  console.log('-'.repeat(40));
  console.log('BY WHALE:');
  console.log('-'.repeat(40));

  for (const whale of ['Whale-A', 'Whale-B']) {
    const whaleTrades = tradesWithResults.filter(t => t.whale === whale && t.side === 'BUY');
    if (whaleTrades.length === 0) continue;

    const wins = whaleTrades.filter(t => t.won).length;
    const losses = whaleTrades.filter(t => !t.won).length;
    const winRate = (wins / whaleTrades.length) * 100;
    const totalProfit = whaleTrades.reduce((s, t) => s + t.profit, 0);
    const totalInvested = whaleTrades.reduce((s, t) => s + t.usdcValue, 0);
    const roi = (totalProfit / totalInvested) * 100;

    console.log(`\n${whale}:`);
    console.log(`  Trades: ${whaleTrades.length}`);
    console.log(`  Wins: ${wins} | Losses: ${losses}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total Invested: $${totalInvested.toFixed(2)}`);
    console.log(`  Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`  ROI: ${roi.toFixed(1)}%`);
  }

  // Analyze by price range
  console.log('\n' + '-'.repeat(40));
  console.log('BY ENTRY PRICE (BUY only):');
  console.log('-'.repeat(40));

  const priceRanges = [
    { name: '0-20¢ (ucuz)', min: 0, max: 0.20 },
    { name: '20-40¢', min: 0.20, max: 0.40 },
    { name: '40-60¢', min: 0.40, max: 0.60 },
    { name: '60-80¢', min: 0.60, max: 0.80 },
    { name: '80-100¢ (pahalı)', min: 0.80, max: 1.00 }
  ];

  for (const range of priceRanges) {
    const rangeTrades = tradesWithResults.filter(t =>
      t.side === 'BUY' && t.price >= range.min && t.price < range.max
    );
    if (rangeTrades.length === 0) continue;

    const wins = rangeTrades.filter(t => t.won).length;
    const winRate = (wins / rangeTrades.length) * 100;
    const totalProfit = rangeTrades.reduce((s, t) => s + t.profit, 0);
    const avgReturn = rangeTrades.reduce((s, t) => s + t.returnPct, 0) / rangeTrades.length;

    console.log(`\n${range.name}:`);
    console.log(`  Trades: ${rangeTrades.length}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`  Avg Return when Win: ${avgReturn > 0 ? '+' : ''}${avgReturn.toFixed(1)}%`);
  }

  // Analyze by remaining time
  console.log('\n' + '-'.repeat(40));
  console.log('BY TIMING (BUY only):');
  console.log('-'.repeat(40));

  const timeRanges = [
    { name: 'Early (>5min)', min: 300, max: 9999 },
    { name: 'Mid (2-5min)', min: 120, max: 300 },
    { name: 'Late (30s-2min)', min: 30, max: 120 },
    { name: 'Final (<30s)', min: 0, max: 30 }
  ];

  for (const range of timeRanges) {
    const rangeTrades = tradesWithResults.filter(t =>
      t.side === 'BUY' && t.remainingSec >= range.min && t.remainingSec < range.max
    );
    if (rangeTrades.length === 0) continue;

    const wins = rangeTrades.filter(t => t.won).length;
    const winRate = (wins / rangeTrades.length) * 100;
    const totalProfit = rangeTrades.reduce((s, t) => s + t.profit, 0);

    console.log(`\n${range.name}:`);
    console.log(`  Trades: ${rangeTrades.length}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total Profit: $${totalProfit.toFixed(2)}`);
  }

  // Aligned vs Contrary
  console.log('\n' + '-'.repeat(40));
  console.log('ALIGNED vs CONTRARY (BUY only):');
  console.log('-'.repeat(40));

  const alignedTrades = tradesWithResults.filter(t => t.side === 'BUY' && t.isAligned);
  const contraryTrades = tradesWithResults.filter(t => t.side === 'BUY' && !t.isAligned);

  if (alignedTrades.length > 0) {
    const wins = alignedTrades.filter(t => t.won).length;
    const winRate = (wins / alignedTrades.length) * 100;
    const totalProfit = alignedTrades.reduce((s, t) => s + t.profit, 0);
    console.log(`\nAligned (with momentum):`);
    console.log(`  Trades: ${alignedTrades.length}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total Profit: $${totalProfit.toFixed(2)}`);
  }

  if (contraryTrades.length > 0) {
    const wins = contraryTrades.filter(t => t.won).length;
    const winRate = (wins / contraryTrades.length) * 100;
    const totalProfit = contraryTrades.reduce((s, t) => s + t.profit, 0);
    console.log(`\nContrary (against momentum):`);
    console.log(`  Trades: ${contraryTrades.length}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Total Profit: $${totalProfit.toFixed(2)}`);
  }

  // Best and worst trades
  console.log('\n' + '-'.repeat(40));
  console.log('TOP 5 BEST TRADES:');
  console.log('-'.repeat(40));

  const sortedByProfit = [...tradesWithResults].sort((a, b) => b.profit - a.profit);
  for (const trade of sortedByProfit.slice(0, 5)) {
    console.log(`  ${trade.whale} ${trade.coin} ${trade.outcome} @ ${(trade.price * 100).toFixed(0)}¢ → $${trade.profit.toFixed(2)} (${trade.won ? 'WON' : 'LOST'})`);
  }

  console.log('\n' + '-'.repeat(40));
  console.log('TOP 5 WORST TRADES:');
  console.log('-'.repeat(40));

  for (const trade of sortedByProfit.slice(-5).reverse()) {
    console.log(`  ${trade.whale} ${trade.coin} ${trade.outcome} @ ${(trade.price * 100).toFixed(0)}¢ → $${trade.profit.toFixed(2)} (${trade.won ? 'WON' : 'LOST'})`);
  }

  console.log('\n' + '=' .repeat(70));
}

async function main() {
  console.log('Loading data...\n');
  const { trades, results } = await parseLogFile();
  analyzeResults(trades, results);
}

main().catch(console.error);
