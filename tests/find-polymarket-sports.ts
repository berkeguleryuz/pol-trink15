import axios from 'axios';

async function findPolymarketSportsMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚽ POLYMARKET SPORTS MATCHES');
  console.log('='.repeat(80));

  try {
    console.log('\n📡 Gamma API - Tüm aktif marketler çekiliyor...\n');
    
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        limit: 200,
        active: true,
        closed: false
      }
    });

    console.log(`✅ ${response.data.length} aktif market bulundu\n`);

    let sportsMatches = 0;
    const matches: any[] = [];

    for (const market of response.data) {
      const question = market.question || '';
      const slug = market.slug || '';
      
      // Spor maçı pattern'leri
      const patterns = [
        ' vs ',
        ' v ',
        'Will the match',
        'Who will win',
        'match result',
        'game result',
        'football',
        'soccer',
        'champions league',
        'premier league',
        'la liga',
        'serie a',
        'bundesliga',
        'world cup',
        'euro 202',
        'copa america'
      ];

      const isSportsMatch = patterns.some(pattern => 
        question.toLowerCase().includes(pattern.toLowerCase()) ||
        slug.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isSportsMatch) {
        sportsMatches++;
        matches.push(market);
        
        console.log(`${sportsMatches}. ⚽ ${question}`);
        console.log(`   🔗 Slug: ${slug}`);
        console.log(`   🎯 Condition ID: ${market.conditionId || 'N/A'}`);
        console.log(`   📅 End Date: ${market.endDate || 'N/A'}`);
        console.log(`   💰 Volume: $${market.volume || 0}`);
        console.log(`   🪙 Token IDs: ${JSON.stringify(market.clobTokenIds || market.tokens || 'N/A')}`);
        
        // Outcomes (Yes/No veya takım isimleri)
        if (market.outcomes) {
          const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [market.outcomes];
          console.log(`   🎲 Outcomes: ${outcomes.join(' | ')}`);
        }
        
        console.log('');
      }
    }

    console.log('='.repeat(80));
    console.log(`📊 ÖZET: ${sportsMatches} spor maçı bulundu (${response.data.length} toplam)`);
    console.log('='.repeat(80));

    // Spor maçlarını JSON olarak kaydet
    if (matches.length > 0) {
      const fs = require('fs');
      fs.writeFileSync(
        '/tmp/polymarket-sports-matches.json',
        JSON.stringify(matches, null, 2)
      );
      console.log('\n💾 Detaylar kaydedildi: /tmp/polymarket-sports-matches.json');
    }

  } catch (error: any) {
    console.error('\n❌ Hata:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

findPolymarketSportsMatches();
