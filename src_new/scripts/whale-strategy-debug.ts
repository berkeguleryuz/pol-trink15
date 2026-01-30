/**
 * WHALE STRATEGY DEBUG
 *
 * 2 whale'in stratejisini debug et:
 * - 0xe00740bce98a594e26861838885ab310ec3b548c (Whale A)
 * - 0x336848a1a1cb00348020c9457676f34d882f21cd (Whale B)
 *
 * Her işlemde kaydet:
 * - Gerçek coin fiyatı (Chainlink)
 * - Token fiyatı (Up/Down odds)
 * - Whale işlem detayları
 * - Kalan süre
 *
 * Usage:
 *   npx ts-node src_new/scripts/whale-strategy-debug.ts
 */

import WebSocket from 'ws';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // Bright variants
  brightGreen: '\x1b[92m',
  brightRed: '\x1b[91m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  brightMagenta: '\x1b[95m',
  brightBlue: '\x1b[94m',
};

// Coin-specific color schemes (up/down colors)
const COIN_COLORS: Record<string, { up: string; down: string; name: string }> = {
  BTC: { up: C.brightGreen, down: C.brightRed, name: C.yellow },      // BTC: Bright green/red, yellow name
  ETH: { up: C.cyan, down: C.magenta, name: C.cyan },                  // ETH: Cyan/Magenta
  SOL: { up: C.brightYellow, down: C.blue, name: C.brightYellow },     // SOL: Yellow/Blue
  XRP: { up: C.green, down: C.red, name: C.green },                    // XRP: Standard green/red
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const WHALES = {
  '0xe00740bce98a594e26861838885ab310ec3b548c': { name: 'Whale-A', color: C.cyan },
  '0x336848a1a1cb00348020c9457676f34d882f21cd': { name: 'Whale-B', color: C.magenta }
};

const WHALE_ADDRESSES = Object.keys(WHALES).map(a => a.toLowerCase());

const CONFIG = {
  cryptos: ['btc', 'eth', 'sol', 'xrp'],
  clobApi: 'https://clob.polymarket.com',
  gammaApi: 'https://gamma-api.polymarket.com'
};

// ============================================================================
// STATE
// ============================================================================

interface MarketState {
  slug: string;
  coin: string;
  upTokenId: string;
  downTokenId: string;
  endTime: number;
  priceToBeat: number;
  eventStartTime: string;
  isSelfCaptured?: boolean;  // Polymarket'ten değil, Chainlink'ten alındı mı?
}

interface PriceState {
  chainlink: number;      // Gerçek fiyat
  upToken: number;        // Up token fiyatı (odds)
  downToken: number;      // Down token fiyatı (odds)
  lastUpdate: number;
}

// Gerçek fiyatlar (Chainlink)
const chainlinkPrices: Map<string, number> = new Map();

// Last known Chainlink prices (cache for when WS hasn't connected yet)
const lastKnownChainlinkPrices: Map<string, number> = new Map();

// Token fiyatları (CLOB midpoint)
const tokenPrices: Map<string, { up: number; down: number }> = new Map();

// Market bilgileri
const markets: Map<string, MarketState> = new Map();

// Current period tracking for separators - track ALL seen slugs in this session
const seenPeriodSlugs: Set<string> = new Set();

// Pending market fetches to avoid duplicate requests
const pendingMarketFetches: Set<string> = new Set();

// Pre-fetched next period data (ready before period starts)
const nextPeriodMarkets: Map<string, MarketState> = new Map();

// Self-captured priceToBeat at period start (from Chainlink WS)
const selfCapturedPrices: Map<string, number> = new Map();

// Last known period timestamp (to detect transitions)
let lastPeriodTimestamp: number = 0;

// Log dosyaları - yapı: /data/whale-debug/YYYY-MM-DD/coin/period.log
const baseLogsDir = path.join(__dirname, '../../data/whale-debug');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDateDir(): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dir = path.join(baseLogsDir, dateStr);
  ensureDir(dir);
  return dir;
}

function getLogFileName(): string {
  return path.join(getDateDir(), `_all_trades.log`);
}

function getPeriodLogFileName(slug: string): string {
  // Extract info from slug: btc-updown-15m-1769718600
  const match = slug.match(/(\w+)-updown-15m-(\d+)/i);
  if (!match) return getLogFileName();

  const coin = match[1].toLowerCase();
  const timestamp = parseInt(match[2]) * 1000;
  const date = new Date(timestamp);
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().split('T')[1].slice(0, 5).replace(':', '');

  // Coin directory: /data/whale-debug/YYYY-MM-DD/btc/
  const coinDir = path.join(baseLogsDir, dateStr, coin);
  ensureDir(coinDir);

  // Combined directory: /data/whale-debug/YYYY-MM-DD/combined/
  const combinedDir = path.join(baseLogsDir, dateStr, 'combined');
  ensureDir(combinedDir);

  return path.join(coinDir, `${timeStr}.log`);
}

function getCombinedLogFileName(slug: string): string {
  const match = slug.match(/(\w+)-updown-15m-(\d+)/i);
  if (!match) return getLogFileName();

  const timestamp = parseInt(match[2]) * 1000;
  const date = new Date(timestamp);
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().split('T')[1].slice(0, 5).replace(':', '');

  const combinedDir = path.join(baseLogsDir, dateStr, 'combined');
  ensureDir(combinedDir);

  return path.join(combinedDir, `${timeStr}.log`);
}

