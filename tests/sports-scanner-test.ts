/**
 * Quick Sports Market Scanner
 * Scans and lists all available sports markets
 */

import { SportsMarketScanner } from '../src/strategies/sports-market-scanner';
import { TimezoneUtils } from '../src/utils/timezone';

async function main() {
  console.log('\n🔍 ===== SPORTS MARKET SCANNER ===== 🔍\n');
  console.log(`Time: ${TimezoneUtils.formatBerlinTime()}\n`);

  try {
    const scanner = new SportsMarketScanner();
    
    console.log('📡 Scanning Polymarket for sports markets...\n');
    const opportunities = await scanner.scanSportsMarkets();
    
    console.log('\n📊 ===== SCAN RESULTS ===== 📊\n');
    
    if (opportunities.length === 0) {
      console.log('⚠️  No opportunities found');
      console.log('\nPossible reasons:');
      console.log('  - No live matches right now');
      console.log('  - All markets have low liquidity');
      console.log('  - No upcoming kickoffs\n');
      return;
    }
    
    // Group by type
    const live = opportunities.filter(o => o.type === 'LIVE');
    const kickoffSoon = opportunities.filter(o => o.type === 'KICKOFF_SOON');
    const earlyEntry = opportunities.filter(o => o.type === 'EARLY_ENTRY');
    
    // LIVE MATCHES
    if (live.length > 0) {
      console.log(`\n🔴 LIVE MATCHES (${live.length})\n`);
      for (const opp of live) {
        console.log(`⚽ ${opp.market.question}`);
        console.log(`   League: ${opp.market.league || 'Unknown'}`);
        console.log(`   Liquidity: $${opp.market.liquidity.toLocaleString()}`);
        console.log(`   Volume 24h: $${opp.market.volume24h.toLocaleString()}`);
        console.log(`   Reason: ${opp.reason}`);
        console.log(`   Actions: ${opp.recommendedActions.length}`);
        
        for (const action of opp.recommendedActions.slice(0, 3)) {
          console.log(`      - ${action.outcome} (${action.side}) @ ${(action.currentPrice * 100).toFixed(1)}%`);
        }
        console.log('');
      }
    }
    
    // KICKOFF SOON
    if (kickoffSoon.length > 0) {
      console.log(`\n⏱️  STARTING SOON (${kickoffSoon.length})\n`);
      for (const opp of kickoffSoon) {
        const minutes = opp.market.minutesToKickoff || 0;
        console.log(`⚽ ${opp.market.question}`);
        console.log(`   Starts in: ${minutes} minutes`);
        console.log(`   Liquidity: $${opp.market.liquidity.toLocaleString()}`);
        console.log(`   Actions: ${opp.recommendedActions.length}`);
        console.log('');
      }
    }
    
    // EARLY ENTRY
    if (earlyEntry.length > 0) {
      console.log(`\n💎 EARLY ENTRY OPPORTUNITIES (${earlyEntry.length})\n`);
      for (const opp of earlyEntry.slice(0, 5)) {
        console.log(`⚽ ${opp.market.question}`);
        console.log(`   Liquidity: $${opp.market.liquidity.toLocaleString()}`);
        console.log(`   Low price entries: ${opp.recommendedActions.length}`);
        console.log('');
      }
    }
    
    // Summary
    console.log('\n📈 ===== SUMMARY ===== 📈\n');
    console.log(`Total opportunities: ${opportunities.length}`);
    console.log(`  🔴 Live: ${live.length}`);
    console.log(`  ⏱️  Kickoff Soon: ${kickoffSoon.length}`);
    console.log(`  💎 Early Entry: ${earlyEntry.length}`);
    
    // Get live matches
    const liveMatches = scanner.getLiveMatches();
    console.log(`\nTracked live matches: ${liveMatches.length}`);
    
    console.log('\n✅ Scan complete!\n');
    
  } catch (error: any) {
    console.error('\n❌ Scan failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
