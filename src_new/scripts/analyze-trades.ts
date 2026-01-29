/**
 * TRADE ANALYZER
 *
 * Dry run trade'lerini analiz eder ve gerçek sonuçları hesaplar.
 * Market'lerin kapanış fiyatlarını çekerek P/L hesaplar.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const DATA_PATH = path.join(__dirname, '../../data/copied-trades-ws.json');
const REPORT_PATH = path.join(__dirname, '../../data/trade-analysis-report.txt');

interface TradeRecord {
  transactionHash: string;
  copiedAt: string;
  orderId?: string;
  status: string;
  tokenId?: string;
  marketSlug?: string;
  marketTitle?: string;
  outcome?: string;
  buyPrice?: number;
  amount?: number;
  resolved?: boolean;
  won?: boolean;
  payout?: number;
}

interface MarketResult {
  slug: string;
  winningOutcome: string | null;
  resolved: boolean;
}

// Cache for market results
const marketCache: Map<string, MarketResult> = new Map();

async function getMarketResult(slug: string): Promise<MarketResult> {
  // Check cache first
  if (marketCache.has(slug)) {
    return marketCache.get(slug)!;
  }

  try {
    // Use gamma API which has proper resolution data
    const url = `https://gamma-api.polymarket.com/markets?slug=${slug}`;
    const response = await axios.get(url, { timeout: 10000 });

    if (response.data && response.data.length > 0) {
      const market = response.data[0];

      // Check if market is resolved
      if (market.umaResolutionStatus === 'resolved' || market.closed) {
        let winningOutcome: string | null = null;

        // Parse outcomes and prices
        // outcomes: "[\"Up\", \"Down\"]"
        // outcomePrices: "[\"0\", \"1\"]"  (1 = winner, 0 = loser)
        try {
          const outcomes = JSON.parse(market.outcomes || '[]');
          const prices = JSON.parse(market.outcomePrices || '[]');

          for (let i = 0; i < outcomes.length; i++) {
            const price = parseFloat(prices[i] || '0');
            if (price >= 0.95) {
              winningOutcome = outcomes[i];
              break;
            }
          }
        } catch (e) {
          // Parse error, try alternative
        }

        const result: MarketResult = {
          slug,
          winningOutcome,
          resolved: !!winningOutcome
        };
        marketCache.set(slug, result);
        return result;
      }
    }
  } catch (error) {
    // Ignore errors, treat as unresolved
  }

  const result: MarketResult = { slug, winningOutcome: null, resolved: false };
  marketCache.set(slug, result);
  return result;
}

async function analyzeTokenPrice(tokenId: string): Promise<{ price: number; resolved: boolean }> {
  try {
    const url = `https://data-api.polymarket.com/prices?tokenIds=${tokenId}`;
    const response = await axios.get(url, { timeout: 5000 });

    if (response.data && response.data[tokenId]) {
      const price = parseFloat(response.data[tokenId]);
      const resolved = price >= 0.99 || price <= 0.01;
      return { price, resolved };
    }
  } catch (error) {
    // Ignore
  }
  return { price: 0.5, resolved: false };
}

async function main() {
  console.log('📊 Trade Analizi Başlıyor...\n');

  // Load data
  if (!fs.existsSync(DATA_PATH)) {
    console.error('❌ Veri dosyası bulunamadı:', DATA_PATH);
    return;
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const records: TradeRecord[] = data.records || [];

  console.log(`📁 Toplam kayıt: ${records.length}`);

  // Filter successful trades only
  const trades = records.filter(r => r.status === 'success' && r.amount && r.amount > 0);
  console.log(`✅ Başarılı trade: ${trades.length}`);

  // Group by market
  const marketGroups: Map<string, TradeRecord[]> = new Map();
  for (const trade of trades) {
    const slug = trade.marketSlug || 'unknown';
    if (!marketGroups.has(slug)) {
      marketGroups.set(slug, []);
    }
    marketGroups.get(slug)!.push(trade);
  }

  console.log(`🏪 Farklı market sayısı: ${marketGroups.size}`);
  console.log('\n🔍 Market sonuçları kontrol ediliyor...\n');

  // Analyze each market
  let totalSpent = 0;
  let totalPayout = 0;
  let resolvedCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  let pendingCount = 0;

  const marketResults: Array<{
    slug: string;
    title: string;
    trades: number;
    spent: number;
    payout: number;
    profit: number;
    winningOutcome: string | null;
    resolved: boolean;
  }> = [];

  let processed = 0;
  for (const [slug, marketTrades] of marketGroups) {
    processed++;
    process.stdout.write(`\r   İşleniyor: ${processed}/${marketGroups.size} - ${slug.slice(0, 30)}...`);

    // Try to get market result
    const result = await getMarketResult(slug);

    // If no result from market API, check token prices
    let winningOutcome = result.winningOutcome;
    if (!winningOutcome && marketTrades.length > 0 && marketTrades[0].tokenId) {
      const { price, resolved } = await analyzeTokenPrice(marketTrades[0].tokenId!);
      if (resolved) {
        // If price is high, this outcome won
        if (price >= 0.99) {
          winningOutcome = marketTrades[0].outcome || null;
        } else if (price <= 0.01) {
          // This outcome lost, so the other side won
          winningOutcome = marketTrades[0].outcome === 'Up' ? 'Down' : 'Up';
        }
      }
    }

    // Calculate P/L for this market
    let marketSpent = 0;
    let marketPayout = 0;

    for (const trade of marketTrades) {
      const spent = trade.amount || 0;
      marketSpent += spent;

      if (winningOutcome) {
        // Market resolved
        const won = trade.outcome === winningOutcome;
        if (won) {
          // Payout = shares = amount / buyPrice
          const shares = spent / (trade.buyPrice || 0.5);
          marketPayout += shares; // Each winning share pays $1
          wonCount++;
        } else {
          // Lost - payout is 0
          lostCount++;
        }
        resolvedCount++;
      } else {
        pendingCount++;
      }
    }

    marketResults.push({
      slug,
      title: marketTrades[0]?.marketTitle || slug,
      trades: marketTrades.length,
      spent: marketSpent,
      payout: marketPayout,
      profit: marketPayout - marketSpent,
      winningOutcome,
      resolved: !!winningOutcome
    });

    totalSpent += marketSpent;
    totalPayout += marketPayout;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n\n');

  // Calculate final stats
  const totalProfit = totalPayout - totalSpent;
  const winRate = resolvedCount > 0 ? ((wonCount / resolvedCount) * 100).toFixed(1) : 'N/A';
  const roi = totalSpent > 0 ? ((totalProfit / totalSpent) * 100).toFixed(1) : 'N/A';

  // Generate report
  let report = '';
  report += '═'.repeat(80) + '\n';
  report += '                         COPY TRADING - ANALİZ RAPORU\n';
  report += '═'.repeat(80) + '\n';
  report += `Tarih: ${new Date().toLocaleString('tr-TR')}\n`;
  report += `Veri Dosyası: ${DATA_PATH}\n`;
  report += '═'.repeat(80) + '\n\n';

  // Summary
  report += '┌' + '─'.repeat(78) + '┐\n';
  report += '│' + '                              ÖZET'.padEnd(78) + '│\n';
  report += '├' + '─'.repeat(78) + '┤\n';
  report += '│' + `  Toplam Trade:              ${trades.length}`.padEnd(78) + '│\n';
  report += '│' + `  Farklı Market:             ${marketGroups.size}`.padEnd(78) + '│\n';
  report += '│' + `  Çözümlenen Trade:          ${resolvedCount}`.padEnd(78) + '│\n';
  report += '│' + `  Bekleyen Trade:            ${pendingCount}`.padEnd(78) + '│\n';
  report += '├' + '─'.repeat(78) + '┤\n';
  report += '│' + `  ✅ Kazanan:                 ${wonCount}`.padEnd(78) + '│\n';
  report += '│' + `  ❌ Kaybeden:                ${lostCount}`.padEnd(78) + '│\n';
  report += '│' + `  📊 Kazanma Oranı:           ${winRate}%`.padEnd(78) + '│\n';
  report += '├' + '─'.repeat(78) + '┤\n';
  report += '│' + `  💰 Toplam Harcanan:         $${totalSpent.toFixed(2)}`.padEnd(78) + '│\n';
  report += '│' + `  💵 Toplam Geri Dönüş:       $${totalPayout.toFixed(2)}`.padEnd(78) + '│\n';
  report += '│' + `  ──────────────────────────────────────`.padEnd(78) + '│\n';
  const profitStr = (totalProfit >= 0 ? '+' : '') + '$' + totalProfit.toFixed(2);
  report += '│' + `  🎯 NET KAR/ZARAR:           ${profitStr}`.padEnd(78) + '│\n';
  report += '│' + `  📈 ROI:                     ${roi}%`.padEnd(78) + '│\n';
  report += '└' + '─'.repeat(78) + '┘\n\n';

  // Console output
  console.log('═'.repeat(60));
  console.log('                    SONUÇLAR');
  console.log('═'.repeat(60));
  console.log(`  Toplam Trade:        ${trades.length}`);
  console.log(`  Çözümlenen:          ${resolvedCount}`);
  console.log(`  Bekleyen:            ${pendingCount}`);
  console.log('');
  console.log(`  ✅ Kazanan:           ${wonCount}`);
  console.log(`  ❌ Kaybeden:          ${lostCount}`);
  console.log(`  📊 Kazanma Oranı:     ${winRate}%`);
  console.log('');
  console.log(`  💰 Harcanan:          $${totalSpent.toFixed(2)}`);
  console.log(`  💵 Geri Dönüş:        $${totalPayout.toFixed(2)}`);
  console.log(`  🎯 Net Kar/Zarar:     ${profitStr}`);
  console.log(`  📈 ROI:               ${roi}%`);
  console.log('═'.repeat(60));

  // Market details (top 20 by profit/loss)
  report += '┌' + '─'.repeat(78) + '┐\n';
  report += '│' + '                    MARKET DETAYLARI (İlk 50)'.padEnd(78) + '│\n';
  report += '└' + '─'.repeat(78) + '┘\n\n';

  // Sort by resolved first, then by profit
  const sortedMarkets = marketResults
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? -1 : 1;
      return b.profit - a.profit;
    })
    .slice(0, 50);

  for (const m of sortedMarkets) {
    const status = m.resolved
      ? (m.profit >= 0 ? '✅' : '❌')
      : '⏳';
    const profitStr = m.resolved
      ? `${m.profit >= 0 ? '+' : ''}$${m.profit.toFixed(2)}`
      : 'Beklemede';

    report += `${status} ${m.title}\n`;
    report += `   Kazanan: ${m.winningOutcome || 'Belirsiz'} | Trade: ${m.trades} | Harcanan: $${m.spent.toFixed(2)} | Kar/Zarar: ${profitStr}\n\n`;
  }

  // Footer
  report += '\n' + '═'.repeat(80) + '\n';
  report += `Rapor oluşturulma: ${new Date().toLocaleString('tr-TR')}\n`;
  report += '═'.repeat(80) + '\n';

  // Save report
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\n📄 Detaylı rapor kaydedildi: ${REPORT_PATH}`);
}

main().catch(console.error);
