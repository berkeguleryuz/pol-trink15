/**
 * Market Scanner & Auto-Tracker
 * Trending marketleri tarar ve akıllı tracking stratejisine göre takibe alır
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { MarketDataFetcher } from '../utils/market-data-fetcher-v2';
import { MarketRegistry } from '../database/market-registry';
import { SmartTrackingStrategy } from '../strategies/smart-tracking';

async function scanAndTrack() {
  console.log('🚀 Starting Market Scanner & Auto-Tracker...\n');

  const fetcher = new MarketDataFetcher();
  const registry = new MarketRegistry();
  const strategy = new SmartTrackingStrategy();

  try {
    // 1. Trending marketleri al (top 50)
    console.log('📊 Fetching trending markets from Polymarket...');
    const markets = await fetcher.getTrendingMarkets(50);
    console.log(`✅ Found ${markets.length} trending markets\n`);

    // 2. Registry'ye kaydet
    console.log('💾 Registering markets to database...');
    let registered = 0;
    for (const market of markets) {
      const success = registry.registerMarket({
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        tokens: [
          { tokenId: market.yesTokenId, outcome: 'Yes', currentPrice: market.yesPrice },
          { tokenId: market.noTokenId, outcome: 'No', currentPrice: market.noPrice },
        ],
        volume24hr: market.volume24hr,
        active: market.active,
        closed: market.closed,
        endDate: market.endDate, // ✅ Add end date
        tracking: false,
      });
      if (success) registered++;
    }
    console.log(`✅ Registered ${registered} new markets\n`);

    // 3. Tracking opportunities bul
    console.log('🔍 Analyzing tracking opportunities...\n');
    const opportunities = await strategy.scanForTrackingOpportunities();

    // 4. Auto-track yap
    console.log('\n📌 Auto-tracking selected markets...\n');
    let tracked = 0;
    for (const market of opportunities) {
      const success = await strategy.autoTrackMarket(market);
      if (success) {
        tracked++;
        console.log(`✅ Started tracking: ${market.question}`);
      }
    }

    console.log(`\n🎯 Successfully tracked ${tracked} markets\n`);

    // 5. Özet göster
    const stats = registry.getStats();
    console.log('📈 REGISTRY STATS:');
    console.log(`   Total Markets: ${stats.total}`);
    console.log(`   Active: ${stats.active}`);
    console.log(`   Tracked: ${stats.tracked}`);
    console.log(`   Untracked: ${stats.untracked}`);
    console.log(`   Closed: ${stats.closed}\n`);

    if (stats.categories && Object.keys(stats.categories).length > 0) {
      console.log('📊 By Category:');
      Object.entries(stats.categories).forEach(([cat, count]) => {
        console.log(`   ${cat}: ${count} markets`);
      });
    }

    console.log('\n✨ Scan complete!');
  } catch (error) {
    console.error('❌ Error during scan:', error);
    throw error;
  }
}

// Run
scanAndTrack().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
