/**
 * Smart Tracking Strategy
 * Hangi marketleri ne zaman takip edeceğimize karar verir
 */

import { MarketRegistry, RegisteredMarket } from '../database/market-registry';
import { MarketDataFetcher } from '../utils/market-data-fetcher-v2';

export interface TrackingCriteria {
  minVolume: number; // Minimum 24h volume ($)
  minLiquidity?: number; // Minimum liquidity
  priceRange: {
    min: number; // Minimum fiyat (0-1 arası)
    max: number; // Maximum fiyat (0-1 arası)
  };
  categories?: string[]; // İlgilenilen kategoriler
  keywords?: string[]; // Soru içinde olması gereken kelimeler
}

export interface TrackingDecision {
  shouldTrack: boolean;
  reason: string;
  targetProfit: number; // Hedef kar %
  strategy: 'NEWS_DRIVEN' | 'MOMENTUM' | 'CONTRARIAN' | 'VALUE';
}

export class SmartTrackingStrategy {
  private registry: MarketRegistry;
  private fetcher: MarketDataFetcher;

  constructor() {
    this.registry = new MarketRegistry();
    this.fetcher = new MarketDataFetcher();
  }

  /**
   * Market takip edilmeli mi?
   */
  shouldTrackMarket(market: RegisteredMarket): TrackingDecision {
    // 1. Zaten takip ediliyor mu?
    if (market.tracking) {
      return {
        shouldTrack: false,
        reason: 'Already tracking',
        targetProfit: market.targetProfit || 50,
        strategy: 'NEWS_DRIVEN',
      };
    }

    // 2. Kapanmış veya inaktif
    if (market.closed || !market.active) {
      return {
        shouldTrack: false,
        reason: 'Market closed or inactive',
        targetProfit: 0,
        strategy: 'NEWS_DRIVEN',
      };
    }

    // 3. Volume çok düşük
    if (market.volume24hr < 10000) {
      // $10K minimum
      return {
        shouldTrack: false,
        reason: 'Low volume < $10K',
        targetProfit: 0,
        strategy: 'NEWS_DRIVEN',
      };
    }

    // 4. Fiyat analizi
    const yesPrice = market.tokens.find(t => t.outcome === 'Yes')?.currentPrice || 0.5;

    // CONTRARIAN STRATEJI: Çok düşük fiyatlı (< %15)
    if (yesPrice < 0.15 && market.volume24hr > 50000) {
      return {
        shouldTrack: true,
        reason: `Contrarian play: Low price (${(yesPrice * 100).toFixed(1)}%) with good volume`,
        targetProfit: 100, // %100 hedef (contrarian riskli)
        strategy: 'CONTRARIAN',
      };
    }

    // NEWS DRIVEN: Orta fiyat + yüksek volume (haber potansiyeli)
    if (yesPrice >= 0.25 && yesPrice <= 0.45 && market.volume24hr > 100000) {
      return {
        shouldTrack: true,
        reason: `News-driven opportunity: Mid-range price with high volume ($${(market.volume24hr / 1000).toFixed(0)}K)`,
        targetProfit: 50, // %50 hedef
        strategy: 'NEWS_DRIVEN',
      };
    }

    // MOMENTUM: Fiyat artışı potansiyeli (35-50% arası + yüksek volume)
    if (yesPrice >= 0.35 && yesPrice <= 0.50 && market.volume24hr > 200000) {
      return {
        shouldTrack: true,
        reason: `Momentum play: Good price range with very high volume`,
        targetProfit: 40, // %40 hedef
        strategy: 'MOMENTUM',
      };
    }

    // VALUE: Çok yüksek volume (>$500K) ama henüz 50-50'ye yakın
    if (yesPrice >= 0.45 && yesPrice <= 0.55 && market.volume24hr > 500000) {
      return {
        shouldTrack: true,
        reason: `Value play: Balanced odds with massive volume ($${(market.volume24hr / 1000).toFixed(0)}K)`,
        targetProfit: 30, // %30 hedef (daha güvenli)
        strategy: 'VALUE',
      };
    }

    return {
      shouldTrack: false,
      reason: 'No clear strategy match',
      targetProfit: 0,
      strategy: 'NEWS_DRIVEN',
    };
  }