function logToFile(message: string, periodSlug?: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;

  // Always write to main daily log
  fs.appendFileSync(getLogFileName(), line);

  // Also write to period-specific logs if slug provided
  if (periodSlug) {
    // Coin-specific log
    fs.appendFileSync(getPeriodLogFileName(periodSlug), line);
    // Combined log for this period
    fs.appendFileSync(getCombinedLogFileName(periodSlug), line);
  }
}

function getTime(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
}

// ============================================================================
// MARKET DISCOVERY
// ============================================================================

async function fetchPriceToBeat(slug: string, coin: string = '', retries: number = 2): Promise<number> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, 500)); // 500ms bekle (önceki 2000ms)
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

      // Silent retry - no console spam
    } catch {
      if (attempt === retries) {
        console.log(`${C.red}❌ ${coin} Price to Beat fetch hatası${C.reset}`);
      }
    }
  }
  return 0;
}

async function discoverMarkets(): Promise<void> {
  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  // Şu anki ve sonraki 2 period'u keşfet
  const timestamps = [
    Math.floor(currentInterval / 1000),
    Math.floor((currentInterval + 15 * 60 * 1000) / 1000),
    Math.floor((currentInterval + 30 * 60 * 1000) / 1000)
  ];

  for (const crypto of CONFIG.cryptos) {
    // Skip if already have active market WITH valid priceToBeat (and NOT self-captured)
    const existing = markets.get(crypto.toUpperCase());
    const needsRealPrice = existing?.isSelfCaptured === true;  // Self-captured ise gerçek değeri ara
    if (existing && existing.endTime > now && existing.priceToBeat > 0 && !needsRealPrice) continue;

    for (const ts of timestamps) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`${CONFIG.gammaApi}/markets?slug=${slug}`, { timeout: 5000 });
        if (!res.data?.[0] || res.data[0].closed) continue;

        const market = res.data[0];
        const endTime = new Date(market.endDate || market.endDateIso).getTime();
        if (endTime < now || endTime > now + 20 * 60 * 1000) continue;

        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');

        let upTokenId = '', downTokenId = '';
        for (let i = 0; i < outcomes.length; i++) {
          if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
          if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
        }

        if (!upTokenId || !downTokenId) continue;

        let priceToBeat = await fetchPriceToBeat(slug, crypto.toUpperCase());
        const remainingSec = Math.floor((endTime - now) / 1000);

        // Eğer Polymarket'ten alamadıysak, self-captured kullan (geçici)
        let usedSelfCaptured = false;
        if (priceToBeat === 0) {
          const selfCaptured = selfCapturedPrices.get(crypto.toUpperCase());
          if (selfCaptured && selfCaptured > 0) {
            priceToBeat = selfCaptured;
            usedSelfCaptured = true;
            console.log(`${C.yellow}⚡ ${crypto.toUpperCase()} self-captured kullanılıyor: $${priceToBeat.toFixed(crypto === 'btc' || crypto === 'eth' ? 2 : 4)} (Polymarket henüz hazır değil)${C.reset}`);
          }
        }

        // Eğer daha önce self-captured iken şimdi gerçek değer geldiyse, güncelle
        const existingMarket = markets.get(crypto.toUpperCase());
        if (existingMarket?.isSelfCaptured && !usedSelfCaptured && priceToBeat > 0) {
          const oldPrice = existingMarket.priceToBeat;
          const diff = Math.abs(priceToBeat - oldPrice);
          console.log(`${C.green}🔄 ${crypto.toUpperCase()} gerçek priceToBeat geldi: $${priceToBeat.toFixed(crypto === 'btc' || crypto === 'eth' ? 2 : 4)} (self-captured: $${oldPrice.toFixed(crypto === 'btc' || crypto === 'eth' ? 2 : 4)}, fark: $${diff.toFixed(4)})${C.reset}`);
        }

        markets.set(crypto.toUpperCase(), {
          slug,
          coin: crypto.toUpperCase(),
          upTokenId,
          downTokenId,
          endTime,
          priceToBeat,
          eventStartTime: market.eventStartTime || '',
          isSelfCaptured: usedSelfCaptured
        });

        const priceDisplay = crypto === 'btc' || crypto === 'eth' ? priceToBeat.toFixed(2) : priceToBeat.toFixed(4);
        const sourceTag = usedSelfCaptured ? ' (self-captured)' : '';
        console.log(`${C.green}✅ ${crypto.toUpperCase()}${C.reset}: Target=$${priceDisplay}${sourceTag} | ${remainingSec}s`);
        logToFile(`MARKET: ${crypto.toUpperCase()} slug=${slug} target=$${priceToBeat.toFixed(6)} endTime=${endTime} selfCaptured=${usedSelfCaptured}`);
        break;
      } catch { }
    }
  }
}

