/**
 * Market Scanner - Continuous market monitoring and opportunity detection
 */

import { PolymarketClient } from '../client';
import { TimezoneUtils } from '../utils/timezone';
import { PriceTracker, PriceSnapshot, PriceChange } from './price-tracker';
import { logMarket, logNewMarket, checkForNewMarkets, initializeKnownMarkets, MarketLog } from '../utils/trade-logger';

export interface MarketOpportunity {
  marketId: string;
  marketSlug: string;
  marketQuestion: string;
  side: 'YES' | 'NO';
  tokenId: string;
  currentPrice: number;
  priceChange24h: number;
  liquidity: number;
  volume24h: number;
  entryScore: number; // 0-100
  reason: string[];
  category?: string;
  endDate?: string;
}

export interface ScannerConfig {
  scanIntervalMinutes: number; // How often to scan
  minLiquidity: number; // Minimum liquidity required ($)
  minVolume24h: number; // Minimum 24h volume ($)
  priceChangeThreshold: number; // Significant price change (%)
  maxMarketsToScan: number; // Limit API calls
  categories?: string[]; // Filter by categories
}

export class MarketScanner {
  private client: PolymarketClient;
  private priceTracker: PriceTracker;
  private config: ScannerConfig;
  private knownMarkets: Set<string> = new Set();
  private lastScanTime: Date | null = null;
  private scanning: boolean = false;

  constructor(client: PolymarketClient, config?: Partial<ScannerConfig>) {
    this.client = client;
    this.priceTracker = new PriceTracker();
    
    // Default configuration
    this.config = {
      scanIntervalMinutes: 5,
      minLiquidity: 5000, // $5K minimum
      minVolume24h: 1000, // $1K minimum
      priceChangeThreshold: 5, // 5% price change
      maxMarketsToScan: 200,
      ...config,
    };
  }

  /**
   * Initialize scanner with known markets
   */
  async initialize(): Promise<void> {
    TimezoneUtils.log('Initializing Market Scanner...', 'INFO');
    
    try {
      // Fetch current markets to establish baseline
      const markets = await this.fetchMarkets(this.config.maxMarketsToScan);
      
      const marketIds = markets.map(m => m.id);
      initializeKnownMarkets(marketIds);
      
      for (const marketId of marketIds) {
        this.knownMarkets.add(marketId);
      }

      TimezoneUtils.log(`✅ Scanner initialized with ${markets.length} markets`, 'INFO');
    } catch (error: any) {
      TimezoneUtils.log(`Failed to initialize scanner: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Fetch markets from Polymarket API
   */
  private async fetchMarkets(limit: number = 200): Promise<any[]> {
    try {
      const response = await fetch(
        `https://gamma-api.polymarket.com/markets?limit=${limit}&active=true&closed=false`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.statusText}`);
      }

      const markets: any[] = await response.json() as any[];
      return markets.filter(m => 
        m.active && 
        !m.closed && 
        parseFloat(m.liquidity || '0') >= this.config.minLiquidity
      );
    } catch (error: any) {
      TimezoneUtils.log(`Error fetching markets: ${error.message}`, 'ERROR');
      return [];
    }
  }

