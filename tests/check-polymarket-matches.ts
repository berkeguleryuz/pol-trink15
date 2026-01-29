import axios from 'axios';

async function checkPolymarketMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('   🔍 POLYMARKET MAÇLARI KONTROL');
  console.log('='.repeat(80));

  try {
    // Tüm aktif eventleri çek
    console.log('\n📡 Polymarket API çekiliyor...');
    const response = await axios.get('https://gamma-api.polymarket.com/events', {
      params: {
        limit: 100,
        active: true
      }
    });

    console.log(`\n✅ ${response.data.length} aktif event bulundu\n`);

    // Spor eventlerini filtrele
    let sportsCount = 0;
    let footballCount = 0;

    for (const event of response.data) {
      const tags = event.tags || [];
      
      // Tags string mi array mi kontrol et
      const tagArray = Array.isArray(tags) ? tags : [];
      
      const isSports = tagArray.some((tag: any) => {
        const tagStr = String(tag).toLowerCase();
        return tagStr.includes('sport') || 
               tagStr.includes('soccer') ||
               tagStr.includes('football');
      });

      if (isSports) {
        sportsCount++;
        console.log(`\n📊 Event: ${event.title || 'Untitled'}`);
        console.log(`   🏷️  Tags: ${tagArray.join(', ')}`);
        console.log(`   🔗 Slug: ${event.slug || 'N/A'}`);
        
        if (event.markets && event.markets.length > 0) {
          console.log(`   📈 ${event.markets.length} market:`);
          for (const market of event.markets) {
            console.log(`      • ${market.question || 'N/A'}`);
            console.log(`        Token: ${market.clobTokenIds?.[0] || 'N/A'}`);
            console.log(`        Condition: ${market.conditionId || 'N/A'}`);
            
            // Futbol maçı mı?
            const question = market.question || '';
            if (question.includes(' vs ') || question.includes(' v ')) {
              footballCount++;
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`📊 ÖZET:`);
    console.log(`   Toplam event: ${response.data.length}`);
    console.log(`   Spor eventi: ${sportsCount}`);
    console.log(`   Futbol maçı: ${footballCount}`);
    console.log('='.repeat(80));

    // Alternatif: Markets endpoint'i dene
    console.log('\n\n📡 Markets endpoint deneniyor...');
    const marketsResponse = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        limit: 100,
        active: true,
        closed: false
      }
    });

    console.log(`\n✅ ${marketsResponse.data.length} aktif market bulundu\n`);

    let footballMarketsCount = 0;
    for (const market of marketsResponse.data) {
      const question = market.question || '';
      if (question.includes(' vs ') || question.includes(' v ')) {
        footballMarketsCount++;
        console.log(`\n⚽ ${question}`);
        console.log(`   🔗 Slug: ${market.slug || 'N/A'}`);
        console.log(`   🎯 Condition: ${market.conditionId || 'N/A'}`);
        console.log(`   📅 End Date: ${market.endDate || 'N/A'}`);
        console.log(`   🏷️  Tags: ${(market.tags || []).join(', ')}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`📊 Markets Endpoint Özet:`);
    console.log(`   Toplam market: ${marketsResponse.data.length}`);
    console.log(`   Futbol maçı: ${footballMarketsCount}`);
    console.log('='.repeat(80));

  } catch (error: any) {
    console.error('\n❌ Hata:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkPolymarketMatches();
