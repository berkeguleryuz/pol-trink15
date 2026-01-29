import { config } from 'dotenv';
import { resolve } from 'path';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';
import { APIFootballClient, APIFootballFixture } from '../src/integrations/api-football';

config({ path: resolve(__dirname, '../.env') });

/**
 * TEST: Bugünün büyük lig maçlarını Polymarket ile eşleştir
 * 
 * 1. API-Football'dan bugünün EPL, UCL, La Liga, etc. maçlarını al
 * 2. Polymarket'te bu maçları ara
 * 3. Eşleşenleri göster
 */

async function testTodaysMatches() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`    🎯 TODAY'S MAJOR LEAGUE MATCHES - POLYMARKET MATCHING`);
  console.log(`${'='.repeat(80)}\n`);

  const polymarket = new PolymarketSportsClient();
  const apiFootball = new APIFootballClient();

  // Step 1: Bugünün büyük lig maçlarını al
  console.log(`${'='.repeat(80)}`);
  console.log(`STEP 1: Get Today's Fixtures from Major Leagues`);
  console.log(`${'='.repeat(80)}\n`);

  const todaysFixtures = await apiFootball.getTodaysMajorLeagueFixtures();

  if (todaysFixtures.length === 0) {
    console.log(`\n⚠️  No matches from major leagues today.\n`);
    console.log(`This could mean:`);
    console.log(`   - No EPL, UCL, La Liga, etc. matches scheduled today`);
    console.log(`   - It's an off-day for major leagues`);
    console.log(`   - Try again on matchday\n`);
    return;
  }

  console.log(`\n📊 Found ${todaysFixtures.length} matches from major leagues today\n`);

  // Kategorize: LIVE, UPCOMING, FINISHED
  const now = Date.now();
  const liveFixtures: APIFootballFixture[] = [];
  const upcomingFixtures: APIFootballFixture[] = [];
  const finishedFixtures: APIFootballFixture[] = [];

  todaysFixtures.forEach(fixture => {
    const status = fixture.fixture.status.short;
    
    if (status === '1H' || status === '2H' || status === 'ET' || status === 'HT') {
      liveFixtures.push(fixture);
    } else if (status === 'FT' || status === 'AET' || status === 'PEN') {
      finishedFixtures.push(fixture);
    } else {
      upcomingFixtures.push(fixture);
    }
  });

  console.log(`   🔴 LIVE: ${liveFixtures.length} matches`);
  console.log(`   ⏰ UPCOMING: ${upcomingFixtures.length} matches`);
  console.log(`   ✅ FINISHED: ${finishedFixtures.length} matches\n`);

  // Step 2: Polymarket'ten active markets al
  console.log(`${'='.repeat(80)}`);
  console.log(`STEP 2: Get Active Tradable Markets from Polymarket`);
  console.log(`${'='.repeat(80)}\n`);

  const activeMarkets = await polymarket.getActiveTradableMarkets();

  console.log(`\n✅ Found ${activeMarkets.length} active tradable markets on Polymarket\n`);

  // Step 3: MATCHING
  console.log(`${'='.repeat(80)}`);
  console.log(`STEP 3: Match API-Football Fixtures with Polymarket Markets`);
  console.log(`${'='.repeat(80)}\n`);

  const liveMatched: any[] = [];
  const upcomingMatched: any[] = [];

  // LIVE matches ile eşleştir
  if (liveFixtures.length > 0) {
    console.log(`\n🔴 MATCHING LIVE MATCHES:\n`);

    for (const fixture of liveFixtures) {
      const homeTeam = fixture.teams.home.name;
      const awayTeam = fixture.teams.away.name;

      // Polymarket'te bu maçı ara
      const matchedMarkets = activeMarkets.filter((market: any) => {
        const question = market.question.toLowerCase();
        return fuzzyMatchFixture(homeTeam, awayTeam, question);
      });

      if (matchedMarkets.length > 0) {
        liveMatched.push({ fixture, markets: matchedMarkets });

        console.log(`✅ LIVE MATCH FOUND:`);
        console.log(`   ${homeTeam} ${fixture.goals.home}-${fixture.goals.away} ${awayTeam}`);
        console.log(`   League: ${fixture.league.name}`);
        console.log(`   Status: ${fixture.fixture.status.elapsed}' ${fixture.fixture.status.short}`);
        console.log(`   Polymarket Markets: ${matchedMarkets.length}`);
        
        matchedMarkets.forEach((market: any, idx: number) => {
          console.log(`      ${idx + 1}. ${market.question}`);
          
          if (market.tokens && market.tokens.length > 0) {
            const prices = market.tokens.map((t: any) => 
              `${t.outcome}: ${(parseFloat(t.price || '0') * 100).toFixed(1)}%`
            ).join(' | ');
            console.log(`         ${prices}`);
          }
        });
        console.log();
      }
    }

    if (liveMatched.length === 0) {
      console.log(`   ⚠️  No live matches found on Polymarket\n`);
    }
  }

  // UPCOMING matches ile eşleştir
  if (upcomingFixtures.length > 0) {
    console.log(`\n⏰ MATCHING UPCOMING MATCHES:\n`);

    for (const fixture of upcomingFixtures) {
      const homeTeam = fixture.teams.home.name;
      const awayTeam = fixture.teams.away.name;
      const kickoff = new Date(fixture.fixture.timestamp * 1000);
      const hoursUntil = ((kickoff.getTime() - now) / 3600000).toFixed(1);

      // Sadece 6 saat içinde başlayacakları göster
      if (parseFloat(hoursUntil) > 6) continue;

      // Polymarket'te bu maçı ara
      const matchedMarkets = activeMarkets.filter((market: any) => {
        const question = market.question.toLowerCase();
        return fuzzyMatchFixture(homeTeam, awayTeam, question);
      });

      if (matchedMarkets.length > 0) {
        upcomingMatched.push({ fixture, markets: matchedMarkets });

        console.log(`✅ UPCOMING MATCH FOUND:`);
        console.log(`   ${homeTeam} vs ${awayTeam}`);
        console.log(`   League: ${fixture.league.name}`);
        console.log(`   Kickoff: ${kickoff.toLocaleString('de-DE', { timeZone: 'Europe/Istanbul' })} (in ${hoursUntil}h)`);
        console.log(`   Polymarket Markets: ${matchedMarkets.length}`);
        
        matchedMarkets.forEach((market: any, idx: number) => {
          console.log(`      ${idx + 1}. ${market.question}`);
          
          if (market.tokens && market.tokens.length > 0) {
            const prices = market.tokens.map((t: any) => 
              `${t.outcome}: ${(parseFloat(t.price || '0') * 100).toFixed(1)}%`
            ).join(' | ');
            console.log(`         ${prices}`);
          }
        });
        console.log();
      }
    }

    if (upcomingMatched.length === 0) {
      console.log(`   ⚠️  No upcoming matches found on Polymarket\n`);
    }
  }

  // SUMMARY
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 MATCHING SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`Today's Fixtures (API-Football): ${todaysFixtures.length}`);
  console.log(`   🔴 Live: ${liveFixtures.length}`);
  console.log(`   ⏰ Upcoming: ${upcomingFixtures.length}`);
  console.log(`   ✅ Finished: ${finishedFixtures.length}\n`);

  console.log(`Polymarket Markets: ${activeMarkets.length}\n`);

  console.log(`Successfully Matched:`);
  console.log(`   🔴 Live Matches: ${liveMatched.length}`);
  console.log(`   ⏰ Upcoming Matches: ${upcomingMatched.length}`);
  console.log(`   📊 Total: ${liveMatched.length + upcomingMatched.length}\n`);

  console.log(`${'='.repeat(80)}`);
  console.log(`✅ TEST COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  if (liveMatched.length > 0 || upcomingMatched.length > 0) {
    console.log(`\n🎯 TRADING OPPORTUNITIES:\n`);
    
    if (liveMatched.length > 0) {
      console.log(`   ✅ ${liveMatched.length} LIVE matches ready for trading`);
      console.log(`   Strategy: Monitor for goals, track odds changes`);
    }
    
    if (upcomingMatched.length > 0) {
      console.log(`   ✅ ${upcomingMatched.length} UPCOMING matches for pre-market`);
      console.log(`   Strategy: Compare Polymarket vs bookmaker odds, find value`);
    }
    
    console.log();
  } else {
    console.log(`\n⚠️  No trading opportunities right now.\n`);
    console.log(`Possible reasons:`);
    console.log(`   - Different match schedules (API-Football vs Polymarket)`);
    console.log(`   - Team name mismatches (need better fuzzy matching)`);
    console.log(`   - Polymarket may not have markets for today's games yet\n`);
  }
}

/**
 * Fuzzy match fixture with market question
 */
function fuzzyMatchFixture(
  homeTeam: string,
  awayTeam: string,
  question: string
): boolean {
  const normalizeTeam = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\bfc\b|\bcf\b|\bsc\b|\bac\b|\bas\b|\bcd\b/g, '')
      .replace(/\bunited\b|\bcity\b|\bathletic\b|\breal\b/g, '')
      .trim();
  };

  const normHome = normalizeTeam(homeTeam);
  const normAway = normalizeTeam(awayTeam);
  const normQuestion = normalizeTeam(question);

  // Check if both teams appear in question
  const homeInQuestion = normQuestion.includes(normHome) || normHome.split(' ').some(word => word.length > 3 && normQuestion.includes(word));
  const awayInQuestion = normQuestion.includes(normAway) || normAway.split(' ').some(word => word.length > 3 && normQuestion.includes(word));

  return homeInQuestion && awayInQuestion;
}

// Run
testTodaysMatches().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
