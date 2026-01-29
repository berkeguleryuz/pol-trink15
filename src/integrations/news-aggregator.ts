/**
 * News Aggregator - Market-Specific News Fetching
 * Her market için özel haber kaynaklarından veri çeker
 * Ücretsiz API'ler ve RSS feedleri kullanır
 */

import axios from 'axios';
import { RegisteredMarket } from '../database/market-registry';

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  timestamp: Date;
  url?: string;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  relevance: number; // 0-1 score
}

export interface TradingSignalFromNews {
  market: RegisteredMarket;
  action: 'BUY_YES' | 'BUY_NO' | 'SELL' | 'HOLD';
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  newsItems: NewsItem[];
}

export class NewsAggregator {
  /**
   * Government shutdown için özel haber takibi
   */
  async fetchGovernmentNews(): Promise<NewsItem[]> {
    const news: NewsItem[] = [];

    try {
      // The Hill RSS (free)
      const hillRss = await this.fetchRSS(
        'https://thehill.com/homenews/administration/feed/'
      );
      news.push(...hillRss);

      // Politico (scraping)
      // Note: Bu production'da rate-limit yüzünden başarısız olabilir
      // Alternatif: NewsAPI.org (100 req/day free)
    } catch (error) {
      console.log('⚠️  Government news fetch failed:', error);
    }

    return news;
  }

  /**
   * Elon Musk tweet activity takibi
   * Twitter API yerine ücretsiz alternativeler
   */
  async fetchElonMuskActivity(): Promise<NewsItem[]> {
    const news: NewsItem[] = [];

    try {
      // Nitter (Twitter alternative - no API key needed)
      // https://nitter.net/elonmusk
      const response = await axios.get('https://nitter.net/elonmusk', {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });

      // Parse HTML to count tweets (simple scraping)
      const tweetMatches = response.data.match(/class="tweet-content/g);
      const tweetCount = tweetMatches ? tweetMatches.length : 0;

      news.push({
        title: `Elon Musk Activity`,
        summary: `Found ${tweetCount} recent tweets`,
        source: 'Nitter',
        timestamp: new Date(),
        relevance: 1.0,
      });
    } catch (error) {
      console.log('⚠️  Elon Musk activity fetch failed');
      
      // Fallback: Manual estimation
      news.push({
        title: 'Elon Musk Activity (Estimated)',
        summary: 'Unable to fetch real-time data',
        source: 'Manual',
        timestamp: new Date(),
        relevance: 0.5,
      });
    }

    return news;
  }

  /**
   * Bitcoin fiyat takibi (ücretsiz CoinGecko API)
   */
  async fetchBitcoinPrice(): Promise<NewsItem[]> {
    const news: NewsItem[] = [];

    try {
      // Try CoinGecko first
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
        { 
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }
      );

      const btcPrice = response.data.bitcoin.usd;
      const change24h = response.data.bitcoin.usd_24h_change;

      news.push({
        title: `Bitcoin Price: $${btcPrice.toLocaleString()}`,
        summary: `24h change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`,
        source: 'CoinGecko',
        timestamp: new Date(),
        sentiment: change24h > 0 ? 'POSITIVE' : 'NEGATIVE',
        relevance: 1.0,
      });
    } catch (error) {
      // Fallback: Use Binance public API (no key needed)
      try {
        const binanceResp = await axios.get(
          'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
          { timeout: 3000 }
        );
        
        const price = parseFloat(binanceResp.data.lastPrice);
        const change = parseFloat(binanceResp.data.priceChangePercent);
        
        news.push({
          title: `Bitcoin Price: $${price.toLocaleString()}`,
          summary: `24h change: ${change > 0 ? '+' : ''}${change.toFixed(2)}%`,
          source: 'Binance',
          timestamp: new Date(),
          sentiment: change > 0 ? 'POSITIVE' : 'NEGATIVE',
          relevance: 1.0,
        });
      } catch (fallbackError) {
        // Silent fail - no Bitcoin price available
      }
    }

    return news;
  }