  /**
   * Kategori bazlı strateji
   */
  getCategoryStrategy(category: string): TrackingCriteria {
    switch (category) {
      case 'politics':
        return {
          minVolume: 100000, // $100K+
          priceRange: { min: 0.20, max: 0.55 },
          keywords: ['election', 'president', 'senate', 'congress'],
        };

      case 'crypto':
        return {
          minVolume: 50000, // $50K+
          priceRange: { min: 0.15, max: 0.60 },
          keywords: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto'],
        };

      case 'sports':
        return {
          minVolume: 20000, // $20K+
          priceRange: { min: 0.30, max: 0.70 },
          keywords: ['win', 'championship', 'game', 'match'],
        };

      case 'tech':
        return {
          minVolume: 30000, // $30K+
          priceRange: { min: 0.20, max: 0.60 },
          keywords: ['ai', 'stock', 'ipo', 'product', 'release'],
        };

      default:
        return {
          minVolume: 50000,
          priceRange: { min: 0.20, max: 0.60 },
        };
    }
  }

  /**
   * Tüm marketleri tara ve takip edilmesi gerekenleri bul
   */
  async scanForTrackingOpportunities(): Promise<RegisteredMarket[]> {
    console.log('\n🔍 Scanning for tracking opportunities...\n');

    const allMarkets = this.registry.getUntrackedMarkets();
    const opportunities: RegisteredMarket[] = [];

    for (const market of allMarkets) {
      const decision = this.shouldTrackMarket(market);

      if (decision.shouldTrack) {
        console.log(`✅ ${market.question}`);
        console.log(`   Strategy: ${decision.strategy}`);
        console.log(`   Reason: ${decision.reason}`);
        console.log(`   Target: +${decision.targetProfit}%\n`);

        opportunities.push(market);
      }
    }

    console.log(`\n📊 Found ${opportunities.length} tracking opportunities\n`);
    return opportunities;
  }

  /**
   * Market'i otomatik takibe al
   */
  async autoTrackMarket(market: RegisteredMarket): Promise<boolean> {
    const decision = this.shouldTrackMarket(market);

    if (!decision.shouldTrack) {
      return false;
    }

    const yesPrice = market.tokens.find(t => t.outcome === 'Yes')?.currentPrice || 0.5;

    return this.registry.startTracking(
      market.conditionId,
      decision.reason,
      yesPrice,
      decision.targetProfit
    );
  }

  /**
   * Takipten çıkarma kriteri (market bitmiş veya değersiz)
   */
  shouldStopTracking(market: RegisteredMarket): { shouldStop: boolean; reason: string } {
    // Kapanmış
    if (market.closed) {
      return { shouldStop: true, reason: 'Market closed' };
    }

    // Artık aktif değil
    if (!market.active) {
      return { shouldStop: true, reason: 'Market inactive' };
    }

    // Volume çok düştü
    if (market.volume24hr < 5000) {
      return { shouldStop: true, reason: 'Volume dropped below $5K' };
    }

    // Fiyat çok yükseldi (>90%) - hedef muhtemelen ulaşıldı
    const yesPrice = market.tokens.find(t => t.outcome === 'Yes')?.currentPrice || 0.5;
    if (yesPrice > 0.90) {
      return { shouldStop: true, reason: 'Price too high (>90%), likely resolved' };
    }

    // Fiyat çok düştü (<5%) - umut yok
    if (yesPrice < 0.05) {
      return { shouldStop: true, reason: 'Price too low (<5%), unlikely to recover' };
    }

    return { shouldStop: false, reason: '' };
  }

  /**
   * Hedef kar kontrolü
   */
  checkTargetProfit(market: RegisteredMarket): {
    reached: boolean;
    currentProfit: number;
    shouldSell: boolean;
  } {
    if (!market.entryPrice) {
      return { reached: false, currentProfit: 0, shouldSell: false };
    }

    const currentPrice = market.tokens.find(t => t.outcome === 'Yes')?.currentPrice || 0.5;
    const profit = ((currentPrice - market.entryPrice) / market.entryPrice) * 100;

    const targetProfit = market.targetProfit || 50;

    return {
      reached: profit >= targetProfit,
      currentProfit: profit,
      shouldSell: profit >= targetProfit || profit <= -20, // Hedef veya stop-loss
    };
  }
}
