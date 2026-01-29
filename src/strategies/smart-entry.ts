/**
 * Smart Market Entry Strategy
 * Yeni marketlerde düşük fiyattan entry, haber-driven trading
 */

import { MarketRegistry, RegisteredMarket } from '../database/market-registry';
import { MarketDataFetcher } from '../utils/market-data-fetcher-v2';

export interface MarketEntrySignal {
  conditionId: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  side: 'YES' | 'NO';
  entryPrice: number;
  targetPrice: number;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  daysToClose: number;
}

export class SmartMarketEntry {
  private registry: MarketRegistry;
  private fetcher: MarketDataFetcher;

  constructor() {
    this.registry = new MarketRegistry();
    this.fetcher = new MarketDataFetcher();
  }

  /**
   * Yeni market entry fırsatlarını bul
   * Kriter: Fiyat <$0.10 ve 6+ gün kala
   */
  async scanNewMarketEntries(): Promise<MarketEntrySignal[]> {
    console.log('\n🔍 Scanning for new market entry opportunities...\n');

    const allMarkets = this.registry.getAllMarkets();
    const signals: MarketEntrySignal[] = [];

    for (const market of allMarkets) {
      // Skip if already tracking
      if (market.tracking) continue;

      // Skip if closed
      if (market.closed || !market.active) continue;

      // Calculate days to close
      const daysToClose = market.endDate
        ? Math.ceil(
            (new Date(market.endDate).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24)
          )
        : 999;

      // Must have 6+ days remaining
      if (daysToClose < 6) continue;

      // Check YES token price
      const yesToken = market.tokens.find(t => t.outcome === 'Yes');
      const noToken = market.tokens.find(t => t.outcome === 'No');

      if (!yesToken || !noToken) continue;

      const yesPrice = yesToken.currentPrice || 0;
      const noPrice = noToken.currentPrice || 0;

      // NEW MARKET ENTRY: YES price <$0.10 (10%)
      if (yesPrice < 0.10 && yesPrice > 0.01) {
        signals.push({
          conditionId: market.conditionId,
          question: market.question,
          yesTokenId: yesToken.tokenId,
          noTokenId: noToken.tokenId,
          side: 'YES',
          entryPrice: yesPrice,
          targetPrice: 0.50, // Target 50% for 5x profit
          reason: `New market entry: ${(yesPrice * 100).toFixed(1)}¢ with ${daysToClose} days remaining`,
          confidence: yesPrice < 0.05 ? 'HIGH' : 'MEDIUM',
          daysToClose,
        });
      }

      // NEW MARKET ENTRY: NO price <$0.10 (YES >90%)
      if (noPrice < 0.10 && noPrice > 0.01) {
        signals.push({
          conditionId: market.conditionId,
          question: market.question,
          yesTokenId: yesToken.tokenId,
          noTokenId: noToken.tokenId,
          side: 'NO',
          entryPrice: noPrice,
          targetPrice: 0.50,
          reason: `New market entry (NO side): ${(noPrice * 100).toFixed(1)}¢ with ${daysToClose} days remaining`,
          confidence: noPrice < 0.05 ? 'HIGH' : 'MEDIUM',
          daysToClose,
        });
      }
    }

    // Sort by confidence and entry price (lower = better)
    signals.sort((a, b) => {
      const confScore = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      if (confScore[a.confidence] !== confScore[b.confidence]) {
        return confScore[b.confidence] - confScore[a.confidence];
      }
      return a.entryPrice - b.entryPrice;
    });

    console.log(`✅ Found ${signals.length} new market entry opportunities\n`);
    return signals;
  }

