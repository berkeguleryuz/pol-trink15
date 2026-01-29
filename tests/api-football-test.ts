import { config } from 'dotenv';
import { resolve } from 'path';
import { APIFootballClient } from '../src/integrations/api-football';

// Load .env from project root
config({ path: resolve(__dirname, '../.env') });

/**
 * Test API-Football integration
 */

async function testAPIFootball() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`         🏆 API-FOOTBALL INTEGRATION TEST`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`🔑 FOOTBALL_API_KEY from .env: ${process.env.FOOTBALL_API_KEY ? 'FOUND' : 'NOT FOUND'}`);
  if (process.env.FOOTBALL_API_KEY) {
    console.log(`   Key preview: ${process.env.FOOTBALL_API_KEY.substring(0, 8)}...\n`);
  }

  const client = new APIFootballClient();

  // Test 1: Get live matches
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 1: Live Matches (IN PLAY NOW)`);
  console.log(`${'='.repeat(80)}\n`);

  const liveMatches = await client.getLiveMatches();
  
  if (liveMatches.length === 0) {
    console.log('⚠️  No live matches at the moment');
  } else {
    console.log(`\n✅ Found ${liveMatches.length} live matches:\n`);
    liveMatches.forEach(match => {
      console.log(`⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
      console.log(`   ${match.league} (${match.country})`);
      console.log(`   Status: ${match.status} | Minute: ${match.minute}'`);
      console.log(`   Fixture ID: ${match.fixtureId}\n`);
    });
  }

  // Test 2: Get fixtures starting soon
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Fixtures Starting in Next 30 Minutes`);
  console.log(`${'='.repeat(80)}\n`);

  const startingSoon = await client.getFixturesStartingSoon(30);
  
  if (startingSoon.length === 0) {
    console.log('⚠️  No matches starting in next 30 minutes');
  } else {
    console.log(`\n✅ Found ${startingSoon.length} upcoming kickoffs:\n`);
    startingSoon.forEach(fixture => {
      const kickoffTime = new Date(fixture.fixture.timestamp * 1000);
      const minutesUntil = Math.floor((kickoffTime.getTime() - Date.now()) / 60000);
      console.log(`⚽ ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
      console.log(`   ${fixture.league.name}`);
      console.log(`   Kickoff: ${kickoffTime.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Berlin time`);
      console.log(`   Starting in: ${minutesUntil} minutes`);
      console.log(`   Fixture ID: ${fixture.fixture.id}\n`);
    });
  }

  // Test 3: Get today's fixtures
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 3: Today's Fixtures`);
  console.log(`${'='.repeat(80)}\n`);

  const today = await client.getUpcomingFixtures();
  
  console.log(`\n📅 Found ${today.length} fixtures today\n`);
  
  // Show first 10
  const topFixtures = today.slice(0, 10);
  topFixtures.forEach(fixture => {
    const kickoffTime = new Date(fixture.fixture.timestamp * 1000);
    const status = fixture.fixture.status.short;
    const isLive = ['1H', '2H', 'ET'].includes(status);
    const icon = isLive ? '🔴' : '⚽';
    
    console.log(`${icon} ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
    console.log(`   ${fixture.league.name} | ${fixture.league.country}`);
    console.log(`   Time: ${kickoffTime.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} Berlin`);
    console.log(`   Status: ${status} ${isLive ? '(LIVE)' : ''}`);
    
    if (fixture.goals.home !== null && fixture.goals.away !== null) {
      console.log(`   Score: ${fixture.goals.home}-${fixture.goals.away}`);
    }
    
    console.log(`   Fixture ID: ${fixture.fixture.id}\n`);
  });

  if (today.length > 10) {
    console.log(`   ... and ${today.length - 10} more fixtures\n`);
  }

  // Test 4: Get odds for a match (if available)
  if (startingSoon.length > 0) {
    const fixtureId = startingSoon[0].fixture.id;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 4: Pre-Match Odds`);
    console.log(`${'='.repeat(80)}\n`);

    const odds = await client.getPreMatchOdds(fixtureId);
    
    if (odds) {
      console.log(`\n💰 Odds for ${odds.homeTeam} vs ${odds.awayTeam}\n`);
      console.log(`   Home Win: ${odds.odds.homeWin} (${(client.calculateImpliedProbability(odds.odds.homeWin) * 100).toFixed(1)}%)`);
      console.log(`   Draw: ${odds.odds.draw} (${(client.calculateImpliedProbability(odds.odds.draw) * 100).toFixed(1)}%)`);
      console.log(`   Away Win: ${odds.odds.awayWin} (${(client.calculateImpliedProbability(odds.odds.awayWin) * 100).toFixed(1)}%)`);
      console.log(`   Bookmaker: ${odds.odds.bookmaker}\n`);

      // Test odds comparison (simulate Polymarket prices)
      console.log(`\n📊 Testing Odds Comparison:\n`);
      
      const simulatedPolymarketPrices = {
        homeWin: 0.45, // 45%
        draw: 0.25,    // 25%
        awayWin: 0.30, // 30%
      };

      const recommendation = client.getPreMatchRecommendation(
        odds.odds,
        simulatedPolymarketPrices
      );

      if (recommendation.shouldTrade) {
        console.log(`   ✅ TRADING OPPORTUNITY DETECTED!\n`);
        recommendation.recommendations.forEach(rec => {
          console.log(`   📈 ${rec.position}`);
          console.log(`      Edge: +${rec.edge.toFixed(1)}%`);
          console.log(`      ${rec.reason}\n`);
        });
      } else {
        console.log(`   ⏸️  No significant edge detected (< 5% required)\n`);
      }
    }
  }

  // Print usage stats
  console.log(`\n${'='.repeat(80)}`);
  console.log(`API Usage Summary`);
  console.log(`${'='.repeat(80)}\n`);

  client.printUsage();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ ALL TESTS COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`\n💡 NEXT STEPS:\n`);
  console.log(`   1. Live Match Monitoring: Track goal events from API-Football`);
  console.log(`   2. Pre-Match Analysis: Compare bookmaker odds vs Polymarket`);
  console.log(`   3. Auto-Trading: Execute trades when edge > 5%`);
  console.log(`   4. Kickoff Detection: Switch from pre-match to live strategy\n`);
}

// Run test
testAPIFootball().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
