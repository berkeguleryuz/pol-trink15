/**
 * Bugünün büyük lig maçlarını kontrol et
 */

import { APIFootballClient } from '../src/integrations/api-football';
import dotenv from 'dotenv';

dotenv.config();

const client = new APIFootballClient();

// Bugünün büyük lig maçları
const majorLeagues = [
  { id: 39, name: 'Premier League' },
  { id: 2, name: 'Champions League' },
  { id: 140, name: 'La Liga' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
  { id: 135, name: 'Serie A' },
  { id: 3, name: 'UEFA Europa League' },
  { id: 253, name: 'MLS' },
];

async function checkTodaysFixtures() {
  console.log('🔍 Checking today\'s fixtures in major leagues...\n');
  console.log(`📅 Date: ${new Date().toLocaleDateString('tr-TR')}\n`);
  
  let totalMatches = 0;
  
  for (const league of majorLeagues) {
    try {
      const fixtures = await client.getFixturesToday(league.id);
      
      if (fixtures.length > 0) {
        console.log(`⚽ ${league.name}: ${fixtures.length} matches`);
        totalMatches += fixtures.length;
        
        fixtures.slice(0, 5).forEach((f: any) => {
          const time = new Date(f.fixture.date).toLocaleTimeString('tr-TR', { 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'Europe/Istanbul'
          });
          const status = f.fixture.status.short;
          console.log(`   ${time} ${status === 'NS' ? '⏰' : '🔴'} ${f.teams.home.name} vs ${f.teams.away.name} (${status})`);
        });
        
        if (fixtures.length > 5) {
          console.log(`   ... and ${fixtures.length - 5} more`);
        }
        console.log('');
      } else {
        console.log(`⚪ ${league.name}: No matches today\n`);
      }
    } catch (err: any) {
      console.log(`❌ ${league.name}: ${err.message}\n`);
    }
  }
  
  console.log(`\n📊 TOTAL: ${totalMatches} matches today in major leagues\n`);
}

checkTodaysFixtures();
