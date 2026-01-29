/**
 * MARKET FETCHER
 * 
 * football-matches.json'dan market verilerini çeker (token IDs dahil)
 * Artık Polymarket API'ye gitmeye gerek yok!
 */

import * as fs from 'fs';
import * as path from 'path';
import { PolymarketMarket, PolymarketToken } from './types';

export interface MarketSearchResult {
  market: PolymarketMarket;
  homeToken: PolymarketToken;
  awayToken: PolymarketToken;
  drawToken?: PolymarketToken;
}

interface MarketOutcome {
  question: string;
  outcomes: string;
  clobTokenIds: string;
  conditionId: string;
}

interface FootballMatchData {
  slug: string;
  title: string;
  homeTeam?: string;
  awayTeam?: string;
  markets?: MarketOutcome[];
  volume24hr?: number;
  liquidity?: number;
  endDate?: string;
}

export class MarketFetcher {
  private cache: Map<string, MarketSearchResult> = new Map();
  private matchData: Map<string, FootballMatchData> = new Map();
  private dataLoaded: boolean = false;

  /**
   * Load football-matches.json data
   */
  private loadMatchData(): void {
    if (this.dataLoaded) return;

    try {
      const dataPath = path.join(process.cwd(), 'data', 'football-matches.json');
      const jsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      const matches: FootballMatchData[] = jsonData.matches || [];

      matches.forEach(match => {
        this.matchData.set(match.slug, match);
      });

      this.dataLoaded = true;
      console.log(`📦 Loaded ${matches.length} matches from football-matches.json`);
    } catch (error: any) {
      console.error(`❌ Failed to load football-matches.json:`, error.message);
    }
  }

