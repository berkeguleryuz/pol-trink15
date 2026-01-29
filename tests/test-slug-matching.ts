import { LiveScore6Client } from '../src/integrations/livescore6-client';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

/**
 * Test: LiveScore6 -> Polymarket SLUG matching
 * 
 * 1. LiveScore6'dan LIVE maçları al
 * 2. Her maç için Polymarket SLUG oluştur
 * 3. SLUG ile Polymarket'te ara
 */

async function testSlugMatching() {
  const livescore = new LiveScore6Client();
  const polymarket = new PolymarketSportsClient();
  
  console.log('🔴 LIVE MATCHES -> POLYMARKET SLUG MATCHING\n');
  console.log('='.repeat(60));
  console.log('');
  
  // Step 1: LiveScore6'dan LIVE maçları al
  console.log('📡 Step 1: Getting LIVE matches from LiveScore6...\n');
  const liveMatches = await livescore.getLiveMatches();
  console.log(`✅ Found ${liveMatches.length} LIVE matches\n`);
  
  if (liveMatches.length === 0) {
    console.log('❌ No live matches at the moment.\n');
    return;
  }
  
  // Step 2: Her maç için SLUG oluştur ve Polymarket'te ara
  console.log('🔍 Step 2: Generating SLUGs and searching Polymarket...\n');
  console.log('='.repeat(60));
  console.log('');
  
  let successCount = 0;
  
  for (const match of liveMatches) {
    console.log(`⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
    console.log(`   ${match.minute}' | ${match.league}`);
    
    // SLUG oluştur
    const slug = livescore.generatePolymarketSlug(match);
    console.log(`   🏷️  SLUG: ${slug}`);
    
    // Polymarket'te ara
    const polyEvent = await polymarket.searchEventBySlug(slug);
    
    if (polyEvent) {
      successCount++;
      console.log(`   ✅ FOUND on Polymarket!`);
      console.log(`   📌 ${polyEvent.title}`);
      console.log(`   🔴 Live: ${polyEvent.live ? 'YES' : 'NO'}`);
      console.log(`   ⚽ Polymarket Score: ${polyEvent.score || 'N/A'}`);
      console.log(`   🎰 ${polyEvent.markets?.length || 0} markets`);
    } else {
      console.log(`   ❌ NOT found on Polymarket`);
    }
    
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log(`\n📊 RESULT: ${successCount}/${liveMatches.length} matches found on Polymarket\n`);
  
  if (successCount === 0) {
    console.log('💡 TIP: Polymarket may not have markets for all live matches.');
    console.log('    Try running this during Champions League or Premier League games.\n');
  }
}

testSlugMatching().catch(console.error);