  /**
   * Generic RSS feed parser
   */
  private async fetchRSS(url: string): Promise<NewsItem[]> {
    const news: NewsItem[] = [];

    try {
      const response = await axios.get(url, { timeout: 5000 });
      const xml = response.data;

      // Simple regex parsing (production: use xml2js)
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

      for (const item of items.slice(0, 5)) {
        // Top 5
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
        const descMatch = item.match(
          /<description><!\[CDATA\[(.*?)\]\]><\/description>/
        );

        if (titleMatch && descMatch) {
          news.push({
            title: titleMatch[1],
            summary: descMatch[1].replace(/<[^>]*>/g, '').slice(0, 200),
            source: url,
            timestamp: new Date(),
            relevance: 0.7,
          });
        }
      }
    } catch (error) {
      // Silent fail
    }

    return news;
  }

  /**
   * Market için relevance check
   */
  calculateRelevance(market: RegisteredMarket, newsItem: NewsItem): number {
    const keywords = this.extractKeywords(market.question);
    const newsText = (newsItem.title + ' ' + newsItem.summary).toLowerCase();

    let matches = 0;
    for (const keyword of keywords) {
      if (newsText.includes(keyword)) {
        matches++;
      }
    }

    return Math.min(matches / keywords.length, 1.0);
  }

  /**
   * Market'ten anahtar kelimeler çıkar
   */
  private extractKeywords(question: string): string[] {
    const stopWords = [
      'will',
      'the',
      'be',
      'on',
      'in',
      'of',
      'to',
      'by',
      'at',
      'for',
    ];
    const words = question
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.includes(w));

    return [...new Set(words)]; // unique
  }

  /**
   * Haberlere göre trading sinyali üret
   */
  async analyzeNewsForMarket(
    market: RegisteredMarket
  ): Promise<TradingSignalFromNews> {
    const q = market.question.toLowerCase();
    let newsItems: NewsItem[] = [];

    // Kategoriye göre haber çek
    if (q.includes('government') || q.includes('shutdown')) {
      newsItems = await this.fetchGovernmentNews();
    } else if (q.includes('elon') || q.includes('musk')) {
      newsItems = await this.fetchElonMuskActivity();
    } else if (q.includes('bitcoin') || q.includes('btc')) {
      newsItems = await this.fetchBitcoinPrice();
    }

    // Relevance filtrele
    const relevantNews = newsItems
      .map(item => ({
        ...item,
        relevance: this.calculateRelevance(market, item),
      }))
      .filter(item => item.relevance > 0.3)
      .sort((a, b) => b.relevance - a.relevance);

    // Sinyal üret
    if (relevantNews.length === 0) {
      return {
        market,
        action: 'HOLD',
        reason: 'No relevant news found',
        confidence: 'LOW',
        newsItems: [],
      };
    }

    // Sentiment analizi (basit)
    const positiveNews = relevantNews.filter(n => n.sentiment === 'POSITIVE')
      .length;
    const negativeNews = relevantNews.filter(n => n.sentiment === 'NEGATIVE')
      .length;

    let action: 'BUY_YES' | 'BUY_NO' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

    if (positiveNews > negativeNews) {
      action = 'BUY_YES';
      confidence = positiveNews > 2 ? 'HIGH' : 'MEDIUM';
    } else if (negativeNews > positiveNews) {
      action = 'BUY_NO';
      confidence = negativeNews > 2 ? 'HIGH' : 'MEDIUM';
    }

    return {
      market,
      action,
      reason: `${relevantNews.length} relevant news items found (${positiveNews} positive, ${negativeNews} negative)`,
      confidence,
      newsItems: relevantNews,
    };
  }

  /**
   * Multiple markets için batch analysis
   */
  async analyzeMultipleMarkets(
    markets: RegisteredMarket[]
  ): Promise<TradingSignalFromNews[]> {
    console.log(`📰 Analyzing news for ${markets.length} markets...\n`);

    const signals: TradingSignalFromNews[] = [];

    for (const market of markets) {
      const signal = await this.analyzeNewsForMarket(market);
      if (signal.action !== 'HOLD') {
        signals.push(signal);
        console.log(`✅ ${market.question}`);
        console.log(`   Action: ${signal.action} (${signal.confidence})`);
        console.log(`   Reason: ${signal.reason}\n`);
      }
    }

    console.log(`📊 Found ${signals.length} actionable signals\n`);
    return signals;
  }
}