  /**
   * Slug'dan market bilgilerini çek (LOCAL DATA - football-matches.json)
   * Local'de yoksa Polymarket Gamma API'den çek!
   * 
   * @param slug - Market slug (örn: spl-haz-kha-2025-11-06)
   * @returns Market + token bilgileri
   */
  async fetchMarketBySlug(slug: string): Promise<MarketSearchResult | null> {
    // Load data if not loaded
    this.loadMatchData();

    // Cache kontrolü
    if (this.cache.has(slug)) {
      console.log(`📦 Cache hit: ${slug}`);
      return this.cache.get(slug)!;
    }

    try {
      console.log(`\n🔍 Market aranıyor (LOCAL): ${slug}`);

      // Get match from loaded data
      const matchData = this.matchData.get(slug);

      if (!matchData || !matchData.markets || matchData.markets.length === 0) {
        console.log(`   ⚠️  Local'de yok, Polymarket API'den deneniyor...`);
        return await this.fetchFromPolymarketAPI(slug);
      }

      console.log(`   ✅ Match bulundu: ${matchData.title}`);
      console.log(`   📊 Markets: ${matchData.markets.length}`);

      // Parse markets
      const homeWinMarket = matchData.markets.find(m => 
        m.question.includes(matchData.homeTeam || 'home') && m.question.toLowerCase().includes('win')
      );
      const drawMarket = matchData.markets.find(m => 
        m.question.toLowerCase().includes('draw')
      );
      const awayWinMarket = matchData.markets.find(m => 
        m.question.includes(matchData.awayTeam || 'away') && m.question.toLowerCase().includes('win')
      );

      if (!homeWinMarket || !awayWinMarket) {
        console.log(`   ❌ Home/Away markets parse edilemedi`);
        console.log(`   Markets:`, matchData.markets.map(m => m.question));
        return null;
      }

      // Parse token IDs
      const homeTokens = JSON.parse(homeWinMarket.clobTokenIds); // [YES, NO]
      const awayTokens = JSON.parse(awayWinMarket.clobTokenIds); // [YES, NO]
      const drawTokens = drawMarket ? JSON.parse(drawMarket.clobTokenIds) : null;

      // Gerçek fiyatları al!
      const homeYesPrice = await this.getTokenPrice(homeTokens[0]);
      const awayYesPrice = await this.getTokenPrice(awayTokens[0]);
      const drawYesPrice = drawTokens ? await this.getTokenPrice(drawTokens[0]) : 0.5;

      // Create PolymarketToken objects - store BOTH YES and NO
      const homeToken: PolymarketToken = {
        yesTokenId: homeTokens[0],  // YES token
        noTokenId: homeTokens[1],   // NO token
        yesPrice: homeYesPrice,
        noPrice: 1 - homeYesPrice,  // ✅ 1 - YES = NO price
        outcome: homeWinMarket.question,
        winner: false
      };

      const awayToken: PolymarketToken = {
        yesTokenId: awayTokens[0],  // YES token
        noTokenId: awayTokens[1],   // NO token
        yesPrice: awayYesPrice,
        noPrice: 1 - awayYesPrice,  // ✅ 1 - YES = NO price
        outcome: awayWinMarket.question,
        winner: false
      };

      let drawToken: PolymarketToken | undefined = undefined;
      if (drawTokens) {
        drawToken = {
          yesTokenId: drawTokens[0],  // YES token
          noTokenId: drawTokens[1],   // NO token
          yesPrice: drawYesPrice,
          noPrice: 1 - drawYesPrice,  // ✅ 1 - YES = NO price
          outcome: drawMarket!.question,
          winner: false
        };
      }

      // Create market object
      const market: PolymarketMarket = {
        id: matchData.slug,
        slug: matchData.slug,
        question: matchData.title,
        conditionId: homeWinMarket.conditionId,
        tokens: [homeToken, awayToken, ...(drawToken ? [drawToken] : [])],
        volume: matchData.volume24hr || 0,
        liquidity: matchData.liquidity || 0,
        endDate: matchData.endDate || new Date().toISOString()
      };

      const result: MarketSearchResult = {
        market,
        homeToken,
        awayToken,
        drawToken
      };

      // Cache'e kaydet
      this.cache.set(slug, result);

      console.log(`   🏠 Home: ${homeToken.outcome.slice(0, 50)}...`);
      console.log(`   🚗 Away: ${awayToken.outcome.slice(0, 50)}...`);
      if (drawToken) {
        console.log(`   🟰 Draw: ${drawToken.outcome.slice(0, 50)}...`);
      }
      console.log(`   💰 Volume: $${market.volume.toLocaleString()}`);
      console.log(`   💧 Liquidity: $${market.liquidity.toLocaleString()}`);

      return result;

    } catch (error: any) {
      console.error(`❌ Market fetch hatası: ${slug}`, error.message);
      return null;
    }
  }

  /**
   * Market fiyatlarını güncelle - GERÇEK FİYATLAR!
   * Polymarket CLOB API'den güncel fiyatları çeker
   */
  /**
   * Bir token ID için güncel fiyat al (basitleştirilmiş)
   */
  async getPriceForToken(tokenId: string): Promise<number | null> {
    try {
      return await this.getTokenPrice(tokenId);
    } catch (error) {
      console.error(`   ❌ Token fiyatı alınamadı: ${tokenId}`, error);
      return null;
    }
  }

