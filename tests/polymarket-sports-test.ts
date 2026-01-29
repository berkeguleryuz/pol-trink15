import { config } from 'dotenv';
import { resolve } from 'path';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

// Load .env
config({ path: resolve(__dirname, '../.env') });

/**
 * Test Polymarket Sports API
 * 
 * Gerçek Polymarket sports endpoints'lerinden veri çeker
 */

async function testPolymarketSports() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`         ⚽ POLYMARKET SPORTS API TEST`);
  console.log(`${'='.repeat(80)}\n`);

  const client = new PolymarketSportsClient();

  // Test 1: Tüm sports events'leri al
  console.log(`${'='.repeat(80)}`);
  console.log(`TEST 1: Fetch ALL Sports Events from Polymarket`);
  console.log(`${'='.repeat(80)}\n`);

  const allEvents = await client.getAllSportsEvents();

  if (allEvents.length === 0) {
    console.log(`\n⚠️  No sports events found. This could mean:`);
    console.log(`   1. No active matches right now`);
    console.log(`   2. API endpoint might be different`);
    console.log(`   3. Need to check Polymarket's actual API structure\n`);
    return;
  }

  // Test 2: Events'leri kategorize et
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Categorize Events (Live / Upcoming / Ended)`);
  console.log(`${'='.repeat(80)}\n`);

  const categorized = client.categorizeSportsEvents(allEvents);

  console.log(`📊 Categories:`);
  console.log(`   🔴 Live: ${categorized.live.length}`);
  console.log(`   ⏰ Upcoming: ${categorized.upcoming.length}`);
  console.log(`   ✅ Ended: ${categorized.ended.length}\n`);

  // Test 3: Live matches detayları
  if (categorized.live.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 3: Live Matches Detail`);
    console.log(`${'='.repeat(80)}`);

    categorized.live.slice(0, 5).forEach(event => {
      client.printEvent(event, true);
    });
  }

  // Test 4: Upcoming matches (yakında başlayacaklar)
  if (categorized.upcoming.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 4: Upcoming Matches (Next 24 Hours)`);
    console.log(`${'='.repeat(80)}`);

    const upcomingSoon = client.getUpcomingSoon(categorized.upcoming, 24 * 60); // 24 saat
    const sorted = client.sortByKickoff(upcomingSoon);

    sorted.slice(0, 10).forEach(event => {
      client.printEvent(event, true);
    });

    if (sorted.length > 10) {
      console.log(`\n   ... and ${sorted.length - 10} more upcoming matches\n`);
    }
  }

  // Test 5: Yakında başlayacaklar (60 dakika içinde)
  const upcomingSoon = client.getUpcomingSoon(categorized.upcoming, 60);
  
  if (upcomingSoon.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 5: Matches Starting in Next 60 Minutes`);
    console.log(`${'='.repeat(80)}\n`);

    upcomingSoon.forEach(event => {
      client.printEvent(event, true);
    });
  }

  // Test 6: Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 6: Overall Summary`);
  console.log(`${'='.repeat(80)}`);

  client.printSummary(allEvents);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ ALL TESTS COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`\n💡 KEY INSIGHTS:\n`);
  console.log(`   ✅ Total Sports Events: ${allEvents.length}`);
  console.log(`   🔴 Live Matches: ${categorized.live.length}`);
  console.log(`   ⏰ Upcoming (24h): ${client.getUpcomingSoon(categorized.upcoming, 24 * 60).length}`);
  console.log(`   ⏰ Starting Soon (60min): ${upcomingSoon.length}`);

  console.log(`\n🎯 NEXT STEPS:\n`);
  console.log(`   1. Match these events with API-Football for live data`);
  console.log(`   2. Track market prices for trading opportunities`);
  console.log(`   3. Set up alerts for matches starting soon`);
  console.log(`   4. Monitor live matches for goal events\n`);
}

// Run test
testPolymarketSports().catch(error => {
  console.error('\n❌ Test failed:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});
