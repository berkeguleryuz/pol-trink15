import { LiveScore6Client } from '../src/integrations/livescore6-client';
import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

async function checkAllLiveMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('   🔴 LIVE MATCHES ACROSS ALL LEAGUES');
  console.log('='.repeat(80) + '\n');

  const liveScoreClient = new LiveScore6Client();
  const polymarketClient = new PolymarketSportsClient();

  try {
    // Get all live matches from LiveScore6
    console.log('📡 Fetching live matches from LiveScore6...\n');
    const liveMatches = await liveScoreClient.getLiveMatches();

    if (liveMatches.length === 0) {
      console.log('❌ No live matches found at this moment.\n');
      return;
    }

    console.log(`✅ Found ${liveMatches.length} LIVE matches:\n`);
    console.log('─'.repeat(80) + '\n');

    // Check each match on Polymarket
    for (const match of liveMatches) {
      const slug = liveScoreClient.generatePolymarketSlug(match);
      
      console.log(`⚽ ${match.homeTeam} vs ${match.awayTeam}`);
      console.log(`   📍 League: ${match.league}`);
      console.log(`   ⏱️  Minute: ${match.minute}'`);
      console.log(`   📊 Score: ${match.homeScore} - ${match.awayScore}`);
      console.log(`   🔗 Slug: ${slug}`);

      // Check if match exists on Polymarket
      try {
        const polyEvent = await polymarketClient.searchEventBySlug(slug);
        
        if (polyEvent) {
          console.log(`   ✅ FOUND ON POLYMARKET!`);
          console.log(`   💰 Active: ${polyEvent.active ? 'Yes' : 'No'}`);
          console.log(`   📈 Markets: ${polyEvent.markets?.length || 0}`);
        } else {
          console.log(`   ❌ Not found on Polymarket`);
        }
      } catch (error) {
        console.log(`   ⚠️  Error checking Polymarket: ${error instanceof Error ? error.message : 'Unknown'}`);
      }

      console.log('─'.repeat(80) + '\n');
      
      // Wait a bit to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('   📊 SUMMARY');
    console.log('='.repeat(80) + '\n');
    console.log(`Total Live Matches: ${liveMatches.length}`);
    
    // Group by league
    const byLeague = liveMatches.reduce((acc, match) => {
      acc[match.league] = (acc[match.league] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\nBy League:');
    Object.entries(byLeague)
      .sort((a, b) => b[1] - a[1])
      .forEach(([league, count]) => {
        console.log(`   ${league}: ${count} match${count > 1 ? 'es' : ''}`);
      });

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

checkAllLiveMatches()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
