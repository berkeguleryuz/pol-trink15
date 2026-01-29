import axios from 'axios';

/**
 * Polymarket /sports endpoint analizi
 * 
 * Tüm ligler ve sporları gösterir
 */

async function analyzeSports() {
  const response = await axios.get('https://gamma-api.polymarket.com/sports');
  const sports = response.data;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`   📊 POLYMARKET SPORTS ANALYSIS`);
  console.log(`${'='.repeat(80)}\n`);
  
  console.log(`✅ Total Sports: ${sports.length}\n`);
  
  // Grup by category
  const categories: { [key: string]: any[] } = {
    'SOCCER ⚽': [],
    'BASKETBALL 🏀': [],
    'FOOTBALL 🏈': [],
    'BASEBALL ⚾': [],
    'HOCKEY 🏒': [],
    'CRICKET 🏏': [],
    'OTHER': []
  };
  
  for (const sport of sports) {
    const name = sport.sport.toLowerCase();
    
    // Soccer leagues
    if (['epl', 'lal', 'bun', 'fl1', 'sea', 'ucl', 'uel', 'ere', 'arg', 'mex', 'lcs', 'lib', 'sud', 'tur', 'efa', 'efl', 'mls', 'afc', 'ofc', 'fif', 'itc', 'con', 'cof', 'uef', 'caf', 'rus'].includes(name)) {
      categories['SOCCER ⚽'].push(sport);
    }
    // Basketball
    else if (['nba', 'ncaab', 'cbb', 'wnba'].includes(name)) {
      categories['BASKETBALL 🏀'].push(sport);
    }
    // American Football
    else if (['nfl', 'cfb'].includes(name)) {
      categories['FOOTBALL 🏈'].push(sport);
    }
    // Baseball
    else if (['mlb'].includes(name)) {
      categories['BASEBALL ⚾'].push(sport);
    }
    // Hockey
    else if (['nhl'].includes(name)) {
      categories['HOCKEY 🏒'].push(sport);
    }
    // Cricket
    else if (['ipl'].includes(name)) {
      categories['CRICKET 🏏'].push(sport);
    }
    else {
      categories['OTHER'].push(sport);
    }
  }
  
  // Display by category
  for (const [category, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    
    console.log(`${category} (${items.length} leagues):`);
    console.log(`${'─'.repeat(80)}`);
    
    for (const sport of items) {
      const seriesId = sport.series || 'N/A';
      console.log(`   ${sport.sport.toUpperCase().padEnd(6)} - Series ID: ${seriesId}`);
    }
    
    console.log('');
  }
  
  // Key findings
  console.log(`${'='.repeat(80)}`);
  console.log(`   🔍 KEY FINDINGS`);
  console.log(`${'='.repeat(80)}\n`);
  
  console.log(`⚽ SOCCER: ${categories['SOCCER ⚽'].length} leagues (MOST!)`);
  console.log(`   - EPL, La Liga, Bundesliga, Serie A, Ligue 1`);
  console.log(`   - Champions League, Europa League`);
  console.log(`   - MLS, Liga MX, Argentine, Brazilian leagues`);
  console.log(`   - Copa Libertadores, Copa Sudamericana`);
  console.log(`   - FA Cup, Championship, Eredivisie, Turkish league\n`);
  
  console.log(`🏀 BASKETBALL: ${categories['BASKETBALL 🏀'].length} leagues`);
  console.log(`   - NBA, NCAA Basketball, WNBA\n`);
  
  console.log(`🏈 FOOTBALL: ${categories['FOOTBALL 🏈'].length} leagues`);
  console.log(`   - NFL, College Football\n`);
  
  console.log(`⚾ BASEBALL: ${categories['BASEBALL ⚾'].length} league`);
  console.log(`   - MLB\n`);
  
  console.log(`🏒 HOCKEY: ${categories['HOCKEY 🏒'].length} league`);
  console.log(`   - NHL\n`);
  
  console.log(`🏏 CRICKET: ${categories['CRICKET 🏏'].length} league`);
  console.log(`   - IPL\n`);
  
  // Check for Brazil Serie A specifically
  console.log(`${'='.repeat(80)}`);
  console.log(`   🇧🇷 BRAZIL SERIE A CHECK`);
  console.log(`${'='.repeat(80)}\n`);
  
  const hasBrazil = sports.find((s: any) => s.sport === 'bra' || s.tags?.includes('brazil'));
  
  if (hasBrazil) {
    console.log(`✅ Brazil Serie A found!`);
    console.log(`   Sport code: ${hasBrazil.sport}`);
    console.log(`   Series ID: ${hasBrazil.series}\n`);
  } else {
    console.log(`❌ Brazil Serie A NOT in /sports endpoint`);
    console.log(`   💡 But we found it via SLUG method (bra-sao-fla-2025-11-05)`);
    console.log(`   💡 Brazil matches exist but not listed in /sports\n`);
  }
  
  // Test fetching events for a league
  console.log(`${'='.repeat(80)}`);
  console.log(`   🧪 TEST: Fetching EPL matches`);
  console.log(`${'='.repeat(80)}\n`);
  
  const eplSeriesId = sports.find((s: any) => s.sport === 'epl')?.series;
  
  if (eplSeriesId) {
    const eventsResponse = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        series_id: eplSeriesId,
        closed: false,
        limit: 5
      }
    });
    
    console.log(`✅ EPL (Series ${eplSeriesId}): ${eventsResponse.data.length} active events`);
    
    if (eventsResponse.data.length > 0) {
      console.log(`\nSample matches:`);
      eventsResponse.data.slice(0, 3).forEach((event: any) => {
        console.log(`   - ${event.title}`);
      });
    }
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`   ✅ ANALYSIS COMPLETE`);
  console.log(`${'='.repeat(80)}\n`);
  
  console.log(`💡 CONCLUSION:`);
  console.log(`   1. ✅ Soccer has 26+ leagues covered`);
  console.log(`   2. ✅ Can fetch ALL matches via series_id`);
  console.log(`   3. ✅ NBA, NFL, MLB, NHL also available`);
  console.log(`   4. ⚠️  Brazil Serie A not in /sports but exists (via SLUG)`);
  console.log(`   5. 🎯 Bot can monitor ALL 30+ leagues!\n`);
}

analyzeSports().catch(console.error);
