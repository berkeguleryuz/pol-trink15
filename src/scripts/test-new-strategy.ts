/**
 * New Strategy Test
 * Yeni market entry + haber-driven trading stratejisi
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { SmartMarketEntry } from '../strategies/smart-entry';
import { NewsAggregator } from '../integrations/news-aggregator';
import { MarketRegistry } from '../database/market-registry';

async function testNewStrategy() {
  console.log('🚀 Testing New Trading Strategy\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const entry = new SmartMarketEntry();
  const news = new NewsAggregator();
  const registry = new MarketRegistry();

  // 1. New Market Entry Opportunities
  console.log('📊 PHASE 1: New Market Entry Scan');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Kriterleri:');
  console.log('  ✓ Fiyat <$0.10 (10 cent altında)');
  console.log('  ✓ 6+ gün kapanışa var');
  console.log('  ✓ YES veya NO tokenlarında\n');

  const entrySignals = await entry.scanNewMarketEntries();

  if (entrySignals.length > 0) {
    console.log(`\n✅ Found ${entrySignals.length} entry opportunities:\n`);
    entrySignals.slice(0, 10).forEach(signal => {
      entry.logEntrySignal(signal);
    });
  } else {
    console.log('\n⚠️  No entry opportunities found (prices may be too high)\n');
  }

  // 2. News-Driven Trading Signals
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📰 PHASE 2: News-Driven Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const trackedMarkets = registry.getTrackedMarkets();
  console.log(`Analyzing ${trackedMarkets.length} tracked markets...\n`);

  const newsSignals = await news.analyzeMultipleMarkets(trackedMarkets);

  if (newsSignals.length > 0) {
    console.log('\n✅ News-driven signals:\n');
    newsSignals.forEach(signal => {
      console.log(`📌 ${signal.market.question}`);
      console.log(`   Action: ${signal.action}`);
      console.log(`   Confidence: ${signal.confidence}`);
      console.log(`   Reason: ${signal.reason}`);
      if (signal.newsItems.length > 0) {
        console.log(`   Latest News:`);
        signal.newsItems.slice(0, 2).forEach(item => {
          console.log(`     • ${item.title}`);
        });
      }
      console.log('');
    });
  }

  // 3. Exit Signals (Take Profit / Stop Loss)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 PHASE 3: Exit Signal Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const exitSignals: any[] = [];
  for (const market of trackedMarkets) {
    const exitCheck = entry.checkExitSignal(market);
    if (exitCheck.shouldExit) {
      exitSignals.push({ market, ...exitCheck });
    }
  }

  if (exitSignals.length > 0) {
    console.log(`\n✅ Found ${exitSignals.length} exit signals:\n`);
    exitSignals.forEach(({ market, reason, profitPercent }) => {
      const emoji = profitPercent > 0 ? '🟢' : '🔴';
      console.log(`${emoji} ${market.question}`);
      console.log(`   Reason: ${reason}`);
      console.log(`   P&L: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(1)}%\n`);
    });
  } else {
    console.log('\n⚠️  No exit signals (all positions holding)\n');
  }

  // 4. Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STRATEGY SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Entry Opportunities: ${entrySignals.length}`);
  console.log(`News Signals: ${newsSignals.length}`);
  console.log(`Exit Signals: ${exitSignals.length}`);
  console.log(`Total Tracked Markets: ${trackedMarkets.length}\n`);

  console.log('✅ Strategy test complete!\n');
}

// Run
testNewStrategy().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