  /**
   * Scan markets for opportunities
   */
  async scan(): Promise<MarketOpportunity[]> {
    if (this.scanning) {
      TimezoneUtils.log('Scan already in progress, skipping...', 'WARN');
      return [];
    }

    this.scanning = true;
    const opportunities: MarketOpportunity[] = [];

    try {
      TimezoneUtils.log('🔍 Starting market scan...', 'INFO');
      const startTime = Date.now();

      // Fetch current markets
      const markets = await this.fetchMarkets(this.config.maxMarketsToScan);
      
      if (markets.length === 0) {
        TimezoneUtils.log('No markets fetched, skipping scan', 'WARN');
        return [];
      }

      // Check for new markets
      const newMarkets: any[] = [];
      for (const market of markets) {
        if (!this.knownMarkets.has(market.id)) {
          newMarkets.push(market);
          this.knownMarkets.add(market.id);
        }
      }

      if (newMarkets.length > 0) {
        TimezoneUtils.log(`🆕 Found ${newMarkets.length} new market(s)!`, 'INFO');
        
        for (const market of newMarkets) {
          const marketLog: MarketLog = this.createMarketLog(market);
          logNewMarket(marketLog);
        }
      }

      // Analyze each market for opportunities
      for (const market of markets) {
        try {
          const marketOpportunities = await this.analyzeMarket(market);
          opportunities.push(...marketOpportunities);
        } catch (error: any) {
          // Skip individual market errors
          continue;
        }
      }

      const scanDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      TimezoneUtils.log(
        `✅ Scan complete: ${markets.length} markets, ${opportunities.length} opportunities (${scanDuration}s)`,
        'INFO'
      );

      this.lastScanTime = new Date();

    } catch (error: any) {
      TimezoneUtils.log(`Scan error: ${error.message}`, 'ERROR');
    } finally {
      this.scanning = false;
    }

    return opportunities;
  }

  /**
   * Analyze a single market for trading opportunities
   */
  private async analyzeMarket(market: any): Promise<MarketOpportunity[]> {
    const opportunities: MarketOpportunity[] = [];

    try {
      const liquidity = parseFloat(market.liquidity || '0');
      const volume24h = parseFloat(market.volume24hr || '0');

      // Filter by liquidity and volume
      if (liquidity < this.config.minLiquidity || volume24h < this.config.minVolume24h) {
        return [];
      }

      // Parse tokens
      if (!market.tokens || market.tokens.length < 2) {
        return [];
      }

      const yesToken = market.tokens.find((t: any) => t.outcome === 'Yes');
      const noToken = market.tokens.find((t: any) => t.outcome === 'No');

      if (!yesToken || !noToken) {
        return [];
      }

      const yesPrice = parseFloat(yesToken.price || '0');
      const noPrice = parseFloat(noToken.price || '0');

      // Track prices
      const yesSnapshot: PriceSnapshot = {
        tokenId: yesToken.token_id,
        marketSlug: market.slug,
        side: 'YES',
        price: yesPrice,
        timestamp: new Date().toISOString(),
      };

      const noSnapshot: PriceSnapshot = {
        tokenId: noToken.token_id,
        marketSlug: market.slug,
        side: 'NO',
        price: noPrice,
        timestamp: new Date().toISOString(),
      };

      // Detect price changes
      const yesChange = this.priceTracker.detectPriceChange(yesSnapshot, this.config.priceChangeThreshold);
      const noChange = this.priceTracker.detectPriceChange(noSnapshot, this.config.priceChangeThreshold);

      // Track current prices
      this.priceTracker.trackPrice(yesSnapshot);
      this.priceTracker.trackPrice(noSnapshot);

      // Log significant price changes
      if (yesChange) {
        TimezoneUtils.log(
          `📈 ${market.question}: YES ${yesChange.oldPrice.toFixed(3)} → ${yesChange.newPrice.toFixed(3)} (${yesChange.changePercent > 0 ? '+' : ''}${yesChange.changePercent.toFixed(1)}%)`,
          'INFO'
        );
      }

      if (noChange) {
        TimezoneUtils.log(
          `📉 ${market.question}: NO ${noChange.oldPrice.toFixed(3)} → ${noChange.newPrice.toFixed(3)} (${noChange.changePercent > 0 ? '+' : ''}${noChange.changePercent.toFixed(1)}%)`,
          'INFO'
        );
      }

      // Evaluate YES opportunity
      const yesOpp = this.evaluateOpportunity(market, 'YES', yesPrice, yesToken.token_id, liquidity, volume24h);
      if (yesOpp) {
        opportunities.push(yesOpp);
      }

      // Evaluate NO opportunity
      const noOpp = this.evaluateOpportunity(market, 'NO', noPrice, noToken.token_id, liquidity, volume24h);
      if (noOpp) {
        opportunities.push(noOpp);
      }

    } catch (error: any) {
      // Skip market on error
    }

    return opportunities;
  }