// Pre-fetch NEXT period's markets before they start (called ~30s before period end)
async function prefetchNextPeriod(): Promise<void> {
  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const nextInterval = currentInterval + 15 * 60 * 1000;
  const nextTimestamp = Math.floor(nextInterval / 1000);

  for (const crypto of CONFIG.cryptos) {
    const slug = `${crypto}-updown-15m-${nextTimestamp}`;
    const coin = crypto.toUpperCase();

    // Skip if already pre-fetched
    if (nextPeriodMarkets.has(coin)) continue;

    try {
      const res = await axios.get(`${CONFIG.gammaApi}/markets?slug=${slug}`, { timeout: 5000 });
      if (!res.data?.[0]) continue;

      const market = res.data[0];
      const endTime = new Date(market.endDate || market.endDateIso).getTime();

      const tokenIds = JSON.parse(market.clobTokenIds || '[]');
      const outcomes = JSON.parse(market.outcomes || '[]');

      let upTokenId = '', downTokenId = '';
      for (let i = 0; i < outcomes.length; i++) {
        if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
        if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
      }

      if (!upTokenId || !downTokenId) continue;

      // Fetch price to beat now (before period starts!)
      const priceToBeat = await fetchPriceToBeat(slug, coin);

      if (priceToBeat > 0) {
        nextPeriodMarkets.set(coin, {
          slug,
          coin,
          upTokenId,
          downTokenId,
          endTime,
          priceToBeat,
          eventStartTime: market.eventStartTime || ''
        });

        console.log(`${C.yellow}📦 PRE-FETCHED ${coin}${C.reset}: Target=$${priceToBeat.toFixed(2)} (starts in ${Math.floor((nextInterval - now) / 1000)}s)`);
        logToFile(`PREFETCH: ${coin} slug=${slug} target=$${priceToBeat.toFixed(2)}`);
      }
    } catch { }
  }
}

// Activate pre-fetched markets when period transitions
function activatePrefetchedMarkets(): void {
  const now = Date.now();

  for (const [coin, prefetched] of nextPeriodMarkets) {
    // If this period has started (endTime is in the future and start time has passed)
    const periodStart = prefetched.endTime - 15 * 60 * 1000;
    if (periodStart <= now && prefetched.endTime > now) {
      // Move from pre-fetched to active
      markets.set(coin, prefetched);
      nextPeriodMarkets.delete(coin);
      console.log(`${C.green}✅ ACTIVATED ${coin}${C.reset}: $${prefetched.priceToBeat.toFixed(2)} (pre-fetched)`);
      logToFile(`ACTIVATE_PREFETCH: ${coin} slug=${prefetched.slug}`);
    }
  }
}

// On-demand market fetch when a whale trade comes in for unknown market
async function fetchMarketOnDemand(slug: string): Promise<void> {
  if (!slug) return;

  const coinMatch = slug.match(/^(btc|eth|sol|xrp)-updown/i);
  if (!coinMatch) return;

  const coin = coinMatch[1].toUpperCase();

  // Check if we already have this market with same slug
  const existing = markets.get(coin);
  if (existing && existing.slug === slug && existing.priceToBeat > 0) return;

  // Check if already fetching (with 30s timeout for retry)
  const pendingKey = `${slug}`;
  if (pendingMarketFetches.has(pendingKey)) {
    // Allow retry after 30 seconds
    return;
  }

  pendingMarketFetches.add(pendingKey);

  // Auto-clear pending after 30 seconds to allow retry
  setTimeout(() => pendingMarketFetches.delete(pendingKey), 30000);

  console.log(`${C.yellow}🔍 Fetching market data for ${coin} (${slug})...${C.reset}`);

  try {
    const res = await axios.get(`${CONFIG.gammaApi}/markets?slug=${slug}`, { timeout: 5000 });
    if (!res.data?.[0]) {
      console.log(`${C.red}❌ Market not found: ${slug}${C.reset}`);
      return;
    }

    const market = res.data[0];
    const endTime = new Date(market.endDate || market.endDateIso).getTime();
    const now = Date.now();

    const tokenIds = JSON.parse(market.clobTokenIds || '[]');
    const outcomes = JSON.parse(market.outcomes || '[]');

    let upTokenId = '', downTokenId = '';
    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
      if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
    }

    if (!upTokenId || !downTokenId) {
      console.log(`${C.red}❌ Token IDs not found for: ${slug}${C.reset}`);
      return;
    }

    const priceToBeat = await fetchPriceToBeat(slug, coin);
    const remainingSec = Math.floor((endTime - now) / 1000);

    markets.set(coin, {
      slug,
      coin,
      upTokenId,
      downTokenId,
      endTime,
      priceToBeat,
      eventStartTime: market.eventStartTime || ''
    });

    console.log(`${C.green}✅ ${coin}${C.reset} (on-demand): Target=$${priceToBeat.toFixed(2)} | ${remainingSec}s`);
    logToFile(`MARKET_ONDEMAND: ${coin} slug=${slug} target=$${priceToBeat.toFixed(2)} endTime=${endTime}`);
  } catch (err) {
    console.log(`${C.red}❌ Error fetching market ${slug}${C.reset}`);
  } finally {
    pendingMarketFetches.delete(slug);
  }
}

// ============================================================================
// INITIAL CHAINLINK PRICES (REST API - before WebSocket connects)
// ============================================================================

async function fetchInitialChainlinkPrices(): Promise<void> {
  // CoinGecko API ile başlangıç fiyatlarını al
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin,ethereum,solana,ripple',
        vs_currencies: 'usd'
      },
      timeout: 5000
    });

    const data = res.data;
    if (data.bitcoin?.usd) {
      chainlinkPrices.set('BTC', data.bitcoin.usd);
      lastKnownChainlinkPrices.set('BTC', data.bitcoin.usd);
      console.log(`   BTC: $${data.bitcoin.usd.toFixed(2)}`);
    }
    if (data.ethereum?.usd) {
      chainlinkPrices.set('ETH', data.ethereum.usd);
      lastKnownChainlinkPrices.set('ETH', data.ethereum.usd);
      console.log(`   ETH: $${data.ethereum.usd.toFixed(2)}`);
    }
    if (data.solana?.usd) {
      chainlinkPrices.set('SOL', data.solana.usd);
      lastKnownChainlinkPrices.set('SOL', data.solana.usd);
      console.log(`   SOL: $${data.solana.usd.toFixed(2)}`);
    }
    if (data.ripple?.usd) {
      chainlinkPrices.set('XRP', data.ripple.usd);
      lastKnownChainlinkPrices.set('XRP', data.ripple.usd);
      console.log(`   XRP: $${data.ripple.usd.toFixed(2)}`);
    }
  } catch (err) {
    console.log(`${C.yellow}⚠️ CoinGecko API hatası, WebSocket'ten alınacak${C.reset}`);
  }
}

