/**
 * Market Data Fetcher V2
 * Fetch real market data from Polymarket APIs
 * - Gamma API: Market discovery and search
 * - CLOB API: Token IDs and prices
 */

export interface MarketData {
  conditionId: string;
  question: string;
  slug: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  volume24hr: number;
  active: boolean;
  closed: boolean;
  endDate?: string;
  description?: string;
}

interface GammaMarket {
  question: string;
  conditionId: string;
  slug: string;
  description?: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  volume24hr?: number;
}

interface ClobMarket {
  condition_id: string;
  question: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: string;
  }>;
}

export class MarketDataFetcher {
  private readonly gammaUrl = 'https://gamma-api.polymarket.com';
  private readonly clobUrl = 'https://clob.polymarket.com';
  private cache = new Map<string, { data: MarketData; timestamp: number }>();
  private readonly CACHE_TTL = 60 * 1000; // 1 minute

  /**
   * Fetch market by condition ID
   */
  async fetchMarket(conditionId: string): Promise<MarketData | null> {
    try {
      // Check cache
      const cached = this.cache.get(conditionId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      // Fetch from CLOB API (has token IDs and prices)
      const response = await fetch(`${this.clobUrl}/markets/${conditionId}`);
      if (!response.ok) {
        console.warn(`Market ${conditionId} not found on CLOB`);
        return null;
      }

      const clobMarket = await response.json() as ClobMarket;
      const marketData = this.parseClobMarket(clobMarket);

      if (marketData) {
        this.cache.set(conditionId, { data: marketData, timestamp: Date.now() });
      }

      return marketData;
    } catch (error) {
      console.error(`Error fetching market ${conditionId}:`, error);
      return null;
    }
  }

  /**
   * Get popular/trending markets
   */
  async getTrendingMarkets(limit: number = 10): Promise<MarketData[]> {
    try {
      // Fetch from Gamma API sorted by 24h volume
      const response = await fetch(
        `${this.gammaUrl}/markets?limit=${limit}&closed=false&order=volume24hr&ascending=false`
      );

      if (!response.ok) {
        console.warn(`Failed to fetch trending markets: ${response.status}`);
        return [];
      }

      const gammaMarkets = await response.json() as GammaMarket[];
      
      // Fetch full details (including tokens) from CLOB for each
      const markets: MarketData[] = [];
      for (const gamma of gammaMarkets) {
        if (!gamma.conditionId) continue;
        
        const market = await this.fetchMarket(gamma.conditionId);
        if (market && market.active && !market.closed) {
          // Enrich with Gamma data
          market.volume24hr = gamma.volume24hr || 0;
          market.description = gamma.description;
          market.endDate = gamma.endDate; // ✅ Add end date from Gamma
          markets.push(market);
        }
      }

      return markets;
    } catch (error) {
      console.error('Error fetching trending markets:', error);
      return [];
    }
  }

  /**
   * Search markets by keyword
   */
  async searchMarkets(keyword: string, limit: number = 10): Promise<MarketData[]> {
    try {
      // Search via Gamma API
      const response = await fetch(
        `${this.gammaUrl}/markets?limit=${limit * 2}&closed=false`
      );

      if (!response.ok) {
        console.warn(`Failed to search markets: ${response.status}`);
        return [];
      }

      const gammaMarkets = await response.json() as GammaMarket[];
      
      // Filter by keyword
      const filtered = gammaMarkets.filter(m => 
        m.question.toLowerCase().includes(keyword.toLowerCase())
      ).slice(0, limit);

      // Fetch full details from CLOB
      const markets: MarketData[] = [];
      for (const gamma of filtered) {
        if (!gamma.conditionId) continue;
        
        const market = await this.fetchMarket(gamma.conditionId);
        if (market && market.active && !market.closed) {
          market.volume24hr = gamma.volume24hr || 0;
          market.description = gamma.description;
          markets.push(market);
        }
      }

      return markets;
    } catch (error) {
      console.error('Error searching markets:', error);
      return [];
    }
  }

  /**
   * Parse CLOB market to MarketData
   */
  private parseClobMarket(clob: ClobMarket): MarketData | null {
    try {
      // Find YES and NO tokens
      const yesToken = clob.tokens.find(t => 
        t.outcome.toLowerCase() === 'yes'
      );
      const noToken = clob.tokens.find(t => 
        t.outcome.toLowerCase() === 'no'
      );

      if (!yesToken || !noToken) {
        console.warn(`Market ${clob.condition_id} missing YES/NO tokens`);
        return null;
      }

      return {
        conditionId: clob.condition_id,
        question: clob.question,
        slug: clob.question.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        yesTokenId: yesToken.token_id,
        noTokenId: noToken.token_id,
        yesPrice: parseFloat(yesToken.price),
        noPrice: parseFloat(noToken.price),
        volume24hr: 0, // Will be enriched from Gamma
        active: true,
        closed: false,
      };
    } catch (error) {
      console.error('Error parsing CLOB market:', error);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