  /**
   * Evaluate if a market side is a good opportunity
   */
  private evaluateOpportunity(
    market: any,
    side: 'YES' | 'NO',
    price: number,
    tokenId: string,
    liquidity: number,
    volume24h: number
  ): MarketOpportunity | null {
    const reasons: string[] = [];
    let score = 0;

    // Low price entry (< 10% = good upside potential)
    if (price < 0.10) {
      reasons.push('Very low entry price (<10%)');
      score += 30;
    } else if (price < 0.20) {
      reasons.push('Low entry price (<20%)');
      score += 20;
    }

    // Medium price with high volume (momentum)
    if (price >= 0.20 && price <= 0.50 && volume24h > 10000) {
      reasons.push('Medium price with high volume');
      score += 15;
    }

    // High liquidity (easy entry/exit)
    if (liquidity > 50000) {
      reasons.push('High liquidity (>$50K)');
      score += 15;
    } else if (liquidity > 20000) {
      reasons.push('Good liquidity (>$20K)');
      score += 10;
    }

    // High volume (active trading)
    if (volume24h > 50000) {
      reasons.push('Very high 24h volume (>$50K)');
      score += 15;
    } else if (volume24h > 10000) {
      reasons.push('High 24h volume (>$10K)');
      score += 10;
    }

    // Price trend analysis
    const trend = this.priceTracker.getPriceTrend(tokenId, side);
    if (trend.trend === 'UP' && price < 0.50) {
      reasons.push('Upward price trend');
      score += 10;
    } else if (trend.trend === 'DOWN' && price > 0.50) {
      reasons.push('Downward trend from high price');
      score += 5;
    }

    // Must have at least one reason
    if (reasons.length === 0 || score < 30) {
      return null;
    }

    return {
      marketId: market.id,
      marketSlug: market.slug,
      marketQuestion: market.question,
      side,
      tokenId,
      currentPrice: price,
      priceChange24h: parseFloat(market.oneDayPriceChange || '0'),
      liquidity,
      volume24h,
      entryScore: Math.min(score, 100),
      reason: reasons,
      category: market.category,
      endDate: market.endDate,
    };
  }

  /**
   * Create market log entry
   */
  private createMarketLog(market: any): MarketLog {
    const yesToken = market.tokens?.find((t: any) => t.outcome === 'Yes');
    const noToken = market.tokens?.find((t: any) => t.outcome === 'No');
    
    const yesPrice = parseFloat(yesToken?.price || '0');
    const noPrice = parseFloat(noToken?.price || '0');
    const spread = Math.abs(yesPrice - noPrice);

    return {
      timestamp: new Date().toISOString(),
      marketId: market.id,
      slug: market.slug,
      question: market.question,
      yesPrice,
      noPrice,
      liquidity: parseFloat(market.liquidity || '0'),
      volume24h: parseFloat(market.volume24hr || '0'),
      spread,
      score: 0,
      category: market.category,
      endDate: market.endDate,
    };
  }

  /**
   * Get last scan time
   */
  getLastScanTime(): Date | null {
    return this.lastScanTime;
  }

  /**
   * Get scanner status
   */
  getStatus(): {
    scanning: boolean;
    lastScan: Date | null;
    knownMarkets: number;
    isWithinTradingHours: boolean;
    isPrimeTradingHours: boolean;
  } {
    return {
      scanning: this.scanning,
      lastScan: this.lastScanTime,
      knownMarkets: this.knownMarkets.size,
      isWithinTradingHours: TimezoneUtils.isWithinTradingHours(),
      isPrimeTradingHours: TimezoneUtils.isPrimeTradingHours(),
    };
  }

  /**
   * Clean up old data
   */
  cleanup(): void {
    this.priceTracker.clearOldData(24);
  }
}