// ============================================================================
// TOKEN PRICE POLLING (CLOB Midpoint)
// ============================================================================

async function pollTokenPrices(): Promise<void> {
  for (const [coin, market] of markets) {
    try {
      const [upRes, downRes] = await Promise.all([
        axios.get(`${CONFIG.clobApi}/midpoint?token_id=${market.upTokenId}`, { timeout: 2000 }),
        axios.get(`${CONFIG.clobApi}/midpoint?token_id=${market.downTokenId}`, { timeout: 2000 })
      ]);

      const upPrice = parseFloat(upRes.data.mid || '0.5');
      const downPrice = parseFloat(downRes.data.mid || '0.5');

      tokenPrices.set(coin, { up: upPrice, down: downPrice });
    } catch { }
  }
}

// ============================================================================
// WEBSOCKET CONNECTIONS
// ============================================================================

function connectChainlinkWS(): void {
  const ws = new WebSocket('wss://ws-live-data.polymarket.com');

  ws.on('open', () => {
    console.log(`${C.green}✅ Chainlink WebSocket bağlandı${C.reset}`);
    ws.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{ topic: 'crypto_prices_chainlink', type: 'update' }]
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.topic === 'crypto_prices_chainlink' && msg.payload) {
        const symbol = msg.payload.symbol?.split('/')[0]?.toUpperCase() || '';
        if (['BTC', 'ETH', 'SOL', 'XRP'].includes(symbol)) {
          const price = msg.payload.value;
          if (price > 0) {
            chainlinkPrices.set(symbol, price);
            lastKnownChainlinkPrices.set(symbol, price); // Cache for later use
          }
        }
      }
    } catch { }
  });

  ws.on('close', () => {
    console.log(`${C.yellow}⚠️ Chainlink WS kapandı, yeniden bağlanıyor...${C.reset}`);
    setTimeout(connectChainlinkWS, 3000);
  });

  ws.on('error', () => { });
}

function connectActivityWS(): void {
  const ws = new WebSocket('wss://ws-live-data.polymarket.com');

  ws.on('open', () => {
    console.log(`${C.green}✅ Activity WebSocket bağlandı${C.reset}`);
    // Hem trades hem de tüm activity'leri al (orders, cancels vs.)
    ws.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [
        { topic: 'activity', type: 'trades' },
        { topic: 'activity', type: '*' }
      ]
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.topic === 'activity' && msg.payload) {
        // Her activity tipini yakala (trade, order, cancel, etc.)
        handleActivity(msg.type, msg.payload);
      }
    } catch { }
  });

  ws.on('close', () => {
    console.log(`${C.yellow}⚠️ Activity WS kapandı, yeniden bağlanıyor...${C.reset}`);
    setTimeout(connectActivityWS, 3000);
  });

  ws.on('error', () => { });
}

// ============================================================================
// WHALE TRADE TRACKING - Partial fills, orders
// ============================================================================

interface WhaleOrder {
  whale: string;
  coin: string;
  side: string;
  outcome: string;
  originalSize: number;
  filledSize: number;
  price: number;
  fills: Array<{ size: number; price: number; timestamp: number }>;
  firstSeen: number;
  lastUpdate: number;
}

// Aktif whale order'larını takip et
const whaleOrders: Map<string, WhaleOrder> = new Map();

function getOrderKey(wallet: string, coin: string, outcome: string, price: number): string {
  return `${wallet}-${coin}-${outcome}-${(price * 100).toFixed(0)}`;
}

// ============================================================================
// ACTIVITY HANDLER - trades, orders, cancels
// ============================================================================

function handleActivity(type: string, payload: any): void {
  const walletAddr = payload.proxyWallet?.toLowerCase();

  // Sadece whale'leri takip et
  if (!WHALE_ADDRESSES.includes(walletAddr)) return;

  // Trade ise detaylı işle
  if (type === 'trades') {
    handleTrade(payload);
    return;
  }

  // Diğer activity tipleri (order, cancel, etc.)
  // orders_matched = duplicate of trades, skip console but log to file
  const whale = WHALES[walletAddr as keyof typeof WHALES];
  const time = getTime();

  if (type === 'orders_matched') {
    // Sadece dosyaya kaydet, console'a yazma (trades ile duplicate)
    logToFile(`WHALE_ORDER_MATCHED: ${whale.name} ${JSON.stringify(payload)}`);
    return;
  }

  // Diğer event tiplerini göster (order placed, cancelled, etc.)
  const eventEmoji = type === 'orders' ? '📝' : type === 'order_cancelled' ? '❌' : '📋';
  console.log(`[${time}] ${whale.color}${whale.name}${C.reset} ${eventEmoji} ${C.yellow}[${type}]${C.reset} ${JSON.stringify(payload).slice(0, 150)}`);
  logToFile(`WHALE_ACTIVITY: type=${type} whale=${whale.name} payload=${JSON.stringify(payload)}`);
}

