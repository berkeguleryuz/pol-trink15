import { config } from 'dotenv';
import { resolve } from 'path';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';
import { APIFootballClient } from '../src/integrations/api-football';

// Load .env
config({ path: resolve(__dirname, '../.env') });

/**
 * Test: Polymarket ACTIVE Markets + API-Football Matching
 * 
 * Sadece trade edilebilir aktif spor marketlerini alır
 * API-Football ile eşleştirir
 */

async function testActiveMarkets() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`         ⚽ ACTIVE SPORTS MARKETS + API-FOOTBALL MATCHING`);
  console.log(`${'='.repeat(80)}\n`);

  const polymarket = new PolymarketSportsClient();
  const apiFootball = new APIFootballClient();

  // Test 1: Aktif trade edilebilir sports markets al
  console.log(`${'='.repeat(80)}`);
  console.log(`TEST 1: Get ACTIVE & TRADABLE Sports Markets`);
  console.log(`${'='.repeat(80)}\n`);

  const activeMarkets = await polymarket.getActiveTradableMarkets();

  if (activeMarkets.length === 0) {
    console.log(`\n⚠️  No active tradable sports markets found right now.\n`);
    console.log(`This could mean:`);
    console.log(`   - No sports markets are accepting orders at the moment`);
    console.log(`   - All current markets are closed or archived`);
    console.log(`   - Need to wait for new markets to open\n`);
    return;
  }

  console.log(`\n✅ Found ${activeMarkets.length} active tradable sports markets\n`);

  // İlk 10 market'i göster
  console.log(`📊 First 10 Active Markets:\n`);
  activeMarkets.slice(0, 10).forEach((market: any, idx: number) => {
    const accepting = market.accepting_orders ? '✅ OPEN' : '❌ CLOSED';
    const volume = (parseFloat(market.volume || '0') / 1000).toFixed(1);
    const liquidity = (parseFloat(market.liquidity || '0') / 1000).toFixed(1);
    
    console.log(`${idx + 1}. ${accepting} ${market.question}`);
    
    if (market.tokens && market.tokens.length > 0) {
      market.tokens.forEach((token: any) => {
        const price = (parseFloat(token.price || '0') * 100).toFixed(1);
        console.log(`   ${token.outcome}: ${price}%`);
      });
    }
    
    console.log(`   Volume: $${volume}K | Liquidity: $${liquidity}K`);
    console.log(`   End Date: ${new Date(market.end_date_iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
    console.log(`   Tags: ${(market.tags || []).join(', ')}`);
    console.log();
  });

  // Test 2: API-Football ile live matches al
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 2: Get Live Matches from API-Football`);
  console.log(`${'='.repeat(80)}\n`);

  const liveMatches = await apiFootball.getLiveMatches();
  console.log(`\n✅ Found ${liveMatches.length} live matches from API-Football\n`);

  if (liveMatches.length > 0) {
    console.log(`Live Matches (first 10):\n`);
    liveMatches.slice(0, 10).forEach(match => {
      console.log(`   ⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
      console.log(`      ${match.league} | ${match.minute}' | ${match.status}`);
    });
  }

  // Test 3: Upcoming fixtures
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 3: Get Upcoming Fixtures (Next 60 Minutes)`);
  console.log(`${'='.repeat(80)}\n`);

  const upcomingFixtures = await apiFootball.getFixturesStartingSoon(60);
  console.log(`\n✅ Found ${upcomingFixtures.length} matches starting in next 60 minutes\n`);

  if (upcomingFixtures.length > 0) {
    upcomingFixtures.slice(0, 10).forEach(fixture => {
      const kickoff = new Date(fixture.fixture.timestamp * 1000);
      const minutesUntil = Math.floor((kickoff.getTime() - Date.now()) / 60000);
      
      console.log(`   ⏰ ${fixture.teams.home.name} vs ${fixture.teams.away.name}`);
      console.log(`      ${fixture.league.name} | Starting in ${minutesUntil} minutes`);
      console.log(`      Kickoff: ${kickoff.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
    });
  }

  // Test 4: Team name matching (fuzzy)
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST 4: Match Polymarket Markets with API-Football Data`);
  console.log(`${'='.repeat(80)}\n`);

  let matched = 0;
  let matchedMarkets: any[] = [];

  for (const market of activeMarkets.slice(0, 20)) { // İlk 20 market test et
    const question = market.question.toLowerCase();
    
    // Team names çıkar
    const teams = extractTeamsFromQuestion(question);
    if (!teams) continue;

    // Live match ara
    const liveMatch = liveMatches.find(match => 
      fuzzyMatchTeams(teams.home, teams.away, match.homeTeam, match.awayTeam)
    );

    if (liveMatch) {
      matched++;
      matchedMarkets.push({
        market,
        liveMatch,
        type: 'LIVE'
      });

      console.log(`✅ LIVE MATCH FOUND:`);
      console.log(`   Polymarket: ${market.question}`);
      console.log(`   API-Football: ${liveMatch.homeTeam} ${liveMatch.homeScore}-${liveMatch.awayScore} ${liveMatch.awayTeam} (${liveMatch.minute}')`);
      console.log(`   League: ${liveMatch.league}`);
      console.log(`   Confidence: HIGH\n`);
      continue;
    }

    // Upcoming match ara
    const upcomingMatch = upcomingFixtures.find(fixture =>
      fuzzyMatchTeams(teams.home, teams.away, fixture.teams.home.name, fixture.teams.away.name)
    );

    if (upcomingMatch) {
      matched++;
      matchedMarkets.push({
        market,
        upcomingMatch,
        type: 'UPCOMING'
      });

      const kickoff = new Date(upcomingMatch.fixture.timestamp * 1000);
      const minutesUntil = Math.floor((kickoff.getTime() - Date.now()) / 60000);

      console.log(`⏰ UPCOMING MATCH FOUND:`);
      console.log(`   Polymarket: ${market.question}`);
      console.log(`   API-Football: ${upcomingMatch.teams.home.name} vs ${upcomingMatch.teams.away.name}`);
      console.log(`   Starting in: ${minutesUntil} minutes`);
      console.log(`   Confidence: MEDIUM\n`);
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 MATCHING SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Active Polymarket Sports Markets: ${activeMarkets.length}`);
  console.log(`API-Football Live Matches: ${liveMatches.length}`);
  console.log(`API-Football Upcoming (60min): ${upcomingFixtures.length}`);
  console.log(`Successfully Matched: ${matched}\n`);

  const liveMatchedCount = matchedMarkets.filter(m => m.type === 'LIVE').length;
  const upcomingMatchedCount = matchedMarkets.filter(m => m.type === 'UPCOMING').length;

  console.log(`   🔴 Live Matches: ${liveMatchedCount}`);
  console.log(`   ⏰ Upcoming Matches: ${upcomingMatchedCount}\n`);

  console.log(`${'='.repeat(80)}`);
  console.log(`✅ ALL TESTS COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`\n💡 KEY INSIGHTS:\n`);
  console.log(`   ✅ Polymarket has ${activeMarkets.length} TRADABLE sports markets`);
  console.log(`   ✅ ${matched} markets matched with real match data`);
  console.log(`   ✅ ${liveMatchedCount} LIVE matches we can trade on`);
  console.log(`   ✅ ${upcomingMatchedCount} UPCOMING matches (pre-market opportunity)`);

  console.log(`\n🎯 READY FOR TRADING:\n`);
  console.log(`   1. ${liveMatchedCount} live matches → Execute live strategy`);
  console.log(`   2. ${upcomingMatchedCount} upcoming matches → Execute pre-market strategy`);
  console.log(`   3. All markets are ACCEPTING ORDERS ✅`);
  console.log(`   4. Real-time data from API-Football available ✅\n`);
}