  /**
   * Market için özel haber feedlerini belirle
   */
  getNewsSourcesForMarket(market: RegisteredMarket): string[] {
    const question = market.question.toLowerCase();
    const sources: string[] = [];

    // Government/Politics
    if (
      question.includes('government') ||
      question.includes('shutdown') ||
      question.includes('congress') ||
      question.includes('senate')
    ) {
      sources.push('https://www.congress.gov/rss');
      sources.push('https://thehill.com/rss');
      sources.push('https://www.politico.com/rss');
    }

    // Elon Musk / Twitter / X
    if (
      question.includes('elon') ||
      question.includes('musk') ||
      question.includes('twitter') ||
      question.includes('tweet')
    ) {
      sources.push('https://api.twitter.com'); // Twitter API (requires key)
      sources.push('https://nitter.net/elonmusk/rss'); // Alternative
    }

    // Bitcoin / Crypto
    if (
      question.includes('bitcoin') ||
      question.includes('btc') ||
      question.includes('crypto')
    ) {
      sources.push('https://api.coingecko.com/api/v3/coins/bitcoin');
      sources.push('https://www.coindesk.com/arc/outboundfeeds/rss/');
    }

    // Sports
    if (
      question.includes('win') ||
      question.includes('championship') ||
      question.includes('game')
    ) {
      sources.push('https://www.thesportsdb.com/api/v1/json/3/');
    }

    // Tech companies
    if (
      question.includes('tesla') ||
      question.includes('apple') ||
      question.includes('google')
    ) {
      sources.push('https://techcrunch.com/feed/');
      sources.push('https://www.theverge.com/rss/index.xml');
    }

    return sources;
  }

  /**
   * Market kategorisini belirle
   */
  categorizeMarket(market: RegisteredMarket): string {
    const q = market.question.toLowerCase();

    if (q.includes('elon') || q.includes('musk')) return 'elon-musk';
    if (q.includes('government') || q.includes('shutdown')) return 'government';
    if (q.includes('bitcoin') || q.includes('crypto')) return 'crypto';
    if (q.includes('election') || q.includes('vote')) return 'politics';
    if (q.includes('win') || q.includes('championship')) return 'sports';
    if (q.includes('stock') || q.includes('price')) return 'finance';

    return 'other';
  }

  /**
   * Exit sinyali kontrol et (fiyat yükseldi mi?)
   */
  checkExitSignal(market: RegisteredMarket): {
    shouldExit: boolean;
    reason: string;
    profitPercent: number;
  } {
    if (!market.entryPrice) {
      return { shouldExit: false, reason: '', profitPercent: 0 };
    }

    const currentPrice = market.tokens[0].currentPrice || 0;
    const profit = ((currentPrice - market.entryPrice) / market.entryPrice) * 100;

    // Take profit levels
    if (profit >= 200) {
      // 3x profit
      return {
        shouldExit: true,
        reason: 'Take profit: 3x gains achieved',
        profitPercent: profit,
      };
    }

    if (profit >= 100) {
      // 2x profit
      return {
        shouldExit: true,
        reason: 'Take profit: 2x gains achieved',
        profitPercent: profit,
      };
    }

    if (profit >= 50) {
      // 1.5x profit
      return {
        shouldExit: true,
        reason: 'Take profit: 50% gains achieved',
        profitPercent: profit,
      };
    }

    // Stop loss
    if (profit <= -30) {
      return {
        shouldExit: true,
        reason: 'Stop loss: -30% hit',
        profitPercent: profit,
      };
    }

    return { shouldExit: false, reason: '', profitPercent: profit };
  }

  /**
   * Market için logging
   */
  logEntrySignal(signal: MarketEntrySignal): void {
    const emoji = signal.confidence === 'HIGH' ? '🔥' : '💎';
    console.log(`${emoji} ${signal.question}`);
    console.log(
      `   Side: ${signal.side} @ ${(signal.entryPrice * 100).toFixed(1)}¢ → Target: ${(signal.targetPrice * 100).toFixed(1)}¢`
    );
    console.log(
      `   Potential: ${((signal.targetPrice / signal.entryPrice - 1) * 100).toFixed(0)}x profit`
    );
    console.log(`   Days to close: ${signal.daysToClose}`);
    console.log(`   Token IDs: YES=${signal.yesTokenId}, NO=${signal.noTokenId}`);
    console.log(`   Reason: ${signal.reason}\n`);
  }
}