// ============================================================================
// TRADE HANDLER - ANA MANTIK
// ============================================================================

function handleTrade(trade: any): void {
  const walletAddr = trade.proxyWallet?.toLowerCase();

  // Sadece whale'leri takip et
  if (!WHALE_ADDRESSES.includes(walletAddr)) return;

  const whale = WHALES[walletAddr as keyof typeof WHALES];
  const time = getTime();
  const now = Date.now();

  // Market bilgisini bul
  const slug = trade.slug || trade.eventSlug || '';
  const coinMatch = slug.match(/^(btc|eth|sol|xrp)-updown/i);
  const coin = coinMatch ? coinMatch[1].toUpperCase() : '';

  // Try to find market by coin first, then by matching slug
  let market = markets.get(coin);

  // If market not found or slug doesn't match, try to find by iterating
  if (!market || (market.slug !== slug && slug)) {
    for (const [, m] of markets) {
      if (m.slug === slug) {
        market = m;
        break;
      }
    }
  }

  // If market has priceToBeat=0 or wrong slug, check pre-fetched markets
  if ((!market || market.priceToBeat === 0 || market.slug !== slug) && slug && coin) {
    const prefetched = nextPeriodMarkets.get(coin);
    if (prefetched && prefetched.slug === slug && prefetched.priceToBeat > 0) {
      // Activate the pre-fetched market immediately
      markets.set(coin, prefetched);
      nextPeriodMarkets.delete(coin);
      market = prefetched;
      console.log(`${C.green}⚡ INSTANT ACTIVATE ${coin}${C.reset}: $${prefetched.priceToBeat.toFixed(2)} (pre-fetched, triggered by trade)`);
      logToFile(`INSTANT_ACTIVATE: ${coin} slug=${slug}`);
    }
  }

  const remainingSec = market ? Math.floor((market.endTime - now) / 1000) : '?';

  // Fiyatları al - use cached price if current is 0
  const chainlinkPrice = chainlinkPrices.get(coin) || lastKnownChainlinkPrices.get(coin) || 0;
  const tokens = tokenPrices.get(coin) || { up: 0.5, down: 0.5 };
  const priceToBeat = market?.priceToBeat || 0;

  // Period separator - sadece İLK KEZ görülen slug'lar için
  if (slug && !seenPeriodSlugs.has(slug)) {
    seenPeriodSlugs.add(slug);

    const separator = `\n${'='.repeat(60)}\n   NEW PERIOD: ${slug}\n${'='.repeat(60)}\n`;
    console.log(separator);
    logToFile(separator);

    // Write period header to period-specific log
    const periodHeader = [
      '='.repeat(60),
      `PERIOD: ${slug}`,
      `Coin: ${coin}`,
      `Price to Beat: $${priceToBeat.toFixed(2)}`,
      `Chainlink Price: $${chainlinkPrice.toFixed(2)}`,
      `End Time: ${market ? new Date(market.endTime).toISOString() : 'unknown'}`,
      '='.repeat(60),
      ''
    ].join('\n');
    logToFile(periodHeader, slug);
  }

  // If priceToBeat is 0, trigger on-demand market fetch for next trades
  if (priceToBeat === 0 && coin && slug) {
    console.log(`${C.yellow}⚠️ priceToBeat=0 for ${coin} (slug: ${slug}) - fetching...${C.reset}`);
    // Fire and forget - async fetch for next trades
    fetchMarketOnDemand(slug).catch(() => {});
  }

  // Fiyat farkı hesapla
  const priceDiff = chainlinkPrice - priceToBeat;
  const priceDiffPct = priceToBeat > 0 ? ((priceDiff / priceToBeat) * 100) : 0;
  const priceDirection = priceDiff >= 0 ? 'UP' : 'DOWN';

  // İşlem detayları
  const side = trade.side; // BUY veya SELL
  const outcome = trade.outcome; // Up veya Down
  const size = trade.size || 0;
  const price = trade.price || 0;
  const usdcValue = size * price;

  // Renk ve emoji
  const sideColor = side === 'BUY' ? C.green : C.red;
  const sideEmoji = side === 'BUY' ? '🟢' : '🔴';
  const outcomeColor = outcome === 'Up' ? C.green : C.red;

  // Kompakt tek satır format
  // [TIME] WHALE | COIN | SIDE OUTCOME | SIZE@PRICE=$USD | Target→Current (DIFF%) | UP/DOWN | SECs | ✅/⚠️
  const whalePad = whale.name.padEnd(8);
  const coinPad = coin.padEnd(3);
  const sidePad = side.padEnd(4);
  const outcomePad = outcome.padEnd(4);
  const sizePad = size.toFixed(1).padStart(6);
  // Fiyat formatlama - decimal olarak göster (0.002, 0.850, 0.999 gibi)
  const pricePad = price.toFixed(3).padStart(6);
  const usdPad = ('$' + usdcValue.toFixed(2)).padStart(7);

  // XRP ve SOL için daha fazla ondalık göster
  let targetPad: string, currentPad: string;
  if (coin === 'XRP') {
    targetPad = ('$' + priceToBeat.toFixed(4)).padStart(10);
    currentPad = ('$' + chainlinkPrice.toFixed(4)).padStart(10);
  } else if (coin === 'SOL') {
    targetPad = ('$' + priceToBeat.toFixed(2)).padStart(10);
    currentPad = ('$' + chainlinkPrice.toFixed(2)).padStart(10);
  } else {
    targetPad = ('$' + priceToBeat.toFixed(2)).padStart(10);
    currentPad = ('$' + chainlinkPrice.toFixed(2)).padStart(10);
  }

  const diffPad = ((priceDiff >= 0 ? '+' : '') + priceDiffPct.toFixed(3) + '%').padStart(9);
  const upPad = tokens.up.toFixed(3).padStart(6);
  const downPad = tokens.down.toFixed(3).padStart(6);
  const secPad = (remainingSec + 's').padStart(4);

  // Partial fill tracking
  const orderKey = getOrderKey(walletAddr, coin, outcome, price);
  let order = whaleOrders.get(orderKey);
  let fillInfo = '';

  if (!order) {
    order = {
      whale: whale.name,
      coin,
      side,
      outcome,
      originalSize: size,
      filledSize: size,
      price,
      fills: [{ size, price, timestamp: Date.now() }],
      firstSeen: Date.now(),
      lastUpdate: Date.now()
    };
    whaleOrders.set(orderKey, order);
  } else {
    order.filledSize += size;
    order.fills.push({ size, price, timestamp: Date.now() });
    order.lastUpdate = Date.now();
    fillInfo = ` ${C.dim}[fill#${order.fills.length} tot:${order.filledSize.toFixed(1)}]${C.reset}`;
  }

  // Strateji aligned mı?
  const targetDiffPct = priceToBeat > 0 ? ((chainlinkPrice - priceToBeat) / priceToBeat * 100).toFixed(3) : '?';
  const isAligned = (outcome === 'Up' && priceDiff >= 0) || (outcome === 'Down' && priceDiff < 0);
  const alignmentEmoji = isAligned ? '✅' : '⚠️';

  // Coin-specific colors
  const coinColor = COIN_COLORS[coin] || { up: C.green, down: C.red, name: C.bold };
  const diffColor = priceDiff >= 0 ? coinColor.up : coinColor.down;
  const priceColor = outcome === 'Up' ? coinColor.up : coinColor.down; // Token fiyatı outcome'a göre renkli

  // Final output - tek satır
  console.log(`[${time}] ${whale.color}${whalePad}${C.reset}| ${coinColor.name}${coinPad}${C.reset} | ${sideColor}${sidePad}${C.reset} ${outcomeColor}${outcomePad}${C.reset} | ${sizePad}@${priceColor}${pricePad}${C.reset}=${usdPad} | ${targetPad}→${currentPad} ${diffColor}${diffPad}${C.reset} | ${coinColor.up}U:${upPad}${C.reset} ${coinColor.down}D:${downPad}${C.reset} | ${secPad} ${alignmentEmoji}${fillInfo}`);

  // Dosyaya kaydet
  const logEntry = {
    timestamp: new Date().toISOString(),
    whale: whale.name,
    walletAddr,
    coin,
    remainingSec,
    side,
    outcome,
    size,
    price,
    usdcValue,
    priceToBeat,
    chainlinkPrice,
    priceDiff,
    priceDiffPct,
    priceDirection,
    tokenUp: tokens.up,
    tokenDown: tokens.down,
    txHash: trade.transactionHash,
    slug,
    // Ek strateji bilgileri
    isAligned,
    targetDiffPct,
    fillNumber: order.fills.length,
    totalFilled: order.filledSize
  };

  logToFile(`WHALE_TRADE: ${JSON.stringify(logEntry)}`, slug);
}

