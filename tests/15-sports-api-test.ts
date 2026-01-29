/**
 * Test Sports API Integration
 */

import { SportsAPI } from '../src/integrations/sports-api';
import { TimezoneUtils } from '../src/utils/timezone';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  SPORTS API TEST');
  console.log('='.repeat(70) + '\n');

  try {
    const sportsAPI = new SportsAPI();
    TimezoneUtils.log('✅ Sports API initialized (Demo Mode)', 'INFO');

    console.log('\n' + '='.repeat(70));
    console.log('⚽ Fetching Live Matches...');
    console.log('='.repeat(70) + '\n');

    const liveMatches = await sportsAPI.getLiveMatches();
    
    if (liveMatches.length > 0) {
      console.log(`Found ${liveMatches.length} live match(es):\n`);
      
      for (const match of liveMatches) {
        console.log(`[${match.league}] ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}`);
        console.log(`   Status: ${match.status} | Minute: ${match.minute}'`);
        console.log(`   Events: ${match.events.length} (${match.events.filter(e => e.type === 'GOAL').length} goals)\n`);

        // Display recent events
        if (match.events.length > 0) {
          console.log('   Recent Events:');
          const recentEvents = match.events.slice(-3);
          for (const event of recentEvents) {
            const teamName = event.team === 'HOME' ? match.homeTeam : match.awayTeam;
            console.log(`      ${event.minute}' - ${event.type} (${teamName}${event.player ? ' - ' + event.player : ''})`);
          }
          console.log('');
        }
      }

      console.log('\n' + '='.repeat(70));
      console.log('🎯 Detecting Trading Signals...');
      console.log('='.repeat(70) + '\n');

      // Simulate previous state (without last goal)
      for (const match of liveMatches) {
        if (match.events.length > 0) {
          const previousState = {
            ...match,
            events: match.events.slice(0, -1),
          };

          const signals = sportsAPI.detectTradingSignals(match, previousState);
          
          if (signals.length > 0) {
            console.log(`Signals for ${match.homeTeam} vs ${match.awayTeam}:\n`);
            signals.forEach(signal => sportsAPI.logSignal(signal));
          }
        }
      }

    } else {
      console.log('⚠️  No live matches found (this is demo mode)\n');
      console.log('💡 To get real data:');
      console.log('   1. Sign up for API-Football: https://www.api-football.com/');
      console.log('   2. Add SPORTS_API_KEY to .env file');
      console.log('   3. Run this test again\n');
    }

    console.log('='.repeat(70));
    console.log('✅ SPORTS API TEST COMPLETED');
    console.log('='.repeat(70) + '\n');

  } catch (error: any) {
    TimezoneUtils.log(`Test failed: ${error.message}`, 'ERROR');
    console.error(error);
    process.exit(1);
  }
}

main();
