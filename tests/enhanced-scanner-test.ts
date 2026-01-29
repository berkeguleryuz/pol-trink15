import { config } from 'dotenv';
import { resolve } from 'path';
import { EnhancedSportsScanner } from '../src/strategies/enhanced-sports-scanner';

// Load .env
config({ path: resolve(__dirname, '../.env') });

/**
 * Test Enhanced Sports Scanner
 * 
 * Bu test:
 * 1. Polymarket'teki AÇIK spor marketlerini tarar
 * 2. API-Football ile eşleştirir
 * 3. Live ve upcoming matches ayırır
 * 4. Live odds tracking yapar
 */

async function testEnhancedScanner() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`         ⚽ ENHANCED SPORTS SCANNER TEST`);
  console.log(`${'='.repeat(80)}\n`);

  const scanner = new EnhancedSportsScanner();

  // Test 1: Polymarket sports markets tara
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 1: Scan Polymarket for Open Sports Markets`);
  console.log(`${'='.repeat(80)}\n`);

  const polymarkets = await scanner.scanPolymarketSportsMarkets();
  
  if (polymarkets.length > 0) {
    console.log(`\n📊 Found ${polymarkets.length} Polymarket Sports Markets:\n`);
    
    // İlk 10 market göster
    polymarkets.slice(0, 10).forEach((market, idx) => {
      console.log(`${idx + 1}. ${market.question}`);
      console.log(`   Category: ${market.category}`);
      console.log(`   Type: ${market.matchType}`);
      if (market.homeTeam && market.awayTeam) {
        console.log(`   Teams: ${market.homeTeam} vs ${market.awayTeam}`);
      }
      if (market.league) {
        console.log(`   League: ${market.league}`);
      }
      console.log(`   Volume: $${(market.volume / 1000).toFixed(1)}K`);
      console.log(`   Liquidity: $${(market.liquidity / 1000).toFixed(1)}K`);
      console.log(`   End Date: ${market.endDate.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n`);
    });

    if (polymarkets.length > 10) {
      console.log(`   ... and ${polymarkets.length - 10} more markets\n`);
    }
  }

  // Test 2: API-Football ile eşleştir
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Match with API-Football`);
  console.log(`${'='.repeat(80)}\n`);

  const mappings = await scanner.matchWithAPIFootball(polymarkets);

  const matched = mappings.filter(m => m.confidence > 0);
  const live = mappings.filter(m => m.isLive);
  const upcoming = mappings.filter(m => !m.isLive && m.apiFootballFixtureId);
  const unmatched = mappings.filter(m => m.confidence === 0);

  console.log(`\n📊 MATCHING RESULTS:\n`);
  console.log(`   Total Markets: ${polymarkets.length}`);
  console.log(`   Successfully Matched: ${matched.length}`);
  console.log(`   Live Matches: ${live.length}`);
  console.log(`   Upcoming Matches: ${upcoming.length}`);
  console.log(`   Unmatched: ${unmatched.length}\n`);

  // Test 3: Live matches detayları
  if (live.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 3: Live Matches Detail`);
    console.log(`${'='.repeat(80)}\n`);

    for (const mapping of live.slice(0, 5)) {
      console.log(`\n🔴 LIVE MATCH:\n`);
      console.log(`Polymarket Market:`);
      console.log(`   ${mapping.polymarketMarket.question}`);
      console.log(`   Volume: $${(mapping.polymarketMarket.volume / 1000).toFixed(1)}K`);
      
      mapping.polymarketMarket.tokens.forEach(token => {
        console.log(`   ${token.outcome}: ${(token.price * 100).toFixed(1)}%`);
      });

      if (mapping.apiFootballMatch) {
        console.log(`\nAPI-Football Data:`);
        console.log(`   ${mapping.apiFootballMatch.homeTeam} ${mapping.apiFootballMatch.homeScore}-${mapping.apiFootballMatch.awayScore} ${mapping.apiFootballMatch.awayTeam}`);
        console.log(`   League: ${mapping.apiFootballMatch.league}`);
        console.log(`   Status: ${mapping.apiFootballMatch.status} | Minute: ${mapping.apiFootballMatch.minute}'`);
        console.log(`   Fixture ID: ${mapping.apiFootballMatch.fixtureId}`);
      }

      console.log(`\nMatch Confidence: ${mapping.confidence}%\n`);
      console.log(`${'='.repeat(60)}`);
    }
  }

  // Test 4: Upcoming matches
  if (upcoming.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 4: Upcoming Matches`);
    console.log(`${'='.repeat(80)}\n`);

    upcoming.slice(0, 5).forEach(mapping => {
      console.log(`⏰ ${mapping.polymarketMarket.homeTeam} vs ${mapping.polymarketMarket.awayTeam}`);
      console.log(`   Polymarket: ${mapping.polymarketMarket.question}`);
      console.log(`   Fixture ID: ${mapping.apiFootballFixtureId}`);
      console.log(`   Confidence: ${mapping.confidence}%\n`);
    });
  }

  // Test 5: Status summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 5: Scanner Status`);
  console.log(`${'='.repeat(80)}\n`);

  scanner.printStatus();

  // Test 6: Live odds tracking (eğer live match varsa)
  if (live.length > 0 && live[0].apiFootballFixtureId) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`TEST 6: Live Odds Tracking`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`Testing live odds for: ${live[0].polymarketMarket.question}\n`);
    await scanner.trackLiveOdds(live[0].apiFootballFixtureId);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ ALL TESTS COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`\n💡 KEY INSIGHTS:\n`);
  console.log(`   ✅ Polymarket has ${polymarkets.length} open sports markets`);
  console.log(`   ✅ ${matched.length} markets matched with API-Football`);
  console.log(`   ✅ ${live.length} matches are LIVE right now`);
  console.log(`   ✅ ${upcoming.length} matches starting soon`);
  console.log(`   ⚠️  ${unmatched.length} markets couldn't be matched (may be ended or different sport)`);

  console.log(`\n🎯 NEXT STEPS:\n`);
  console.log(`   1. Use continuous scanning: scanner.startContinuousScanning(1)`);
  console.log(`   2. Track live odds for matched markets`);
  console.log(`   3. Integrate with Telegram Bot #4 for instant alerts`);
  console.log(`   4. Execute trades based on odds discrepancies\n`);
}

// Run test
testEnhancedScanner().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