// ============================================================================
// WHALE OPEN ORDERS CHECK
// ============================================================================

interface OpenOrder {
  id: string;
  market: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  created_at: number;
}

let lastOrderCheckLog = 0;

async function checkWhaleOpenOrders(): Promise<void> {
  let totalOrders = 0;

  for (const [addr, whale] of Object.entries(WHALES)) {
    try {
      // Whale'in TÜM açık order'larını kontrol et (market bağımsız)
      const res = await axios.get(`${CONFIG.clobApi}/orders`, {
        params: {
          maker: addr,
        },
        timeout: 5000
      });

      if (res.data && Array.isArray(res.data)) {
        const allOrders = res.data;
        const openOrders = allOrders.filter((o: any) =>
          o.size_matched !== o.original_size &&
          parseFloat(o.original_size) - parseFloat(o.size_matched) > 0.1
        );

        totalOrders += openOrders.length;

        for (const order of openOrders) {
          const remainingSize = parseFloat(order.original_size) - parseFloat(order.size_matched);
          const price = parseFloat(order.price);
          const side = order.side;

          // Market bilgisini bulmaya çalış
          let coinName = '???';
          let outcome = '?';
          for (const [coin, market] of markets) {
            if (order.asset_id === market.upTokenId) {
              coinName = coin;
              outcome = 'Up';
              break;
            } else if (order.asset_id === market.downTokenId) {
              coinName = coin;
              outcome = 'Down';
              break;
            }
          }

          const coinColor = COIN_COLORS[coinName] || { up: C.green, down: C.red, name: C.bold };
          const outcomeColor = outcome === 'Up' ? coinColor.up : coinColor.down;

          console.log(`[${getTime()}] ${whale.color}${whale.name}${C.reset} 📝 OPEN | ${coinColor.name}${coinName}${C.reset} | ${side} ${outcomeColor}${outcome}${C.reset} | ${remainingSize.toFixed(1)} @ ${(price * 100).toFixed(0)}¢`);
        }
      }
    } catch (err: any) {
      // İlk hatada logla
      if (Date.now() - lastOrderCheckLog > 60000) {
        console.log(`${C.dim}[Order check: ${err.message?.slice(0, 50) || 'error'}]${C.reset}`);
        lastOrderCheckLog = Date.now();
      }
    }
  }

  // Eğer hiç açık order yoksa ve uzun süredir loglamadıysak
  if (totalOrders === 0 && Date.now() - lastOrderCheckLog > 60000) {
    console.log(`${C.dim}[${getTime()}] Whale açık order yok (anlık fill alıyorlar)${C.reset}`);
    lastOrderCheckLog = Date.now();
  }
}

