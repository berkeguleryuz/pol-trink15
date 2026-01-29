/**
 * 🌐 ADDITIONAL SPORTS DATA SOURCES
 * 
 * Bu dosya ileride eklenebilecek ek API kaynaklarını içerir.
 * Şu an sadece test edilmiş, production'a alınmadı.
 */

import axios, { AxiosInstance } from 'axios';

/**
 * 1. LiveScore API (WebSocket için ideal, ama ücretli)
 * Speed: ~100ms
 * Cost: $50-200/mo
 * Coverage: All major leagues + live scores
 */
export class LiveScoreClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.LIVESCORE_API_KEY || '';
    this.client = axios.create({
      baseURL: 'https://livescore-api.com/api-client',
      headers: {
        'key': this.apiKey,
        'secret': process.env.LIVESCORE_API_SECRET || ''
      }
    });
  }

  async getLiveMatches() {
    const startTime = Date.now();
    
    try {
      const response = await this.client.get('/scores/live.json');
      const latency = Date.now() - startTime;
      
      console.log(`⚡ LiveScore API: ${latency}ms`);
      
      return {
        data: response.data,
        latency,
        source: 'livescore'
      };
    } catch (error) {
      console.error('❌ LiveScore failed:', error);
      throw error;
    }
  }
}

/**
 * 2. SportMonks API
 * Speed: ~200ms
 * Cost: $20-100/mo
 * Coverage: Extensive data, good for pre-match odds
 */
export class SportMonksClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.SPORTMONKS_API_KEY || '';
    this.client = axios.create({
      baseURL: 'https://api.sportmonks.com/v3',
      headers: {
        'Authorization': this.apiKey
      }
    });
  }

  async getLiveMatches() {
    const startTime = Date.now();
    
    try {
      const response = await this.client.get('/football/livescores/inplay');
      const latency = Date.now() - startTime;
      
      console.log(`⚡ SportMonks API: ${latency}ms`);
      
      return {
        data: response.data,
        latency,
        source: 'sportmonks'
      };
    } catch (error) {
      console.error('❌ SportMonks failed:', error);
      throw error;
    }
  }
}

/**
 * 3. SofaScore API (Unofficial - web scraping)
 * Speed: ~150ms
 * Cost: FREE (but unofficial)
 * Coverage: Real-time scores, very fast updates
 */
export class SofaScoreClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.sofascore.com/api/v1',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
  }

  async getLiveMatches() {
    const startTime = Date.now();
    
    try {
      const response = await this.client.get('/sport/football/events/live');
      const latency = Date.now() - startTime;
      
      console.log(`⚡ SofaScore API: ${latency}ms`);
      
      return {
        data: response.data,
        latency,
        source: 'sofascore'
      };
    } catch (error) {
      console.error('❌ SofaScore failed:', error);
      throw error;
    }
  }
}

/**
 * 4. Flashscore API (Unofficial)
 * Speed: ~120ms
 * Cost: FREE (web scraping)
 * Coverage: Very fast goal updates
 */
export class FlashscoreClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://www.flashscore.com',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'X-Fsign': 'SW9D1eZo' // Required for API access
      }
    });
  }

  async getLiveMatches() {
    const startTime = Date.now();
    
    try {
      // Flashscore uses a custom feed format
      const response = await this.client.get('/x/feed/f_1_0_2_en_1');
      const latency = Date.now() - startTime;
      
      console.log(`⚡ Flashscore API: ${latency}ms`);
      
      return {
        data: response.data,
        latency,
        source: 'flashscore'
      };
    } catch (error) {
      console.error('❌ Flashscore failed:', error);
      throw error;
    }
  }
}

/**
 * 5. FotMob API (Mobile App API)
 * Speed: ~100ms
 * Cost: FREE (unofficial)
 * Coverage: Real-time, very fast
 */
export class FotMobClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://www.fotmob.com/api',
      headers: {
        'User-Agent': 'FotMob/iOS'
      }
    });
  }

  async getLiveMatches() {
    const startTime = Date.now();
    
    try {
      const response = await this.client.get('/matches', {
        params: {
          status: 'live',
          date: new Date().toISOString().split('T')[0]
        }
      });
      
      const latency = Date.now() - startTime;
      
      console.log(`⚡ FotMob API: ${latency}ms`);
      
      return {
        data: response.data,
        latency,
        source: 'fotmob'
      };
    } catch (error) {
      console.error('❌ FotMob failed:', error);
      throw error;
    }
  }
}

/**
 * Helper: Test all APIs and find fastest
 */
export async function benchmarkAllAPIs() {
  console.log('\n🏁 BENCHMARKING ALL APIs...\n');

  const results: { source: string; latency: number; success: boolean }[] = [];

  // Test each API
  const apis = [
    { name: 'LiveScore', test: () => new LiveScoreClient().getLiveMatches() },
    { name: 'SportMonks', test: () => new SportMonksClient().getLiveMatches() },
    { name: 'SofaScore', test: () => new SofaScoreClient().getLiveMatches() },
    { name: 'Flashscore', test: () => new FlashscoreClient().getLiveMatches() },
    { name: 'FotMob', test: () => new FotMobClient().getLiveMatches() },
  ];

  for (const api of apis) {
    try {
      const result = await api.test();
      results.push({
        source: api.name,
        latency: result.latency,
        success: true
      });
    } catch (error) {
      results.push({
        source: api.name,
        latency: 9999,
        success: false
      });
    }
  }

  // Sort by latency
  results.sort((a, b) => a.latency - b.latency);

  // Print results
  console.log('\n📊 BENCHMARK RESULTS:\n');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const emoji = result.latency < 150 ? '⚡⚡' : result.latency < 250 ? '⚡' : '🐢';
    console.log(`${status} ${emoji} ${result.source}: ${result.latency}ms`);
  }

  const fastest = results[0];
  console.log(`\n🏆 WINNER: ${fastest.source} (${fastest.latency}ms)\n`);

  return results;
}

/**
 * USAGE:
 * 
 * // .env dosyasına ekle:
 * LIVESCORE_API_KEY=your_key
 * LIVESCORE_API_SECRET=your_secret
 * SPORTMONKS_API_KEY=your_key
 * 
 * // Test et:
 * npm run benchmark-apis
 * 
 * // En hızlısını otomatik seç:
 * const aggregator = new SportsDataAggregator();
 * aggregator.addSource(new LiveScoreClient());
 * aggregator.addSource(new SofaScoreClient());
 * 
 * // Race yapınca en hızlı kazanır
 * const matches = await aggregator.getLiveMatches();
 */
