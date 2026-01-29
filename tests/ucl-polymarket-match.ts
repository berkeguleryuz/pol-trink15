import { config } from 'dotenv';
import { resolve } from 'path';
import { SportsDataAggregator } from '../src/integrations/sports-aggregator';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

config({ path: resolve(__dirname, '../.env') });

/**
 * FINAL TEST: UCL Matches + Polymarket Matching
 * 
 * 1. Football-Data.org'dan bugünün UCL maçlarını al
 * 2. Polymarket'ten active markets al  
 * 3. Eşleştir
 * 4. Trade'e hazır maçları göster
 */

async function testUCLMatching() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`    ⭐ UCL MATCHES + POLYMARKET MATCHING TEST`);
  console.log(`${'='.repeat(80)}\n`);

  const aggregator = new SportsDataAggregator();
  const polymarket = new PolymarketSportsClient();

  // Step 1: Get UCL matches
  console.log(`${'='.repeat(80)}`);
  console.log(`STEP 1: Get Today's UCL Matches`);
  console.log(`${'='.repeat(80)}\n`);

  const uclMatches = await aggregator.getTodaysUCLMatches();

  if (uclMatches.length === 0) {
    console.log(`\n⚠️  No UCL matches found today.\n`);
    return;
  }

  console.log(`\n✅ Found ${uclMatches.length} UCL matches\n`);

  uclMatches.forEach(match => {
    const kickoff = match.kickoffTime.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const hoursUntil = ((match.kickoffTime.getTime() - Date.now()) / 3600000).toFixed(1);
    
    console.log(`⚽ ${match.homeTeam} vs ${match.awayTeam}`);
    console.log(`   Kickoff: ${kickoff} (in ${hoursUntil}h)`);
    console.log(`   Match ID: ${match.id}`);
    console.log();
  });

  // Step 2: Get Polymarket markets
  console.log(`\n${'='.repeat(80)}`);
  console.log(`STEP 2: Get Polymarket Markets`);
  console.log(`${'='.repeat(80)}\n`);

  const polymarketMarkets = await polymarket.getActiveTradableMarkets();

  console.log(`\n✅ Found ${polymarketMarkets.length} tradable markets on Polymarket\n`);

  // Step 3: Match
  console.log(`${'='.repeat(80)}`);
  console.log(`STEP 3: Match UCL Fixtures with Polymarket`);
  console.log(`${'='.repeat(80)}\n`);

  const matched: any[] = [];

  for (const match of uclMatches) {
    // Fuzzy match ile Polymarket'te ara
    const matchedMarkets = polymarketMarkets.filter((market: any) => {
      return fuzzyMatch(match.homeTeam, match.awayTeam, market.question);
    });

    if (matchedMarkets.length > 0) {
      matched.push({ match, markets: matchedMarkets });

      console.log(`✅ MATCH FOUND!`);
      console.log(`   ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`   Kickoff: ${match.kickoffTime.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
      console.log(`   Polymarket Markets: ${matchedMarkets.length}\n`);

      matchedMarkets.forEach((market: any, idx: number) => {
        console.log(`   ${idx + 1}. ${market.question}`);
        
        if (market.outcomePrices) {
          const prices = JSON.parse(market.outcomePrices);
          const outcomes = JSON.parse(market.outcomes);
          
          outcomes.forEach((outcome: string, i: number) => {
            const price = (parseFloat(prices[i]) * 100).toFixed(1);
            console.log(`      ${outcome}: ${price}%`);
          });
        }
        
        console.log(`      Volume: $${(parseFloat(market.volume) / 1000).toFixed(1)}K`);
        console.log(`      Liquidity: $${(parseFloat(market.liquidity) / 1000).toFixed(1)}K`);
        console.log();
      });

      console.log();
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 MATCHING SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`UCL Matches Found: ${uclMatches.length}`);
  console.log(`Polymarket Markets: ${polymarketMarkets.length}`);
  console.log(`Successfully Matched: ${matched.length}\n`);

  console.log(`${'='.repeat(80)}`);
  console.log(`✅ TEST COMPLETED`);
  console.log(`${'='.repeat(80)}\n`);

  if (matched.length > 0) {
    console.log(`\n🎯 READY FOR LIVE TRADING!\n`);
    console.log(`Matched Matches:`);
    
    matched.forEach(({ match, markets }) => {
      const hoursUntil = ((match.kickoffTime.getTime() - Date.now()) / 3600000).toFixed(1);
      console.log(`   ⚽ ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`      Starting in: ${hoursUntil}h`);
      console.log(`      Markets: ${markets.length}`);
      console.log(`      Match ID: ${match.id}\n`);
    });

    console.log(`\n🚀 NEXT STEPS:\n`);
    console.log(`   1. Wait for matches to start (18:45 & 21:00 Istanbul time)`);
    console.log(`   2. Start goal monitoring (poll every 2-3 seconds)`);
    console.log(`   3. When goal detected → Trade on Polymarket immediately`);
    console.log(`   4. Expected arbitrage window: 10-30 seconds\n`);

    // Print ready-to-use monitor commands
    console.log(`\n📋 MONITOR COMMANDS:\n`);
    matched.slice(0, 3).forEach(({ match }) => {
      console.log(`   # Monitor: ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`   # Match ID: ${match.id}`);
      console.log();
    });

  } else {
    console.log(`\n⚠️  No matches found on Polymarket.\n`);
    console.log(`Possible reasons:`);
    console.log(`   - Team name mismatches (need better fuzzy matching)`);
    console.log(`   - Polymarket hasn't created markets for these matches yet`);
    console.log(`   - Markets may be in different league category\n`);
  }

  // Performance stats
  console.log();
  aggregator.printPerformanceStats();
}

/**
 * Fuzzy match teams with question
 */
function fuzzyMatch(homeTeam: string, awayTeam: string, question: string): boolean {
  const normalize = (text: string) => {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\bfc\b|\bcf\b|\bkv\b|\bsk\b|\bfk\b/g, '')
      .replace(/\bclub\b|\bunited\b|\bcity\b|\bathletic\b/g, '')
      .replace(/\blisboa\b|\be\b|\bbenfica\b/g, '')
      .replace(/ağdam/g, 'agdam')
      .replace(/qarabağ/g, 'qarabag')
      .trim();
  };

  const normHome = normalize(homeTeam);
  const normAway = normalize(awayTeam);
  const normQuestion = normalize(question);

  // Split into words for better matching
  const homeWords = normHome.split(' ').filter(w => w.length > 3);
  const awayWords = normAway.split(' ').filter(w => w.length > 3);

  // Check if key words from both teams appear
  const homeMatch = homeWords.some(word => normQuestion.includes(word)) || 
                    normQuestion.includes(normHome);
  
  const awayMatch = awayWords.some(word => normQuestion.includes(word)) ||
                    normQuestion.includes(normAway);

  return homeMatch && awayMatch;
}

testUCLMatching().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