// ============================================================================
// PERIODIC STATUS
// ============================================================================

function printStatus(): void {
  const time = getTime();
  const now = Date.now();

  let statusLine = `[${time}] `;

  // Period geçişi kontrolü - her 15 dakikada bir
  const currentPeriodTs = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  if (currentPeriodTs !== lastPeriodTimestamp) {
    // Yeni period başladı! Chainlink fiyatlarını yakala
    for (const coin of CONFIG.cryptos.map(c => c.toUpperCase())) {
      const chainlinkPrice = chainlinkPrices.get(coin) || lastKnownChainlinkPrices.get(coin) || 0;
      if (chainlinkPrice > 0) {
        selfCapturedPrices.set(coin, chainlinkPrice);
        console.log(`${C.cyan}📸 ${coin} self-captured priceToBeat: $${chainlinkPrice.toFixed(coin === 'BTC' || coin === 'ETH' ? 2 : 4)}${C.reset}`);
      }
    }
    lastPeriodTimestamp = currentPeriodTs;

    // Eski marketleri temizle, yeni period için hemen keşif başlat
    markets.clear();
    discoverMarkets();
  }

  for (const coin of CONFIG.cryptos.map(c => c.toUpperCase())) {
    const market = markets.get(coin);
    const chainlink = chainlinkPrices.get(coin) || 0;
    const tokens = tokenPrices.get(coin) || { up: 0.5, down: 0.5 };

    if (market && market.priceToBeat > 0) {
      const coinColor = COIN_COLORS[coin] || { up: C.green, down: C.red, name: C.bold };
      const diff = chainlink - market.priceToBeat;
      const diffPct = (diff / market.priceToBeat) * 100;
      const priceColor = diff >= 0 ? coinColor.up : coinColor.down;
      const arrow = diff >= 0 ? '↑' : '↓';
      const remainingSec = Math.floor((market.endTime - now) / 1000);

      // Format: NOW $price (vs T:$target +X.XXX%)
      let nowPrice: string, targetPrice: string;
      if (coin === 'BTC') {
        nowPrice = chainlink.toFixed(2);
        targetPrice = market.priceToBeat.toFixed(2);
      } else if (coin === 'ETH') {
        nowPrice = chainlink.toFixed(2);
        targetPrice = market.priceToBeat.toFixed(2);
      } else {
        nowPrice = chainlink.toFixed(4);
        targetPrice = market.priceToBeat.toFixed(4);
      }

      const diffStr = (diffPct >= 0 ? '+' : '') + diffPct.toFixed(3) + '%';

      // Arbitrage check: U + D should = 100 (1.00)
      // Use displayed (rounded) values for consistency
      const upRounded = Math.round(tokens.up * 100) / 100;
      const downRounded = Math.round(tokens.down * 100) / 100;
      const totalCents = Math.round((upRounded + downRounded) * 100);
      const arbDiff = totalCents - 100; // negative = arbitrage opportunity (buy both for <$1)
      // -1 or less = arbitrage opportunity!
      // Sabit genişlik: 3 karakter
      let arbStr: string;
      let arbColor: string;
      if (arbDiff < 0) {
        arbStr = `🔥${arbDiff}`;  // Fire emoji for arb opportunity
        arbColor = `${C.bold}${C.brightYellow}`;
      } else if (arbDiff === 0) {
        arbStr = ' = ';  // 3 karakter, dengeli
        arbColor = C.dim;
      } else {
        arbStr = `+${arbDiff} `;  // +1 veya +2, sonra boşluk
        arbColor = C.dim;
      }
      // Sabit genişliğe getir (emoji hariç 3 karakter)
      arbStr = arbStr.padEnd(3);

      statusLine += `${coinColor.name}${C.bold}${coin}${C.reset} $${nowPrice} ${priceColor}${arrow}${diffStr}${C.reset} T:$${targetPrice} ${coinColor.up}U:${upRounded.toFixed(2)}${C.reset} ${coinColor.down}D:${downRounded.toFixed(2)}${C.reset} ${arbColor}(${arbStr})${C.reset} ${remainingSec}s | `;
    }
  }

  console.log(statusLine);
}

// ============================================================================
// MAIN
// ============================================================================