  /**
   * DEPRECATED: Slug'dan tüm token'ları güncelleme (artık kullanılmıyor)
   * updateAllPositions() artık her pozisyonun kendi tokenId'sini kullanıyor
   */
  async updatePrices(slug: string): Promise<PolymarketToken[] | null> {
    try {
      // DEBUG: Cache durumunu kontrol et
      console.log(`   🔍 Cache lookup: ${slug}`);
      console.log(`   📊 Cache size: ${this.cache.size} markets`);
      
      // ÖNCELİKLE: Cache'den market data al
      const cached = this.cache.get(slug);
      
      if (cached) {
        console.log(`   ✅ Cache'de bulundu!`);
        
        // Cache'den token ID'leri al ve fiyatları güncelle
        const tokens: PolymarketToken[] = [];
        
        // Home token
        const homeYesPrice = await this.getTokenPrice(cached.homeToken.yesTokenId);
        tokens.push({
          yesTokenId: cached.homeToken.yesTokenId,
          noTokenId: cached.homeToken.noTokenId,
          yesPrice: homeYesPrice,
          noPrice: 1 - homeYesPrice,
          outcome: cached.homeToken.outcome,
          winner: false
        });
        
        // Away token
        const awayYesPrice = await this.getTokenPrice(cached.awayToken.yesTokenId);
        tokens.push({
          yesTokenId: cached.awayToken.yesTokenId,
          noTokenId: cached.awayToken.noTokenId,
          yesPrice: awayYesPrice,
          noPrice: 1 - awayYesPrice,
          outcome: cached.awayToken.outcome,
          winner: false
        });
        
        // Draw token (eğer varsa)
        if (cached.drawToken) {
          const drawYesPrice = await this.getTokenPrice(cached.drawToken.yesTokenId);
          tokens.push({
            yesTokenId: cached.drawToken.yesTokenId,
            noTokenId: cached.drawToken.noTokenId,
            yesPrice: drawYesPrice,
            noPrice: 1 - drawYesPrice,
            outcome: cached.drawToken.outcome,
            winner: false
          });
        }
        
        console.log(`   ✅ ${tokens.length} token fiyatı güncellendi`);
        return tokens;
      }
      
      console.log(`   ⚠️  Cache'de bulunamadı!`);
      console.log(`   📋 Cache keys:`, Array.from(this.cache.keys()).slice(0, 5));
      
      // FALLBACK: Local matchData'dan dene (eski sistem)
      const marketData = this.matchData.get(slug);
      if (!marketData || !marketData.markets) {
        console.log(`   ⚠️  Market data bulunamadı: ${slug}`);
        return null;
      }

      const tokens: PolymarketToken[] = [];

      // Her 3 market için token fiyatlarını çek
      for (let i = 0; i < marketData.markets.length; i++) {
        const market = marketData.markets[i];
        const tokenIds = JSON.parse(market.clobTokenIds);
        
        // YES token fiyatını çek
        const yesPrice = await this.getTokenPrice(tokenIds[0]);
        
        tokens.push({
          yesTokenId: tokenIds[0],
          noTokenId: tokenIds[1],
          yesPrice: yesPrice,
          noPrice: 1 - yesPrice,
          outcome: market.question,
          winner: false
        });
      }

      return tokens;

    } catch (error: any) {
      console.error(`❌ Price update hatası: ${slug}`, error.message);
      return null;
    }
  }

  /**
   * Tek bir token'ın güncel fiyatını çek
   * Polymarket CLOB orderbook'undan mid-price hesaplar
   */
  private async getTokenPrice(tokenId: string): Promise<number> {
    try {
      const axios = (await import('axios')).default;
      const CLOB_API = 'https://clob.polymarket.com';
      
      // Orderbook'u çek
      const response = await axios.get(`${CLOB_API}/book`, {
        params: {
          token_id: tokenId
        }
      });

      const { bids, asks } = response.data;

      // Best bid ve best ask
      const bestBid = bids?.[0]?.price || 0;
      const bestAsk = asks?.[0]?.price || 1;

      // Mid price (ortalama)
      const midPrice = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2;

      return midPrice;

    } catch (error: any) {
      console.error(`❌ Token price fetch failed: ${tokenId.slice(0, 10)}...`, error.message);
      return 0.5; // Default fallback
    }
  }

