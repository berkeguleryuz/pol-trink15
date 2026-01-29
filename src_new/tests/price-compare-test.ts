/**
 * PRICE COMPARISON TEST
 *
 * Gamma API vs CLOB /midpoint - hangisi daha doğru/hızlı?
 * Her 2 saniyede bir karşılaştır
 */

import axios from 'axios';

const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';

interface MarketInfo {
  slug: string;
  question: string;
  upTokenId: string;
  downTokenId: string;
  endTime: Date;
}

async function findActiveMarket(): Promise<MarketInfo | null> {
  const cryptos = ['btc', 'eth', 'sol', 'xrp'];
  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const timestamps = [
    Math.floor(currentInterval / 1000),
    Math.floor((currentInterval + 15 * 60 * 1000) / 1000)
  ];

  for (const crypto of cryptos) {
    for (const ts of timestamps) {
      const slug = `${crypto}-updown-15m-${ts}`;
      try {
        const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
        if (res.data && res.data.length > 0) {
          const market = res.data[0];
          if (market.closed) continue;

          const endTime = new Date(market.endDate || market.endDateIso);
          const remaining = (endTime.getTime() - now) / 1000;

          if (remaining > 0 && remaining < 900) { // Active market
            const tokenIds = JSON.parse(market.clobTokenIds || '[]');
            const outcomes = JSON.parse(market.outcomes || '[]');

            let upTokenId = '', downTokenId = '';
            for (let i = 0; i < outcomes.length; i++) {
              if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
              if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
            }

            if (upTokenId && downTokenId) {
              return {
                slug,
                question: market.question || market.groupItemTitle,
                upTokenId,
                downTokenId,
                endTime
              };
            }
          }
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function getGammaPrice(slug: string): Promise<{ up: number; down: number; ms: number } | null> {
  const start = Date.now();
  try {
    const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 3000 });
    const ms = Date.now() - start;

    if (!res.data || res.data.length === 0) return null;

    const market = res.data[0];
    const outcomes = JSON.parse(market.outcomes || '[]');
    const prices = JSON.parse(market.outcomePrices || '[]');

    let up = 0.5, down = 0.5;
    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i].toLowerCase() === 'up') up = parseFloat(prices[i]);
      if (outcomes[i].toLowerCase() === 'down') down = parseFloat(prices[i]);
    }

    return { up, down, ms };
  } catch {
    return null;
  }
}

async function getClobMidpoint(upTokenId: string, downTokenId: string): Promise<{ up: number; down: number; ms: number } | null> {
  const start = Date.now();
  try {
    const [upRes, downRes] = await Promise.all([
      axios.get(`${CLOB_API}/midpoint?token_id=${upTokenId}`, { timeout: 3000 }),
      axios.get(`${CLOB_API}/midpoint?token_id=${downTokenId}`, { timeout: 3000 })
    ]);
    const ms = Date.now() - start;

    const up = parseFloat(upRes.data.mid || '0.5');
    const down = parseFloat(downRes.data.mid || '0.5');

    return { up, down, ms };
  } catch {
    return null;
  }
}

function getTime(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false });
}

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('   PRICE COMPARISON: Gamma API vs CLOB /midpoint');
  console.log('='.repeat(70) + '\n');

  console.log('🔍 Finding active 15-min market...\n');

  const market = await findActiveMarket();

  if (!market) {
    console.log('❌ No active market found. Try again later.');
    return;
  }

  const remaining = Math.floor((market.endTime.getTime() - Date.now()) / 1000);
  console.log(`✅ Found: ${market.question}`);
  console.log(`   Slug: ${market.slug}`);
  console.log(`   Remaining: ${remaining}s\n`);
  console.log('='.repeat(70));
  console.log(`${'Time'.padEnd(10)} | ${'Gamma'.padEnd(22)} | ${'CLOB'.padEnd(22)} | ${'Diff'.padEnd(10)} | Winner`);
  console.log('='.repeat(70));

  let count = 0;
  const maxCount = 60; // 2 dakika

  const interval = setInterval(async () => {
    count++;
    if (count > maxCount) {
      clearInterval(interval);
      console.log('\n' + '='.repeat(70));
      console.log('   Test completed!');
      console.log('='.repeat(70) + '\n');
      return;
    }

    const now = Date.now();
    const remainingSec = Math.floor((market.endTime.getTime() - now) / 1000);

    if (remainingSec < 0) {
      clearInterval(interval);
      console.log('\n   Market ended.');
      return;
    }

    const [gamma, clob] = await Promise.all([
      getGammaPrice(market.slug),
      getClobMidpoint(market.upTokenId, market.downTokenId)
    ]);

    const time = getTime();

    if (!gamma || !clob) {
      console.log(`[${time}] Error fetching prices`);
      return;
    }

    // Determine winner from each source
    const gammaWinner = gamma.up > gamma.down ? 'UP' : 'DOWN';
    const clobWinner = clob.up > clob.down ? 'UP' : 'DOWN';
    const gammaWinnerPrice = Math.max(gamma.up, gamma.down);
    const clobWinnerPrice = Math.max(clob.up, clob.down);

    // Calculate difference
    const diffUp = Math.abs(gamma.up - clob.up);
    const diffDown = Math.abs(gamma.down - clob.down);
    const maxDiff = Math.max(diffUp, diffDown);

    // Color coding
    const diffColor = maxDiff < 0.01 ? C.green : maxDiff < 0.03 ? C.yellow : C.red;
    const sameWinner = gammaWinner === clobWinner;
    const winnerColor = sameWinner ? C.green : C.red;

    const gammaStr = `UP:${(gamma.up * 100).toFixed(0)}¢ DN:${(gamma.down * 100).toFixed(0)}¢ ${gamma.ms}ms`;
    const clobStr = `UP:${(clob.up * 100).toFixed(0)}¢ DN:${(clob.down * 100).toFixed(0)}¢ ${clob.ms}ms`;
    const diffStr = `${(maxDiff * 100).toFixed(1)}¢`;
    const winnerStr = sameWinner
      ? `${gammaWinner} ${(gammaWinnerPrice * 100).toFixed(0)}¢`
      : `G:${gammaWinner} C:${clobWinner}`;

    console.log(
      `[${time}] ${remainingSec.toString().padStart(3)}s | ` +
      `${gammaStr.padEnd(22)} | ` +
      `${clobStr.padEnd(22)} | ` +
      `${diffColor}${diffStr.padEnd(10)}${C.reset} | ` +
      `${winnerColor}${winnerStr}${C.reset}`
    );

  }, 2000);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n   Stopped.');
    process.exit(0);
  });
}

main().catch(console.error);
