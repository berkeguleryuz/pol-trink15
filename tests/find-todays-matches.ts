import axios from 'axios';

interface PolymarketMarket {
  id?: string;
  question: string;
  slug: string;
  conditionId?: string;
  endDate?: string;
  startDate?: string;
  volume?: number;
  outcomes?: string[];
  clobTokenIds?: string[];
  active?: boolean;
  closed?: boolean;
}

async function findTodaysSportsMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚽ POLYMARKET BUGÜNKÜ SPOR MAÇLARI');
  console.log('='.repeat(80));

  try {
    // Bugünün başlangıç ve bitiş timestamp'leri
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 7); // Önümüzdeki 7 gün

    console.log(`\n📅 Tarih Aralığı:`);
    console.log(`   Başlangıç: ${todayStart.toISOString()}`);
    console.log(`   Bitiş: ${todayEnd.toISOString()}`);
    console.log(`   (Önümüzdeki 7 gün)`);

    // Gamma API'den tüm aktif marketleri çek
    console.log('\n📡 Polymarket Gamma API çağrılıyor...');
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        limit: 500,
        active: true,
        closed: false
      },
      timeout: 10000
    });

    console.log(`✅ ${response.data.length} aktif market bulundu\n`);

    const sportsMatches: PolymarketMarket[] = [];
    
    // Spor maçlarını filtrele
    for (const market of response.data) {
      const question = market.question || '';
      const slug = market.slug || '';
      const endDateStr = market.endDate || market.end_date;
      
      // Spor pattern'leri
      const isSports = 
        question.toLowerCase().includes(' vs ') ||
        question.toLowerCase().includes(' v ') ||
        question.toLowerCase().includes('will the match') ||
        question.toLowerCase().includes('who will win') ||
        slug.includes('-vs-') ||
        slug.includes('football') ||
        slug.includes('soccer') ||
        slug.includes('champions') ||
        slug.includes('premier') ||
        slug.includes('laliga') ||
        slug.includes('bundesliga') ||
        slug.includes('ligue') ||
        slug.includes('serie-a');

      if (!isSports) continue;

      // End date kontrolü - bugün veya yarın biten maçlar
      if (endDateStr) {
        const endDate = new Date(endDateStr);
        if (endDate >= todayStart && endDate <= todayEnd) {
          sportsMatches.push({
            id: market.id,
            question: question,
            slug: slug,
            conditionId: market.conditionId || market.condition_id,
            endDate: endDateStr,
            startDate: market.startDate || market.start_date,
            volume: market.volume || 0,
            outcomes: market.outcomes,
            clobTokenIds: market.clobTokenIds || market.clob_token_ids || market.tokens,
            active: market.active,
            closed: market.closed
          });
        }
      }
    }

    // Sonuçları göster
    console.log('='.repeat(80));
    console.log(`📊 BUGÜNKÜ SPOR MAÇLARI: ${sportsMatches.length} maç bulundu`);
    console.log('='.repeat(80));

    if (sportsMatches.length === 0) {
      console.log('\n⚠️  Bugün için aktif spor maçı bulunamadı.');
      console.log('💡 İpucu: Büyük ligler (Champions League, Premier League) genellikle');
      console.log('         hafta içi akşamları ve hafta sonları oynanır.');
      return [];
    }

    // Maçları end date'e göre sırala
    sportsMatches.sort((a, b) => {
      const dateA = new Date(a.endDate!).getTime();
      const dateB = new Date(b.endDate!).getTime();
      return dateA - dateB;
    });

    // Detaylı gösterim
    for (let i = 0; i < sportsMatches.length; i++) {
      const match = sportsMatches[i];
      const endDate = new Date(match.endDate!);
      const startDate = match.startDate ? new Date(match.startDate) : null;
      
      console.log(`\n${i + 1}. ⚽ ${match.question}`);
      console.log(`   🔗 Slug: ${match.slug}`);
      console.log(`   🎯 Condition ID: ${match.conditionId || 'N/A'}`);
      
      if (startDate) {
        const startStr = startDate.toLocaleString('tr-TR', { 
          dateStyle: 'short', 
          timeStyle: 'short' 
        });
        console.log(`   📅 Başlangıç: ${startStr}`);
      }
      
      const endStr = endDate.toLocaleString('tr-TR', { 
        dateStyle: 'short', 
        timeStyle: 'short' 
      });
      console.log(`   ⏰ Bitiş: ${endStr}`);
      console.log(`   💰 Volume: $${Math.round(match.volume || 0).toLocaleString()}`);
      
      if (match.outcomes && match.outcomes.length > 0) {
        console.log(`   🎲 Outcomes: ${match.outcomes.join(', ')}`);
      }
      
      if (match.clobTokenIds && match.clobTokenIds.length > 0) {
        console.log(`   🪙 Token IDs: ${match.clobTokenIds.slice(0, 2).join(', ')}${match.clobTokenIds.length > 2 ? '...' : ''}`);
      }

      // Maç kaç saat sonra?
      if (startDate) {
        const hoursUntil = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntil > 0 && hoursUntil < 24) {
          console.log(`   ⏱️  ${Math.round(hoursUntil)} saat sonra başlayacak`);
        } else if (hoursUntil <= 0) {
          console.log(`   🔴 MAÇ BAŞLADI veya CANLIDA olabilir!`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`📈 Toplam Volume: $${sportsMatches.reduce((sum, m) => sum + (m.volume || 0), 0).toLocaleString()}`);
    console.log('='.repeat(80));

    // JSON olarak kaydet
    const fs = require('fs');
    const outputPath = '/tmp/polymarket-todays-matches.json';
    fs.writeFileSync(outputPath, JSON.stringify(sportsMatches, null, 2));
    console.log(`\n💾 Detaylar kaydedildi: ${outputPath}`);

    return sportsMatches;

  } catch (error: any) {
    console.error('\n❌ Hata:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    return [];
  }
}

findTodaysSportsMatches().then((matches) => {
  console.log(`\n✅ İşlem tamamlandı. ${matches.length} maç bulundu.`);
  process.exit(0);
});