  /**
   * Polymarket Gamma API'den market verilerini çek
   * Local data'da yoksa bu kullanılır
   */
  private async fetchFromPolymarketAPI(slug: string): Promise<MarketSearchResult | null> {
    try {
      const axios = (await import('axios')).default;
      
      console.log(`   🌐 Polymarket API: ${slug}`);
      
      const response = await axios.get('https://gamma-api.polymarket.com/events', {
        params: {
          slug: slug,
          _limit: 1
        }
      });

      const events = response.data;
      if (!events || events.length === 0) {
        console.log(`   ❌ API'de bulunamadı: ${slug}`);
        return null;
      }

      const event = events[0];
      console.log(`   ✅ API'den bulundu: ${event.title}`);
      console.log(`   📊 Markets: ${event.markets?.length || 0}`);

      // Parse markets - Home Win, Draw, Away Win
      const markets = event.markets || [];
      
      const homeWinMarket = markets.find((m: any) => 
        m.question?.toLowerCase().includes('win') && 
        !m.question?.toLowerCase().includes('draw')
      );
      
      const drawMarket = markets.find((m: any) => 
        m.question?.toLowerCase().includes('draw')
      );
      
      const awayWinMarket = markets.find((m: any) => 
        m.question?.toLowerCase().includes('win') && 
        m.question !== homeWinMarket?.question
      );

      if (!homeWinMarket || !awayWinMarket) {
        console.log(`   ❌ Market structure incomplete`);
        return null;
      }

      // Parse token IDs (they come as JSON strings like '["0x123..."]')
      // clobTokenIds[0] = YES token, clobTokenIds[1] = NO token
      const getTokenIds = (market: any): { yesToken: string; noToken: string } => {
        if (market.clobTokenIds) {
          // Parse if string, or use directly if array
          const ids = typeof market.clobTokenIds === 'string' 
            ? JSON.parse(market.clobTokenIds) 
            : market.clobTokenIds;
          return {
            yesToken: ids[0] || '',
            noToken: ids[1] || ''
          };
        }
        return {
          yesToken: market.tokens?.[0]?.tokenId || '',
          noToken: market.tokens?.[1]?.tokenId || ''
        };
      };

      const getPrice = (market: any): number => {
        if (market.outcomePrices) {
          // outcomePrices format: ["Yes", "0.65"] or ["No", "0.35"]
          const prices = typeof market.outcomePrices === 'string'
            ? JSON.parse(market.outcomePrices)
            : market.outcomePrices;
          return parseFloat(prices[1] || '0.5');
        }
        return 0.5;
      };

      const homeTokens = getTokenIds(homeWinMarket);
      const awayTokens = getTokenIds(awayWinMarket);
      const drawTokens = drawMarket ? getTokenIds(drawMarket) : null;

      const homePrice = getPrice(homeWinMarket);
      const awayPrice = getPrice(awayWinMarket);
      const drawPrice = drawMarket ? getPrice(drawMarket) : 0.5;

      // Build result - store BOTH YES and NO token IDs
      const result: MarketSearchResult = {
        market: {
          conditionId: event.conditionId || homeWinMarket.conditionId,
          slug: slug,
          title: event.title,
          volume: event.volume || 0,
          liquidity: event.liquidity || 0,
          endDate: event.endDate
        },
        homeToken: {
          yesTokenId: homeTokens.yesToken,  // clobTokenIds[0]
          noTokenId: homeTokens.noToken,     // clobTokenIds[1]
          yesPrice: homePrice,
          noPrice: 1 - homePrice,
          outcome: 'YES',  // Default target
          winner: false
        },
        awayToken: {
          yesTokenId: awayTokens.yesToken,  // clobTokenIds[0]
          noTokenId: awayTokens.noToken,     // clobTokenIds[1]
          yesPrice: awayPrice,
          noPrice: 1 - awayPrice,
          outcome: 'YES',  // Default target
          winner: false
        }
      };

      // Add draw market if exists
      if (drawMarket && drawTokens) {
        result.drawToken = {
          yesTokenId: drawTokens.yesToken,  // clobTokenIds[0]
          noTokenId: drawTokens.noToken,     // clobTokenIds[1]
          yesPrice: drawPrice,
          noPrice: 1 - drawPrice,
          outcome: 'YES',  // Default target
          winner: false
        };
      }

      // Cache it
      this.cache.set(slug, result);
      console.log(`   💾 Cached: ${slug}`);

      return result;

    } catch (error: any) {
      console.error(`   ❌ Polymarket API error: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache'i temizle
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️  Market cache temizlendi');
  }

  /**
   * Polymarket link oluştur
   */
  getMarketLink(slug: string): string {
    return `https://polymarket.com/event/${slug}`;
  }

  /**
   * Likidite kontrolü
   */
  hasEnoughLiquidity(market: PolymarketMarket, minLiquidity: number = 5000): boolean {
    return market.liquidity >= minLiquidity;
  }
}
