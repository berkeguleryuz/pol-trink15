import axios from 'axios';
import * as cheerio from 'cheerio';

interface PolymarketMatch {
  sport: string; // UEL, EPL, La Liga, etc
  homeTeam: string;
  awayTeam: string;
  slug: string;
  startTime?: Date;
  url: string;
  volume?: string;
}

async function scrapePolymarketSports(): Promise<PolymarketMatch[]> {
  console.log('\n' + '='.repeat(80));
  console.log('   🔍 POLYMARKET SPORTS SCRAPER');
  console.log('='.repeat(80));

  try {
    console.log('\n📡 Polymarket /sports/live sayfası çekiliyor...');
    
    const response = await axios.get('https://polymarket.com/sports/live', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });

    console.log(`✅ Sayfa çekildi (${response.data.length} bytes)`);

    const $ = cheerio.load(response.data);
    const matches: PolymarketMatch[] = [];

    // Polymarket'in yapısını analiz edelim
    // Sport kategorileri: UEL, EPL, La Liga, etc
    console.log('\n🔍 Sayfa yapısı analiz ediliyor...');

    // Link'leri bul
    const links = $('a[href*="/event/"]');
    console.log(`   📊 ${links.length} event link bulundu`);

    links.each((i, elem) => {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim();
      
      if (href && text) {
        console.log(`   ${i + 1}. ${text} → ${href}`);
      }
    });

    // Alternatif: JSON data içinde ara
    const scripts = $('script[type="application/json"]');
    console.log(`\n📊 ${scripts.length} JSON script tag bulundu`);

    scripts.each((i, elem) => {
      const content = $(elem).html();
      if (content && content.includes('market')) {
        console.log(`\n🔍 Script ${i + 1}:`);
        try {
          const data = JSON.parse(content);
          console.log(JSON.stringify(data, null, 2).slice(0, 500));
        } catch (e) {
          console.log('   ❌ JSON parse hatası');
        }
      }
    });

    // Next.js data'sını ara
    const nextData = $('#__NEXT_DATA__');
    if (nextData.length > 0) {
      console.log('\n🎯 Next.js data bulundu!');
      try {
        const data = JSON.parse(nextData.html() || '{}');
        
        // Props içinde sports data'sı olabilir
        if (data.props?.pageProps) {
          console.log('\n📊 Page Props:');
          console.log(JSON.stringify(data.props.pageProps, null, 2).slice(0, 1000));
          
          // Markets veya events ara
          const pageProps = data.props.pageProps;
          if (pageProps.markets) {
            console.log(`\n✅ ${pageProps.markets.length} market bulundu!`);
          }
          if (pageProps.events) {
            console.log(`\n✅ ${pageProps.events.length} event bulundu!`);
          }
        }
      } catch (e: any) {
        console.log('   ❌ Next.js data parse hatası:', e.message);
      }
    }

    return matches;

  } catch (error: any) {
    console.error('\n❌ Scraping hatası:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Headers:', error.response.headers);
    }
    return [];
  }
}

async function extractSportsFromNextData() {
  console.log('\n' + '='.repeat(80));
  console.log('   🎯 POLYMARKET NEXT.JS DATA EXTRACTOR');
  console.log('='.repeat(80));

  try {
    const response = await axios.get('https://polymarket.com/sports/live', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      }
    });

    const $ = cheerio.load(response.data);
    const nextData = $('#__NEXT_DATA__');
    
    if (nextData.length === 0) {
      console.log('❌ Next.js data bulunamadı');
      return;
    }

    const data = JSON.parse(nextData.html() || '{}');
    
    // Tüm yapıyı göster
    console.log('\n📊 Next.js Data Yapısı:');
    const keys = Object.keys(data);
    console.log('   Root keys:', keys);
    
    if (data.props) {
      console.log('   Props keys:', Object.keys(data.props));
      
      if (data.props.pageProps) {
        console.log('   PageProps keys:', Object.keys(data.props.pageProps));
        
        // Her bir key'i kontrol et
        for (const key of Object.keys(data.props.pageProps)) {
          const value = data.props.pageProps[key];
          if (Array.isArray(value)) {
            console.log(`\n   ✅ ${key}: Array (${value.length} items)`);
            if (value.length > 0) {
              console.log('      İlk item:', JSON.stringify(value[0], null, 2).slice(0, 300));
            }
          } else if (typeof value === 'object' && value !== null) {
            console.log(`\n   ✅ ${key}: Object`);
            console.log('      Keys:', Object.keys(value).slice(0, 10));
          }
        }
      }
    }

    // Tam data'yı kaydet
    const fs = require('fs');
    fs.writeFileSync('/tmp/polymarket-nextjs-data.json', JSON.stringify(data, null, 2));
    console.log('\n💾 Tam data kaydedildi: /tmp/polymarket-nextjs-data.json');

  } catch (error: any) {
    console.error('❌ Hata:', error.message);
  }
}

// Her iki fonksiyonu da çalıştır
async function main() {
  await scrapePolymarketSports();
  console.log('\n' + '='.repeat(80));
  await extractSportsFromNextData();
}

main();
