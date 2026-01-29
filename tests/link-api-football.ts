/**
 * MATCH API LINKER
 * 
 * football-matches.json (API-Football data) ile
 * polymarket-matches.json (Polymarket token IDs) birleştiriyoruz
 * 
 * Slug ile eşleştirme yapıyoruz
 */

import * as fs from 'fs';
import * as path from 'path';

interface FootballMatch {
  id: string;
  slug: string;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  apiFootballId?: number;
  kickoffUTC?: string;
  endDate?: string;
  status?: string;
  [key: string]: any;
}

interface MarketOutcome {
  question: string;
  outcomes: string;
  clobTokenIds: string;
  conditionId: string;
}

interface PolymarketMatch {
  id: string;
  slug: string;
  title: string;
  markets?: MarketOutcome[];
  [key: string]: any;
}

function main() {
  console.log('\n🔗 MATCH API LINKER');
  console.log('='.repeat(80));

  // 1. Load football-matches.json
  const footballPath = path.join(__dirname, '../data/football-matches.json');
  const footballData = JSON.parse(fs.readFileSync(footballPath, 'utf-8'));
  const footballMatches: FootballMatch[] = footballData.matches || [];
  
  console.log(`\n📊 Football matches: ${footballMatches.length}`);
  console.log(`   🔗 With API-Football ID: ${footballMatches.filter(m => m.apiFootballId).length}`);

  // 2. Load polymarket-matches.json
  const polymarketPath = path.join(__dirname, '../data/polymarket-matches.json');
  const polymarketData = JSON.parse(fs.readFileSync(polymarketPath, 'utf-8'));
  const polymarketMatches: PolymarketMatch[] = polymarketData.matches || [];
  
  console.log(`\n🎫 Polymarket matches: ${polymarketMatches.length}`);
  console.log(`   🔗 With markets: ${polymarketMatches.filter(m => m.markets && m.markets.length > 0).length}`);

  // 3. Polymarket match'leri slug'a göre map'le
  const polymarketBySlug = new Map<string, PolymarketMatch>();
  polymarketMatches.forEach(m => {
    polymarketBySlug.set(m.slug, m);
  });

  // 4. Football match'lere Polymarket bilgilerini ekle
  let linkedCount = 0;
  let unlinkedCount = 0;

  for (const match of footballMatches) {
    const polyMatch = polymarketBySlug.get(match.slug);
    
    if (polyMatch && polyMatch.markets && polyMatch.markets.length > 0) {
      // Markets bilgisini ekle
      match.markets = polyMatch.markets;
      linkedCount++;
    } else {
      unlinkedCount++;
    }
  }

  console.log(`\n✅ Linking results:`);
  console.log(`   ✅ Linked: ${linkedCount} matches`);
  console.log(`   ❌ Unlinked: ${unlinkedCount} matches`);

  // 5. Detaylı analiz
  const withApiAndMarkets = footballMatches.filter(m => 
    m.apiFootballId && m.markets && m.markets.length > 0
  );
  
  console.log(`\n🎯 READY FOR TRADING:`);
  console.log(`   ✅ With API-Football ID + Markets: ${withApiAndMarkets.length} matches`);

  if (withApiAndMarkets.length > 0) {
    console.log(`\n   📋 Sample matches:`);
    withApiAndMarkets.slice(0, 5).forEach((m, i) => {
      console.log(`      ${i + 1}. ${m.slug}`);
      console.log(`         🆔 API-Football: ${m.apiFootballId}`);
      console.log(`         📊 Markets: ${m.markets?.length || 0}`);
      console.log(`         ⏰ Kickoff: ${m.kickoffUTC || m.endDate || 'Unknown'}`);
    });
  }

  // 6. Save updated football-matches.json
  const outputPath = path.join(__dirname, '../data/football-matches.json');
  footballData.matches = footballMatches;
  footballData.updatedAt = new Date().toISOString();
  footballData.linkedMatches = linkedCount;
  
  fs.writeFileSync(outputPath, JSON.stringify(footballData, null, 2));

  console.log(`\n💾 Saved to: ${outputPath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   📁 Total matches: ${footballMatches.length}`);
  console.log(`   🔗 Linked with markets: ${linkedCount}`);
  console.log(`   🎯 Ready for trading: ${withApiAndMarkets.length}`);
  console.log('='.repeat(80) + '\n');
}

main();
