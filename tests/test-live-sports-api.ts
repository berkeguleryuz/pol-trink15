import axios from 'axios';

/**
 * Polymarket'in LIVE sports API'sini test et
 * 
 * Screenshot'ta görünen maçlar:
 * - CA Mineiro 3-0 EC Bahia (2H 88')
 * - Grêmio 0-1 Cruzeiro (2H 88')
 * - São Paulo 1-1 Flamengo (1H 18')
 */

(async () => {
  console.log('🔍 Testing Polymarket Live Sports API\n');
  
  // Test 1: Tüm aktif events (closed=false)
  console.log('📡 Test 1: All active events (closed=false)...\n');
  
  const response1 = await axios.get('https://gamma-api.polymarket.com/events', {
    params: {
      closed: false,
      limit: 500,
    },
  });
  
  const allEvents = response1.data || [];
  console.log(`Found ${allEvents.length} active events\n`);
  
  // Brezilya futbol takımlarını ara
  const brazilKeywords = ['mineiro', 'bahia', 'gremio', 'grêmio', 'cruzeiro', 'são paulo', 'sao paulo', 'flamengo'];
  
  const brazilMatches = allEvents.filter((e: any) => {
    const title = (e.title || '').toLowerCase();
    return brazilKeywords.some(kw => title.includes(kw));
  });
  
  console.log(`🇧🇷 Found ${brazilMatches.length} Brazil-related events:\n`);
  
  brazilMatches.forEach((e: any) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Title: ${e.title}`);
    console.log(`Slug: ${e.slug}`);
    console.log(`Active: ${e.active}`);
    console.log(`Closed: ${e.closed}`);
    console.log(`Start: ${e.startDate}`);
    console.log(`End: ${e.endDate}`);
    
    if (e.markets && e.markets.length > 0) {
      console.log(`Markets: ${e.markets.length}`);
      console.log(`First market: ${e.markets[0].question}`);
    }
    console.log('');
  });
  
  // Test 2: Order by recent
  console.log('\n📡 Test 2: Recent events (order=id, ascending=false)...\n');
  
  const response2 = await axios.get('https://gamma-api.polymarket.com/events', {
    params: {
      closed: false,
      order: 'id',
      ascending: false,
      limit: 100,
    },
  });
  
  const recentEvents = response2.data || [];
  const recentBrazil = recentEvents.filter((e: any) => {
    const title = (e.title || '').toLowerCase();
    return brazilKeywords.some(kw => title.includes(kw));
  });
  
  console.log(`🇧🇷 Recent Brazil matches: ${recentBrazil.length}\n`);
  
  recentBrazil.forEach((e: any) => {
    console.log(`- ${e.title} (${e.slug})`);
  });
})();
