/**
 * Test script: Polymarket'ten Price to Beat ve Current Price verisi çekme
 *
 * Bu script Polymarket sayfasından __NEXT_DATA__ JSON'ını parse ederek
 * gerçek kripto fiyatlarını alır ve doğruluğunu test eder.
 *
 * Usage:
 *   npx ts-node src_new/scripts/test-crypto-prices.ts
 */

import axios from 'axios';

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

interface CryptoPriceData {
  openPrice: number;      // Price to Beat
  closePrice: number;     // Current Price
  coin: string;
  startTime: string;
  endTime: string;
  interval: string;
}

interface PastResult {
  startTime: string;
  endTime: string;
  openPrice: number;
  closePrice: number;
  outcome: string;
  percentChange: number;
}

/**
 * Polymarket sayfasından gerçek kripto fiyatlarını çek
 */
async function fetchCryptoPrices(slug: string): Promise<{ current: CryptoPriceData | null; past: PastResult[] }> {
  try {
    console.log(`\n${C.cyan}📡 Fetching: https://polymarket.com/event/${slug}${C.reset}`);

    const url = `https://polymarket.com/event/${slug}`;
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    const html = response.data;

    // __NEXT_DATA__ JSON'ını bul
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
    if (!match) {
      console.log(`${C.red}❌ __NEXT_DATA__ bulunamadı${C.reset}`);
      return { current: null, past: [] };
    }

    const nextData = JSON.parse(match[1]);
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];

    let currentData: CryptoPriceData | null = null;
    let pastResults: PastResult[] = [];

    for (const query of queries) {
      const queryKey = query.queryKey || [];

      // crypto-prices query: ['crypto-prices', 'price', 'BTC', '2026-01-29T13:45:00Z', 'fifteen', '2026-01-29T14:00:00Z']
      if (queryKey[0] === 'crypto-prices' && queryKey[1] === 'price') {
        const data = query.state?.data;
        if (data && typeof data.openPrice === 'number') {
          currentData = {
            openPrice: data.openPrice,
            closePrice: data.closePrice,
            coin: queryKey[2],
            startTime: queryKey[3],
            endTime: queryKey[5],
            interval: queryKey[4]
          };
        }
      }

      // past-results query: ['past-results', 'BTC', 'fifteen', '2026-01-29T13:45:00Z']
      if (queryKey[0] === 'past-results') {
        const data = query.state?.data?.data?.results;
        if (Array.isArray(data)) {
          pastResults = data;
        }
      }
    }

    return { current: currentData, past: pastResults };
  } catch (err: any) {
    console.log(`${C.red}❌ Hata: ${err.message}${C.reset}`);
    return { current: null, past: [] };
  }
}

/**
 * Aktif 15 dakikalık marketleri keşfet
 */
async function discoverActiveMarkets(): Promise<string[]> {
  const cryptos = ['btc', 'eth', 'sol', 'xrp'];
  const slugs: string[] = [];

  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const timestamps = [
    Math.floor(currentInterval / 1000),
    Math.floor((currentInterval + 15 * 60 * 1000) / 1000)
  ];

  console.log(`${C.bold}🔍 Aktif marketleri arıyorum...${C.reset}`);

  for (const crypto of cryptos) {
    for (const ts of timestamps) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`https://gamma-api.polymarket.com/markets?slug=${slug}`, { timeout: 5000 });

        if (res.data && res.data.length > 0) {
          const market = res.data[0];
          if (!market.closed) {
            const endTime = new Date(market.endDate || market.endDateIso).getTime();
            if (endTime > now) {
              slugs.push(slug);
              const remainingSec = Math.floor((endTime - now) / 1000);
              console.log(`   ${C.green}✅ ${crypto.toUpperCase()}${C.reset}: ${slug} | ${remainingSec}s kaldı`);
            }
          }
        }
      } catch {
        // Skip
      }
    }
  }

  return slugs;
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log(`   ${C.bold}📊 POLYMARKET CRYPTO PRICE TEST${C.reset}`);
  console.log('='.repeat(70));
  console.log(`   Bu test Polymarket'in Price to Beat ve Current Price verilerini çeker`);
  console.log(`   ve doğruluğunu kontrol eder.`);
  console.log('='.repeat(70) + '\n');

  // Aktif marketleri bul
  const slugs = await discoverActiveMarkets();

  if (slugs.length === 0) {
    console.log(`\n${C.yellow}⚠️ Aktif market bulunamadı${C.reset}`);
    return;
  }

  console.log(`\n${C.bold}📈 Fiyat Verileri${C.reset}`);
  console.log('-'.repeat(70));

  for (const slug of slugs) {
    const { current, past } = await fetchCryptoPrices(slug);

    if (current) {
      const diff = current.closePrice - current.openPrice;
      const pctChange = ((diff / current.openPrice) * 100).toFixed(4);
      const diffStr = diff >= 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
      const color = diff >= 0 ? C.green : C.red;
      const direction = diff >= 0 ? 'UP 📈' : 'DOWN 📉';

      console.log(`\n${C.bold}${current.coin}${C.reset} (${current.interval})`);
      console.log(`   Periyot:       ${current.startTime} → ${current.endTime}`);
      console.log(`   ${C.yellow}Price to Beat:  $${current.openPrice.toFixed(2)}${C.reset}`);
      console.log(`   ${color}Current Price:  $${current.closePrice.toFixed(2)}${C.reset}`);
      console.log(`   Fark:          ${color}${diffStr} (${pctChange}%)${C.reset}`);
      console.log(`   Yön:           ${color}${direction}${C.reset}`);
    }

    // Son 4 periyodun sonuçlarını göster
    if (past.length > 0) {
      console.log(`\n   ${C.dim}Son ${past.length} periyod:${C.reset}`);
      for (const p of past.slice(-4)) {
        const pDiff = p.closePrice - p.openPrice;
        const pColor = p.outcome === 'up' ? C.green : C.red;
        const arrow = p.outcome === 'up' ? '↑' : '↓';
        console.log(`   ${pColor}${arrow}${C.reset} ${p.startTime.split('T')[1].slice(0,5)} → ${p.endTime.split('T')[1].slice(0,5)}: $${p.openPrice.toFixed(2)} → $${p.closePrice.toFixed(2)} (${p.percentChange.toFixed(3)}%)`);
      }
    }
  }

  // Sürekli güncelleme modu
  console.log(`\n${C.cyan}🔄 5 saniyede bir güncelleniyor... (Ctrl+C ile çık)${C.reset}\n`);

  const updateLoop = async () => {
    while (true) {
      await new Promise(r => setTimeout(r, 5000));

      const time = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
      process.stdout.write(`\r[${time}] `);

      for (const slug of slugs) {
        const { current } = await fetchCryptoPrices(slug);
        if (current) {
          const diff = current.closePrice - current.openPrice;
          const color = diff >= 0 ? C.green : C.red;
          const arrow = diff >= 0 ? '↑' : '↓';
          process.stdout.write(`${current.coin}: $${current.openPrice.toFixed(2)} → ${color}$${current.closePrice.toFixed(2)}${C.reset} ${color}${arrow}${C.reset}  `);
        }
      }
    }
  };

  updateLoop().catch(() => {});
}

main().catch(console.error);
