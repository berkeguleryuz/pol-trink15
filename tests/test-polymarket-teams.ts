import axios from 'axios';

/**
 * Polymarket Teams API Test
 * 
 * Tüm futbol takımlarını alıp LiveScore6 ile eşleştirme yapacağız
 */

(async () => {
  console.log('🏆 Testing Polymarket Teams API\n');
  
  // Tüm takımları al
  console.log('📡 Fetching ALL teams from Polymarket...\n');
  
  const response = await axios.get('https://gamma-api.polymarket.com/teams');
  const allTeams = response.data || [];
  
  console.log(`✅ Found ${allTeams.length} teams\n`);
  
  // Futbol liglerini filtrele (EPL, La Liga, Brasileirão, etc.)
  const soccerLeagues = ['epl', 'lal', 'bun', 'fl1', 'sea', 'ucl', 'uel', 'lib', 'bra', 'mls', 'arg', 'mex'];
  
  const soccerTeams = allTeams.filter((team: any) => {
    return soccerLeagues.includes(team.league);
  });
  
  console.log(`⚽ ${soccerTeams.length} soccer teams\n`);
  
  // Brezilya takımlarını bul
  const brazilTeams = soccerTeams.filter((team: any) => {
    const name = (team.name || '').toLowerCase();
    const brazilKeywords = ['mineiro', 'bahia', 'gremio', 'grêmio', 'cruzeiro', 
                            'flamengo', 'palmeiras', 'corinthians', 'são paulo', 
                            'sao paulo', 'santos', 'botafogo', 'vasco', 'fortaleza',
                            'athletico', 'internacional', 'vitoria', 'vitória'];
    return brazilKeywords.some(kw => name.includes(kw));
  });
  
  console.log(`🇧🇷 ${brazilTeams.length} Brazilian teams:\n`);
  
  brazilTeams.slice(0, 20).forEach((team: any) => {
    console.log(`- ${team.name} (ID: ${team.id})`);
  });
  
  // Sample team structure
  if (allTeams.length > 0) {
    console.log(`\n📊 Sample team structure:`);
    console.log(JSON.stringify(allTeams[0], null, 2));
  }
})();
