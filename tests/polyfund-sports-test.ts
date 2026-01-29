import axios from 'axios';

interface PolyfundMarket {
  id: string;
  question: string;
  slug: string;
  endDate?: string;
  startDate?: string;
  volume24hr?: number;
  liquidity?: number;
  outcomes?: any[];
  tokens?: any[];
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
}

async function fetchPolyfundSportsMarkets() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚽ POLYFUND SPORTS API - AKTIF MAÇLAR');
  console.log('='.repeat(80));

  try {
    console.log('\n📡 Polyfund API çağrılıyor...');
    
    const response = await axios.get('https://www.polyfund.so/api/market-items', {
      params: {
        limit: 100,
        offset: 0,
        active: true,
        archived: false,
        closed: false,
        order: 'volume24hr',
        ascending: false,
        liquidity_num_min: 1,
        tag_id: 1  // Sports tag
      },
      timeout: 10000
    });

    console.log(`✅ ${response.data.length || 'N/A'} market bulundu`);
    
    // Response yapısını göster
    console.log('\n📊 Response yapısı:');
    if (Array.isArray(response.data)) {
      console.log(`   Array: ${response.data.length} items`);
      if (response.data.length > 0) {
        console.log('\n   İlk item keys:');
        console.log('   ', Object.keys(response.data[0]));
      }
    } else if (response.data.data) {
      console.log(`   Nested data: ${response.data.data.length} items`);
    } else {
      console.log('   Keys:', Object.keys(response.data));
    }

    // Maçları parse et
    const markets = Array.isArray(response.data) ? response.data : (response.data.data || []);
    
    console.log('\n' + '='.repeat(80));
    console.log(`📊 TOPLAM ${markets.length} SPOR MARKETI`);
    console.log('='.repeat(80));

    // Bugünün tarihini al
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    let todayMatches = 0;
    let upcomingMatches = 0;

    for (let i = 0; i < Math.min(markets.length, 50); i++) {
      const market = markets[i];
      
      console.log(`\n${i + 1}. ⚽ ${market.question || market.title}`);
      console.log(`   🔗 Slug: ${market.slug}`);
      
      if (market.conditionId || market.condition_id) {
        console.log(`   🎯 Condition ID: ${market.conditionId || market.condition_id}`);
      }
      
      // End date
      const endDate = market.endDate || market.end_date || market.endDateIso;
      if (endDate) {
        const date = new Date(endDate);
        console.log(`   ⏰ Bitiş: ${date.toLocaleString('tr-TR')}`);
        
        // Bugün mü?
        const dateStr = date.toISOString().split('T')[0];
        if (dateStr === todayStr) {
          console.log(`   🔴 BUGÜN!`);
          todayMatches++;
        } else if (date > today) {
          console.log(`   📅 ${Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))} gün sonra`);
          upcomingMatches++;
        }
      }

      // Volume
      if (market.volume24hr || market.volume) {
        console.log(`   💰 Volume: $${(market.volume24hr || market.volume || 0).toLocaleString()}`);
      }

      // Liquidity
      if (market.liquidity) {
        console.log(`   💧 Liquidity: $${market.liquidity.toLocaleString()}`);
      }

      // Outcomes
      if (market.outcomes && market.outcomes.length > 0) {
        console.log(`   🎲 Outcomes: ${market.outcomes.map((o: any) => o.title || o).join(', ')}`);
      }

      // Tokens
      if (market.tokens && market.tokens.length > 0) {
        console.log(`   🪙 Tokens: ${market.tokens.length} token`);
      }

      // Takım isimlerini çıkar (slug'dan)
      const slug = market.slug || '';
      if (slug.includes('-vs-')) {
        const parts = slug.split('-vs-');
        if (parts.length >= 2) {
          const homeTeam = parts[0].split('-').map((w: string) => 
            w.charAt(0).toUpperCase() + w.slice(1)
          ).join(' ');
          const awayPart = parts[1].split('-')[0];
          const awayTeam = awayPart.charAt(0).toUpperCase() + awayPart.slice(1);
          console.log(`   🏆 Maç: ${homeTeam} vs ${awayTeam}`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 ÖZET:');
    console.log(`   Toplam market: ${markets.length}`);
    console.log(`   Bugün olan: ${todayMatches}`);
    console.log(`   Yaklaşan: ${upcomingMatches}`);
    console.log('='.repeat(80));

    // JSON'a kaydet
    const fs = require('fs');
    fs.writeFileSync('/tmp/polyfund-sports-markets.json', JSON.stringify(markets, null, 2));
    console.log('\n💾 Detaylar kaydedildi: /tmp/polyfund-sports-markets.json');

    return markets;

  } catch (error: any) {
    console.error('\n❌ Hata:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2).slice(0, 500));
    }
    return [];
  }
}

fetchPolyfundSportsMarkets();
