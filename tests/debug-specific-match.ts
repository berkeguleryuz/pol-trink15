import axios from 'axios';

/**
 * https://polymarket.com/event/bra-sao-fla-2025-11-05
 * Bu maçı API'den almaya çalışalım
 */

async function debugSpecificMatch() {
  console.log('🔍 Searching for: São Paulo vs Flamengo (2025-11-05)\n');
  
  // 1. Event slug'ından direkt al
  console.log('📡 Method 1: Direct event by slug\n');
  try {
    const eventResponse = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        slug: 'bra-sao-fla-2025-11-05'
      }
    });
    console.log('✅ Event found by slug:');
    console.log(JSON.stringify(eventResponse.data, null, 2));
  } catch (error: any) {
    console.log('❌ Not found by slug\n');
  }
  
  // 2. TÜM Brazil maçlarını al
  console.log('\n📡 Method 2: All Brazil events\n');
  try {
    const brazilResponse = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        tag: 'bra',
        closed: false,
        limit: 100
      }
    });
    
    console.log(`Found ${brazilResponse.data.length} Brazil events\n`);
    
    // São Paulo vs Flamengo ara
    const saoFlaMatch = brazilResponse.data.find((event: any) => {
      const title = event.title?.toLowerCase() || '';
      return (title.includes('são paulo') || title.includes('sao paulo')) && 
             title.includes('flamengo');
    });
    
    if (saoFlaMatch) {
      console.log('✅ FOUND São Paulo vs Flamengo:');
      console.log(JSON.stringify(saoFlaMatch, null, 2));
    } else {
      console.log('❌ São Paulo vs Flamengo NOT found in Brazil events');
      console.log('\nAll Brazil events:');
      brazilResponse.data.forEach((event: any) => {
        console.log(`- ${event.title} | ${event.slug}`);
      });
    }
  } catch (error: any) {
    console.log('❌ Error fetching Brazil events:', error.message);
  }
  
  // 3. Markets ile ara
  console.log('\n\n📡 Method 3: Search in markets\n');
  try {
    const marketsResponse = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        closed: false,
        limit: 500
      }
    });
    
    console.log(`Checking ${marketsResponse.data.length} markets...\n`);
    
    const saoFlaMarkets = marketsResponse.data.filter((market: any) => {
      const title = (market.question || '').toLowerCase();
      return (title.includes('são paulo') || title.includes('sao paulo') || title.includes('sao')) && 
             (title.includes('flamengo') || title.includes('fla'));
    });
    
    if (saoFlaMarkets.length > 0) {
      console.log(`✅ FOUND ${saoFlaMarkets.length} markets:`);
      saoFlaMarkets.forEach((market: any) => {
        console.log(`\n- ${market.question}`);
        console.log(`  conditionId: ${market.conditionId}`);
        console.log(`  slug: ${market.slug}`);
      });
    } else {
      console.log('❌ No markets found for São Paulo vs Flamengo');
    }
  } catch (error: any) {
    console.log('❌ Error fetching markets:', error.message);
  }
  
  // 4. Direkt event ID ile dene (URL'den çıkararak)
  console.log('\n\n📡 Method 4: Try direct API patterns\n');
  
  const possibleEndpoints = [
    'https://gamma-api.polymarket.com/events/bra-sao-fla-2025-11-05',
    'https://gamma-api.polymarket.com/event/bra-sao-fla-2025-11-05',
    'https://gamma-api.polymarket.com/sports/events/bra-sao-fla-2025-11-05',
  ];
  
  for (const endpoint of possibleEndpoints) {
    try {
      const response = await axios.get(endpoint);
      console.log(`✅ SUCCESS: ${endpoint}`);
      console.log(JSON.stringify(response.data, null, 2));
      break;
    } catch (error: any) {
      console.log(`❌ ${endpoint} - Not found`);
    }
  }
}

debugSpecificMatch().catch(console.error);
