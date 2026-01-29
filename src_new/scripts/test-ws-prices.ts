/**
 * Test: Polymarket WebSocket ile anlık crypto fiyatları
 *
 * Bu WebSocket BTC/ETH/SOL/XRP'nin ANLIK fiyatını veriyor.
 * Price to Beat için hala sayfa fetch lazım (market başında kilitlenen fiyat)
 *
 * Usage:
 *   npx ts-node src_new/scripts/test-ws-prices.ts
 */

import WebSocket from 'ws';
import axios from 'axios';

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

interface CryptoPrice {
  symbol: string;
  value: number;
  fullAccuracy: string;
  timestamp: number;
}

interface MarketInfo {
  slug: string;
  coin: string;
  eventStartTime: string;
  endTime: number;
  priceToBeat: number;
}

// Aktif marketlerin Price to Beat değerleri
const marketPrices: Map<string, MarketInfo> = new Map();

// WebSocket'ten gelen anlık fiyatlar
const currentPrices: Map<string, CryptoPrice> = new Map();

/**
 * Polymarket sayfasından Price to Beat'i al (retry ile)
 */
async function fetchPriceToBeat(slug: string, coin: string, retries: number = 3): Promise<number> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Her attempt arasında bekle
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, 2000));
      }

      const url = `https://polymarket.com/event/${slug}`;
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const html = response.data;
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
      if (!match) {
        if (attempt < retries) continue;
        return 0;
      }

      const nextData = JSON.parse(match[1]);
      const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];

      for (const query of queries) {
        const queryKey = query.queryKey || [];
        if (queryKey[0] === 'crypto-prices' && queryKey[1] === 'price') {
          const data = query.state?.data;
          if (data && typeof data.openPrice === 'number' && data.openPrice > 0) {
            return data.openPrice;
          }
        }
      }

      // openPrice bulunamadı, retry
      if (attempt < retries) {
        console.log(`${C.dim}   ⏳ ${coin} retry ${attempt}/${retries}...${C.reset}`);
      }
    } catch (err) {
      if (attempt === retries) {
        console.log(`${C.red}❌ ${coin} Price to Beat fetch hatası${C.reset}`);
      }
    }
  }
  return 0;
}

/**
 * Aktif 15 dakikalık marketleri keşfet ve Price to Beat'leri al
 */
async function discoverMarkets(silent: boolean = false): Promise<void> {
  const cryptos = ['btc', 'eth', 'sol', 'xrp'];
  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const timestamps = [
    Math.floor(currentInterval / 1000),
    Math.floor((currentInterval + 15 * 60 * 1000) / 1000)
  ];

  if (!silent) console.log(`${C.bold}🔍 Marketleri keşfediyorum...${C.reset}\n`);

  for (const crypto of cryptos) {
    for (const ts of timestamps) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`https://gamma-api.polymarket.com/markets?slug=${slug}`, { timeout: 5000 });

        if (res.data && res.data.length > 0) {
          const market = res.data[0];
          if (!market.closed) {
            const endTime = new Date(market.endDate || market.endDateIso).getTime();
            if (endTime > now && endTime < now + 20 * 60 * 1000) {
              const eventStartTime = market.eventStartTime || '';

              // Price to Beat'i bir kez fetch et
              if (!silent) console.log(`   ${C.cyan}📡 ${crypto.toUpperCase()} Price to Beat alınıyor...${C.reset}`);
              const priceToBeat = await fetchPriceToBeat(slug, crypto.toUpperCase());

              marketPrices.set(crypto.toUpperCase(), {
                slug,
                coin: crypto.toUpperCase(),
                eventStartTime,
                endTime,
                priceToBeat
              });

              const remainingSec = Math.floor((endTime - now) / 1000);
              console.log(`\n${C.green}✅ ${crypto.toUpperCase()} YENİ PERIYOT${C.reset}: Target = $${priceToBeat.toFixed(2)} | ${remainingSec}s kaldı\n`);
              break;
            }
          }
        }
      } catch {
        // Skip
      }
    }
  }
}

/**
 * WebSocket ile anlık fiyatları al
 */