async function fetchRecentTrades(): Promise<void> {
  console.log(`${C.bold}📜 Son whale işlemleri çekiliyor...${C.reset}\n`);

  for (const [addr, whale] of Object.entries(WHALES)) {
    try {
      const res = await axios.get(`https://data-api.polymarket.com/activity?user=${addr}&limit=20`, { timeout: 10000 });

      if (res.data && Array.isArray(res.data)) {
        const recentTrades = res.data.filter((t: any) => {
          // Son 1 saat içindeki işlemler
          const tradeTime = t.timestamp * 1000;
          return Date.now() - tradeTime < 60 * 60 * 1000;
        });

        console.log(`   ${whale.color}${whale.name}${C.reset}: Son 1 saatte ${recentTrades.length} işlem`);

        for (const trade of recentTrades.slice(0, 5)) {
          const side = trade.side === 'BUY' ? C.green + 'BUY' : C.red + 'SELL';
          const outcome = trade.outcome;
          const size = trade.size?.toFixed(2) || '?';
          const price = ((trade.price || 0) * 100).toFixed(0);
          const slug = trade.slug || '';
          const coinMatch = slug.match(/^(btc|eth|sol|xrp)/i);
          const coin = coinMatch ? coinMatch[1].toUpperCase() : '?';

          console.log(`      ${coin} ${side}${C.reset} ${outcome} ${size} sh @ ${price}¢`);
        }
        console.log('');
      }
    } catch (err) {
      console.log(`   ${C.red}❌ ${whale.name} trade fetch hatası${C.reset}`);
    }
  }
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log(`   ${C.bold}🐋 WHALE STRATEGY DEBUG${C.reset}`);
  console.log('═'.repeat(70));
  console.log(`   Whale A: ${C.cyan}0xe00740...${C.reset}`);
  console.log(`   Whale B: ${C.magenta}0x336848...${C.reset}`);
  console.log('═'.repeat(70) + '\n');

  // Son işlemleri çek
  await fetchRecentTrades();

  // lastPeriodTimestamp'ı başlat (ilk çalıştırmada gereksiz self-capture tetiklenmemesi için)
  const now = Date.now();
  lastPeriodTimestamp = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);

  // Marketleri keşfet
  console.log(`${C.bold}📊 Marketler keşfediliyor...${C.reset}\n`);
  await discoverMarkets();

  if (markets.size === 0) {
    console.log(`${C.yellow}⚠️ Aktif market bulunamadı${C.reset}`);
    return;
  }

  // Note: priceToBeat can't be pre-fetched (created at period start)

  // Chainlink fiyatlarını başlangıçta REST API'den çek
  console.log(`\n${C.bold}💰 Chainlink fiyatları çekiliyor...${C.reset}`);
  await fetchInitialChainlinkPrices();

  // WebSocket bağlantıları
  console.log(`\n${C.bold}📡 WebSocket bağlantıları...${C.reset}\n`);
  connectChainlinkWS();
  connectActivityWS();

  // Token fiyatlarını poll et (her 500ms)
  setInterval(pollTokenPrices, 500);

  // Market yenileme ve sonuç kaydetme (her 5s)
  setInterval(async () => {
    const now = Date.now();
    const expiredMarkets: string[] = [];

    markets.forEach((market, coin) => {
      // Period bitti mi? (5 saniye tolerans)
      if (market.endTime < now - 5000 && market.endTime > now - 60000) {
        // Period sonucunu kaydet
        const chainlinkPrice = chainlinkPrices.get(coin) || lastKnownChainlinkPrices.get(coin) || 0;
        const winner = chainlinkPrice >= market.priceToBeat ? 'Up' : 'Down';
        const priceDiff = chainlinkPrice - market.priceToBeat;
        const priceDiffPct = market.priceToBeat > 0 ? (priceDiff / market.priceToBeat * 100) : 0;

        const resultLog = {
          type: 'PERIOD_RESULT',
          slug: market.slug,
          coin,
          priceToBeat: market.priceToBeat,
          finalPrice: chainlinkPrice,
          priceDiff,
          priceDiffPct,
          winner,
          endTime: new Date(market.endTime).toISOString()
        };

        console.log(`\n${C.bold}📊 PERIOD SONUCU: ${coin}${C.reset}`);
        console.log(`   ${market.slug}`);
        console.log(`   Target: $${market.priceToBeat.toFixed(2)} → Final: $${chainlinkPrice.toFixed(2)}`);
        console.log(`   Diff: ${priceDiff >= 0 ? '+' : ''}${priceDiffPct.toFixed(4)}%`);
        console.log(`   ${C.bold}WINNER: ${winner === 'Up' ? C.green : C.red}${winner}${C.reset}\n`);

        logToFile(`PERIOD_RESULT: ${JSON.stringify(resultLog)}`, market.slug);

        expiredMarkets.push(coin);
      } else if (market.endTime < now - 60000) {
        // 1 dakikadan eski, temizle
        expiredMarkets.push(coin);
      }
    });

    expiredMarkets.forEach(coin => markets.delete(coin));

    // Clean up old seen slugs (keep only last hour's worth)
    const oneHourAgo = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    for (const slug of seenPeriodSlugs) {
      const match = slug.match(/-(\d+)$/);
      if (match) {
        const slugTimestamp = parseInt(match[1]);
        if (slugTimestamp < oneHourAgo) {
          seenPeriodSlugs.delete(slug);
        }
      }
    }

    await discoverMarkets();
  }, 5000); // Her 5 saniyede kontrol et

  // Status göster (her 1s)
  setInterval(printStatus, 1000);

  // Whale açık order'larını kontrol et (her 10s)
  setInterval(checkWhaleOpenOrders, 10000);

  // İlk kontrol hemen
  setTimeout(checkWhaleOpenOrders, 3000);

  console.log(`\n${C.bold}🎯 Whale işlemleri bekleniyor...${C.reset}\n`);
  console.log(`${C.dim}Log dosyası: ${getLogFileName()}${C.reset}\n`);
}

main().catch(console.error);
