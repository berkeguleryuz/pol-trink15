import axios from 'axios';

async function checkPolymarketSports() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚽ POLYMARKET SPORTS CHECKER');
  console.log('='.repeat(80));

  try {
    // Polymarket'in sports endpoint'ini deneyelim
    console.log('\n📡 Polymarket Sports API kontrol ediliyor...\n');
    
    const endpoints = [
      'https://gamma-api.polymarket.com/markets?tag=sports',
      'https://gamma-api.polymarket.com/markets?active=true&closed=false',
      'https://clob.polymarket.com/markets',
      'https://strapi-matic.poly.market/markets?active=true'
    ];

    for (const endpoint of endpoints) {
      console.log(`\n🔍 Test: ${endpoint}`);
      try {
        const response = await axios.get(endpoint, {
          params: {
            limit: 20,
            active: true
          },
          timeout: 5000
        });

        console.log(`   ✅ Status: ${response.status}`);
        console.log(`   📊 Data type: ${Array.isArray(response.data) ? 'Array' : typeof response.data}`);
        
        if (Array.isArray(response.data)) {
          console.log(`   📈 Items: ${response.data.length}`);
          
          // İlk 3 item'ı göster
          for (let i = 0; i < Math.min(3, response.data.length); i++) {
            const item = response.data[i];
            console.log(`\n   ${i + 1}. ${item.question || item.title || 'N/A'}`);
            console.log(`      Slug: ${item.slug || 'N/A'}`);
            console.log(`      Condition ID: ${item.conditionId || item.condition_id || 'N/A'}`);
            console.log(`      Tags: ${(item.tags || []).join(', ') || 'N/A'}`);
            
            // Futbol maçı pattern'i kontrol et
            const text = (item.question || item.title || '').toLowerCase();
            if (text.includes(' vs ') || text.includes(' v ') || text.includes('win') || text.includes('match')) {
              console.log(`      🎯 POSSIBLE SPORTS MATCH!`);
            }
          }
        } else if (response.data.markets) {
          console.log(`   📈 Markets: ${response.data.markets.length}`);
        }
        
      } catch (error: any) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }

    // Strapi endpoint'i dene (Polymarket'in eski API'si)
    console.log('\n\n📡 Strapi Polymarket API kontrol ediliyor...');
    try {
      const strapiResponse = await axios.get('https://strapi-matic.poly.market/markets', {
        params: {
          _limit: 50,
          active: true,
          closed: false,
          _sort: 'volume:desc'
        }
      });

      console.log(`\n✅ ${strapiResponse.data.length} aktif market bulundu`);

      let sportsCount = 0;
      for (const market of strapiResponse.data) {
        const question = market.question || '';
        const tags = market.tags || [];
        
        // Sport tag'i var mı veya "vs" pattern'i var mı?
        const hasSportsTag = tags.some((tag: string) => 
          tag.toLowerCase().includes('sport') || 
          tag.toLowerCase().includes('soccer') ||
          tag.toLowerCase().includes('football')
        );
        
        const hasVsPattern = question.includes(' vs ') || question.includes(' v ');
        
        if (hasSportsTag || hasVsPattern) {
          sportsCount++;
          console.log(`\n⚽ ${question}`);
          console.log(`   🔗 Slug: ${market.slug}`);
          console.log(`   🎯 Condition ID: ${market.conditionId || market.condition_id}`);
          console.log(`   🏷️  Tags: ${tags.join(', ')}`);
          console.log(`   💰 Volume: $${market.volume || 0}`);
          console.log(`   📅 End: ${market.endDate || market.end_date || 'N/A'}`);
          
          // Token ID varsa göster
          if (market.clobTokenIds || market.clob_token_ids) {
            const tokenIds = market.clobTokenIds || market.clob_token_ids;
            console.log(`   🪙 Token IDs: ${JSON.stringify(tokenIds)}`);
          }
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log(`📊 ÖZET: ${sportsCount} spor maçı bulundu (${strapiResponse.data.length} toplam market)`);
      console.log('='.repeat(80));

    } catch (error: any) {
      console.error('\n❌ Strapi API hatası:', error.message);
    }

  } catch (error: any) {
    console.error('\n❌ Genel hata:', error.message);
  }
}

checkPolymarketSports();