function connectWebSocket(): void {
  const ws = new WebSocket('wss://ws-live-data.polymarket.com');

  ws.on('open', () => {
    console.log(`\n${C.green}✅ WebSocket bağlandı${C.reset}`);

    // Chainlink fiyatlarına subscribe ol (Polymarket'in kullandığı)
    const subscribeMsg = {
      action: 'subscribe',
      subscriptions: [
        { topic: 'crypto_prices_chainlink', type: 'update' }
      ]
    };

    ws.send(JSON.stringify(subscribeMsg));
    console.log(`${C.cyan}📡 crypto_prices_chainlink'e subscribe olundu (Polymarket fiyatı)${C.reset}\n`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Chainlink formatı: symbol = "btc/usd", "eth/usd", etc.
      if (msg.topic === 'crypto_prices_chainlink' && msg.type === 'update' && msg.payload) {
        const payload = msg.payload;
        // "btc/usd" -> "BTC"
        const symbol = payload.symbol?.split('/')[0]?.toUpperCase() || '';

        if (['BTC', 'ETH', 'SOL', 'XRP'].includes(symbol)) {
          currentPrices.set(symbol, {
            symbol,
            value: payload.value,
            fullAccuracy: payload.full_accuracy_value,
            timestamp: payload.timestamp
          });

          // Market bilgisi varsa karşılaştır
          const market = marketPrices.get(symbol);
          if (market && market.priceToBeat > 0) {
            const remainingSec = Math.floor((market.endTime - Date.now()) / 1000);

            // Market bittiyse yeni periyodu bul
            if (remainingSec < -5) {
              // Bu coin için marketi sil - refreshMarkets yenisini bulacak
              marketPrices.delete(symbol);
              return;
            }

            const diff = payload.value - market.priceToBeat;
            const pctChange = ((diff / market.priceToBeat) * 100);
            const color = diff >= 0 ? C.green : C.red;
            const arrow = diff >= 0 ? '↑' : '↓';

            const time = new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
            console.log(`[${time}] ${C.bold}${symbol}${C.reset} $${market.priceToBeat.toFixed(2)} → ${color}$${payload.value.toFixed(2)}${C.reset} ${color}${arrow}${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(3)}%${C.reset} ${remainingSec}s`);
          }
        }
      }
    } catch (err) {
      // Parse error - ignore
    }
  });

  ws.on('error', (err) => {
    console.log(`${C.red}❌ WebSocket hatası: ${err.message}${C.reset}`);
  });

  ws.on('close', () => {
    console.log(`${C.yellow}⚠️ WebSocket kapandı, 3 saniye sonra tekrar bağlanıyor...${C.reset}`);
    setTimeout(connectWebSocket, 3000);
  });

  // Ping gönder (bağlantıyı canlı tut)
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log(`   ${C.bold}📊 POLYMARKET WEBSOCKET PRICE TEST${C.reset}`);
  console.log('='.repeat(70));
  console.log(`   WebSocket: wss://ws-live-data.polymarket.com`);
  console.log(`   Topic: crypto_prices`);
  console.log('='.repeat(70) + '\n');

  // Önce marketleri keşfet ve Price to Beat'leri al
  await discoverMarkets();

  if (marketPrices.size === 0) {
    console.log(`\n${C.yellow}⚠️ Aktif market bulunamadı${C.reset}`);
    return;
  }

  // WebSocket'e bağlan
  console.log(`\n${C.bold}📈 WebSocket ile anlık fiyatlar${C.reset}`);
  console.log('-'.repeat(70));

  connectWebSocket();

  // Her 30 saniyede bir marketleri yenile (yeni periyotları bul)
  setInterval(async () => {
    const now = Date.now();
    let needsRefresh = false;

    // Expired marketleri kontrol et
    for (const [coin, market] of marketPrices) {
      const remainingSec = Math.floor((market.endTime - now) / 1000);
      if (remainingSec < -5) {
        console.log(`\n${C.yellow}🔄 ${coin} market bitti, yeni periyot aranıyor...${C.reset}`);
        marketPrices.delete(coin);
        needsRefresh = true;
      }
    }

    // Eksik coinleri kontrol et
    const cryptos = ['btc', 'eth', 'sol', 'xrp'];
    for (const crypto of cryptos) {
      if (!marketPrices.has(crypto.toUpperCase())) {
        needsRefresh = true;
      }
    }

    if (needsRefresh) {
      await discoverMarkets(true); // silent mode
    }
  }, 10000); // Her 10 saniyede kontrol et
}

main().catch(console.error);