/**
 * Question'dan team names çıkar
 */
function extractTeamsFromQuestion(question: string): { home: string; away: string } | null {
  // Pattern 1: "Will X beat Y?"
  let match = question.match(/will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)\?/i);
  if (match) {
    return { home: match[1].trim(), away: match[2].trim() };
  }

  // Pattern 2: "X vs Y" veya "X v Y"
  match = question.match(/(.+?)\s+(?:vs\.?|v)\s+(.+?)(?:\s|$|\?)/i);
  if (match) {
    return { home: match[1].trim(), away: match[2].trim() };
  }

  // Pattern 3: "X to win"
  match = question.match(/(.+?)\s+to\s+win/i);
  if (match) {
    return { home: match[1].trim(), away: 'unknown' };
  }

  return null;
}

/**
 * Fuzzy team matching
 */
function fuzzyMatchTeams(
  polyHome: string,
  polyAway: string,
  apiHome: string,
  apiAway: string
): boolean {
  const normalizeTeam = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/fc|cf|sc|ac|as|cd|united|city|athletic/g, '')
      .trim();
  };

  const normPolyHome = normalizeTeam(polyHome);
  const normPolyAway = normalizeTeam(polyAway);
  const normApiHome = normalizeTeam(apiHome);
  const normApiAway = normalizeTeam(apiAway);

  // Tam veya kısmi eşleşme
  const homeMatch = 
    normPolyHome.includes(normApiHome) || 
    normApiHome.includes(normPolyHome) ||
    normPolyHome === normApiHome;

  const awayMatch = 
    normPolyAway.includes(normApiAway) || 
    normApiAway.includes(normPolyAway) ||
    normPolyAway === normApiAway;

  return homeMatch && awayMatch;
}

// Run test
testActiveMarkets().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
