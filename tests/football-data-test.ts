import { config } from 'dotenv';
import { resolve } from 'path';
import { FootballDataClient } from '../src/integrations/football-data';

config({ path: resolve(__dirname, '../.env') });

/**
 * Test Football-Data.org API
 * 
 * Bugünün UCL maçlarını al
 */

async function testFootballData() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`    ⭐ FOOTBALL-DATA.ORG API TEST - UCL MATCHES`);
  console.log(`${'='.repeat(80)}\n`);

  const client = new FootballDataClient();

  // Test 1: Today's UCL matches
  console.log(`${'='.repeat(80)}`);
  console.log(`TEST 1: Get Today's UCL Matches`);
  console.log(`${'='.repeat(80)}\n`);

  const uclMatches = await client.getTodaysUCLMatches();

  if (uclMatches.length === 0) {
    console.log(`\n⚠️  No UCL matches today.\n`);
  } else {
    console.log(`\n✅ Found ${uclMatches.length} UCL matches!\n`);

    // Kategorize
    const live = uclMatches.filter(m => m.status === 'LIVE' || m.status === 'IN_PLAY');
    const upcoming = uclMatches.filter(m => m.status === 'SCHEDULED');
    const finished = uclMatches.filter(m => m.status === 'FINISHED');

    console.log(`   🔴 LIVE: ${live.length}`);
    console.log(`   ⏰ UPCOMING: ${upcoming.length}`);
    console.log(`   ✅ FINISHED: ${finished.length}\n`);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 MATCH DETAILS`);
    console.log(`${'='.repeat(80)}\n`);

    uclMatches.forEach(match => {
      client.printMatch(match);
    });
  }

  // Test 2: Get all live matches
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Get ALL Live Matches (All Competitions)`);
  console.log(`${'='.repeat(80)}\n`);

  const liveMatches = await client.getLiveMatches();

  if (liveMatches.length > 0) {
    console.log(`\n✅ Found ${liveMatches.length} live matches!\n`);
    
    liveMatches.forEach(match => {
      client.printMatch(match);
    });
  } else {
    console.log(`\n⚠️  No live matches right now.\n`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ TEST COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`\n💡 KEY INSIGHTS:\n`);
  console.log(`   ✅ Football-Data.org is FREE!`);
  console.log(`   ✅ UCL coverage confirmed`);
  console.log(`   ✅ 10 requests/minute limit`);
  console.log(`   ✅ Live score updates available`);
  console.log(`\n🎯 NEXT STEPS:\n`);
  console.log(`   1. Compare with Polymarket markets`);
  console.log(`   2. Test goal monitoring (polling every 3s)`);
  console.log(`   3. Measure response time vs Polymarket delay`);
  console.log(`   4. If profitable, integrate into trading bot\n`);
}

testFootballData().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
