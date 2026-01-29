/**
 * Market Data Fetcher
 * Fetch real market data from Polymarket API
 */

export interface MarketData {
  conditionId: string;
  question: string;
  slug: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  volume24h: number;
  active: boolean;
  closed: boolean;
  endDate?: string;
}

export interface PolymarketAPIMarket {
  condition_id: string;
  question: string;
  slug?: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: string;
  }>;
  liquidity?: string;
  volume?: string;
  active?: boolean;
  closed?: boolean;
  end_date_iso?: string;
}

export class MarketDataFetcher {
  private readonly baseUrl = 'https://clob.polymarket.com';
  private cache: Map<string, { data: MarketData; timestamp: number }> = new Map();
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

      // Fetch from API
      const response = await fetch(`${this.baseUrl}/markets/${conditionId}`);
      if (!response.ok) {
        console.warn(`Failed to fetch market ${conditionId}: ${response.status}`);
        return null;
      }

      const apiMarket = await response.json() as PolymarketAPIMarket;
      const marketData = this.parseMarketData(apiMarket);

      // Cache it
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
   * Search markets by keyword
   */
  async searchMarkets(keyword: string, limit: number = 10): Promise<MarketData[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/markets?search=${encodeURIComponent(keyword)}&limit=${limit}`
      );

      if (!response.ok) {
        console.warn(`Failed to search markets: ${response.status}`);
        return [];
      }

      const data = await response.json() as any;
      
      // Handle different response formats
      let apiMarkets: PolymarketAPIMarket[] = [];
      if (Array.isArray(data)) {
        apiMarkets = data;
      } else if (data.data && Array.isArray(data.data)) {
        apiMarkets = data.data;
      } else if (data.markets && Array.isArray(data.markets)) {
        apiMarkets = data.markets;
      } else {
        console.warn(`Unexpected API response format:`, typeof data);
        return [];
      }

      return apiMarkets
        .map(m => this.parseMarketData(m))
        .filter((m): m is MarketData => m !== null);
    } catch (error) {
      console.error(`Error searching markets:`, error);
      return [];
    }
  }

  /**
   * Get popular/trending markets
   */
  async getTrendingMarkets(limit: number = 20): Promise<MarketData[]> {
    try {
      const response = await fetch(`${this.baseUrl}/markets?limit=${limit}&order=volume`);

      if (!response.ok) {
        console.warn(`Failed to fetch trending markets: ${response.status}`);
        return [];
      }

      const data = await response.json() as any;
      
      // Handle different response formats
      let apiMarkets: PolymarketAPIMarket[] = [];
      if (Array.isArray(data)) {
        apiMarkets = data;
      } else if (data.data && Array.isArray(data.data)) {
        apiMarkets = data.data;
      } else if (data.markets && Array.isArray(data.markets)) {
        apiMarkets = data.markets;
      } else {
        console.warn(`Unexpected API response format:`, typeof data);
        return [];
      }

      return apiMarkets
        .map(m => this.parseMarketData(m))
        .filter((m): m is MarketData => m !== null);
    } catch (error) {
      console.error(`Error fetching trending markets:`, error);
      return [];
    }
  }

  /**
   * Parse API market data to our format
   */
  private parseMarketData(apiMarket: PolymarketAPIMarket): MarketData | null {
    try {
      const yesToken = apiMarket.tokens.find(t => t.outcome.toLowerCase() === 'yes');
      const noToken = apiMarket.tokens.find(t => t.outcome.toLowerCase() === 'no');

      if (!yesToken || !noToken) {
        console.warn(`Market ${apiMarket.condition_id} missing YES/NO tokens`);
        return null;
      }

      return {
        conditionId: apiMarket.condition_id,
        question: apiMarket.question,
        slug: apiMarket.slug || apiMarket.question.toLowerCase().replace(/\s+/g, '-'),
        yesTokenId: yesToken.token_id,
        noTokenId: noToken.token_id,
        yesPrice: parseFloat(yesToken.price),
        noPrice: parseFloat(noToken.price),
        liquidity: parseFloat(apiMarket.liquidity || '0'),
        volume24h: parseFloat(apiMarket.volume || '0'),
        active: apiMarket.active !== false,
        closed: apiMarket.closed === true,
        endDate: apiMarket.end_date_iso,
      };
    } catch (error) {
      console.error(`Error parsing market data:`, error);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
