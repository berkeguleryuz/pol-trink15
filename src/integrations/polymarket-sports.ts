/**
 * Polymarket Sports API Client
 * 
 * Gerçek Polymarket sports markets'i tarar
 * https://polymarket.com/sports/epl/games
 * https://polymarket.com/sports/ucl/games
 * etc.
 */

import axios from 'axios';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
const CLOB_API_URL = 'https://clob.polymarket.com';

/**
 * Polymarket Sports Leagues
 * 
 * Series ID'ler curl "https://gamma-api.polymarket.com/sports" ile alındı
 * 
 * 🔥 IMPORTANT: Brasileirão/Copa Libertadores için özel API yok!
 * Bunlar "lib" (Libertadores), "sud" (Sudamericana), "arg" (Argentina), "mex" (Liga MX) içinde
 */
export const SPORTS_LEAGUES = [
  // European Soccer
  { slug: 'epl', name: 'English Premier League', category: 'soccer', seriesId: '10188' },
  { slug: 'ucl', name: 'UEFA Champions League', category: 'soccer', seriesId: '10204' },
  { slug: 'lal', name: 'La Liga', category: 'soccer', seriesId: '10193' },
  { slug: 'bun', name: 'Bundesliga', category: 'soccer', seriesId: '10194' },
  { slug: 'fl1', name: 'Ligue 1', category: 'soccer', seriesId: '10195' },
  { slug: 'sea', name: 'Serie A', category: 'soccer', seriesId: '10203' },
  { slug: 'uel', name: 'UEFA Europa League', category: 'soccer', seriesId: '10209' },
  { slug: 'tur', name: 'Turkish Süper Lig', category: 'soccer', seriesId: '10292' },
  { slug: 'ere', name: 'Eredivisie (Dutch)', category: 'soccer', seriesId: '10286' },
  { slug: 'efl', name: 'EFL Championship', category: 'soccer', seriesId: '10230' },
  { slug: 'efa', name: 'FA Cup', category: 'soccer', seriesId: '10307' },
  
  // South American Soccer - 🚨 BRAZİLEİRÃO BURADA!
  { slug: 'lib', name: 'Copa Libertadores', category: 'soccer', seriesId: '10289' },
  { slug: 'sud', name: 'Copa Sudamericana', category: 'soccer', seriesId: '10291' },
  { slug: 'arg', name: 'Argentina Primera División', category: 'soccer', seriesId: '10285' },
  
  // North/Central America
  { slug: 'mls', name: 'MLS', category: 'soccer', seriesId: '10189' },
  { slug: 'mex', name: 'Liga MX', category: 'soccer', seriesId: '10290' },
  { slug: 'lcs', name: 'Leagues Cup', category: 'soccer', seriesId: '10288' },
  
  // Other Sports
  { slug: 'nba', name: 'NBA', category: 'basketball', seriesId: '10345' },
  { slug: 'nfl', name: 'NFL', category: 'football', seriesId: '10187' },
];

export interface PolymarketSportsEvent {
  id: string;
  slug: string;
  title: string; // e.g., "Arsenal vs Liverpool"
  description: string;
  startDate: string; // ISO timestamp
  endDate: string;
  
  // Markets for this event
  markets: Array<{
    id: string;
    conditionId: string;
    questionID: string;
    question: string; // e.g., "Will Arsenal win?"
    tokens: Array<{
      token_id: string;
      outcome: string;
      price: number;
      winner: boolean | null;
    }>;
    volume: number;
    liquidity: number;
    active: boolean;
    closed: boolean;
    archived: boolean;
    accepting_orders: boolean;
    end_date_iso: string;
  }>;
  
  // Parsed info
  league: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: Date;
}

export class PolymarketSportsClient {
  private baseUrl: string;
  private clobUrl: string;

  constructor() {
    this.baseUrl = GAMMA_API_URL;
    this.clobUrl = CLOB_API_URL;
  }

  /**
   * 🎯 SLUG ile direkt event ara
   * 
   * Örnek: searchEventBySlug('bra-sao-fla-2025-11-05')
   * 
   * ✅ CANLI maçlar için EN DOĞRU yöntem!
   * URL format: https://polymarket.com/event/bra-sao-fla-2025-11-05
   */
  async searchEventBySlug(slug: string): Promise<any | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/events`, {
        params: { slug },
        timeout: 10000,
      });

      const events = response.data || [];
      
      if (events.length === 0) {
        return null;
      }

      // İlk sonucu döndür (slug unique olmalı)
      return events[0];
    } catch (error: any) {
      console.error(`Failed to fetch event by slug ${slug}:`, error.message);
      return null;
    }
  }

  /**
   * Belirli bir lig için sports events al
   */
  async getSportsEvents(leagueSlug: string): Promise<PolymarketSportsEvent[]> {
    try {
      // Polymarket'in events endpoint'i
      const response = await axios.get(`${this.baseUrl}/events`, {
        params: {
          tag: leagueSlug,
          active: true,
          closed: false,
          archived: false,
          limit: 100,
        },
        timeout: 10000,
      });

      const events = response.data || [];
      const parsed: PolymarketSportsEvent[] = [];

      for (const event of events) {
        const parsedEvent = this.parseEvent(event, leagueSlug);
        if (parsedEvent) {
          parsed.push(parsedEvent);
        }
      }

      return parsed;
    } catch (error: any) {
      console.error(`Failed to fetch ${leagueSlug} events:`, error.message);
      return [];
    }
  }

  /**
   * SADECE aktif ve trade edilebilir spor marketlerini al
   * 
   * ⚡ PAGINATION: API 500 limit koyuyor, birden fazla request atalım
   * ⏰ FILTER: Geçmiş maçları (closed/expired) alma!
   */
  async getActiveTradableMarkets(): Promise<any[]> {
    console.log('\n⚽ Fetching ALL ACTIVE Sports Markets from Polymarket (with pagination)...\n');

    const allEvents: any[] = [];
    const limit = 500;
    const maxPages = 4; // 500 x 4 = 2000 event
    const now = new Date();

    try {
      for (let page = 0; page < maxPages; page++) {
        const offset = page * limit;
        console.log(`   📡 Page ${page + 1}/${maxPages} (offset: ${offset})...`);
        
        const response = await axios.get(`${this.baseUrl}/events`, {
          params: {
            active: true,
            closed: false,
            archived: false,
            limit: limit,
            offset: offset,
          },
          timeout: 20000,
        });

        const events = response.data || [];
        
        if (events.length === 0) {
          console.log(`   ℹ️  No more events\n`);
          break;
        }
        
        console.log(`   ✅ Got ${events.length} events`);
        
        // SADECE sports eventlerini filtrele
        events.forEach((event: any) => {
          if (!event.markets || event.markets.length === 0) return;
          
          // ⏰ GEÇMİŞ MAÇLARI ALMA!
          if (event.endDate) {
            const endDate = new Date(event.endDate);
            if (endDate < now) {
              return; // Skip expired events
            }
          }
          
          const title = event.title || '';
          const slug = event.slug || '';
          
          // Soccer maçı mı?
          const isSoccerMatch = 
            /\bvs\.?\b/i.test(title) || // "vs" or "vs."
            slug.includes('-vs-') ||
            this.isSportsEvent(event);
          
          if (!isSoccerMatch) return;
          
          // Her market'i ekle
          event.markets.forEach((market: any) => {
            if (market.acceptingOrders === true) {
              allEvents.push({
                ...market,
                eventTitle: event.title,
                eventSlug: event.slug,
                eventStartDate: event.startDate,
                eventEndDate: event.endDate,
                eventDescription: event.description,
              });
            }
          });
        });
        
        // Son sayfa mı?
        if (events.length < limit) {
          console.log(`   ℹ️  Last page\n`);
          break;
        }
      }

      console.log(`   🎯 TOTAL: ${allEvents.length} tradable sports markets\n`);
      return allEvents;
    } catch (error: any) {
      console.error('Failed to fetch markets:', error.message);
      return allEvents;
    }
  }
  
  /**
   * Event'in spor eventi olup olmadığını kontrol et
   */
  private isSportsEvent(event: any): boolean {
    const title = (event.title || '').toLowerCase();
    const slug = (event.slug || '').toLowerCase();
    const description = (event.description || '').toLowerCase();
    
    // Soccer team patterns
    const soccerPatterns = [
      'fc', 'sc', 'cf', 'united', 'city', 'athletic', 'real', 'atletico',
      'juventus', 'milan', 'inter', 'arsenal', 'chelsea', 'liverpool',
      'barcelona', 'madrid', 'bayern', 'dortmund', 'psg',
      'botafogo', 'corinthians', 'flamengo', 'palmeiras', 'gremio',
      'bragantino', 'vasco', 'cruzeiro', 'athletico', 'bahia',
    ];
    
    const fullText = `${title} ${slug} ${description}`;
    
    return soccerPatterns.some(pattern => fullText.includes(pattern));
  }

  /**
   * Market'in spor market olup olmadığını kontrol et
   * 
   * Polymarket marketleri TAG'siz olabiliyor!
   * Bu yüzden çoklu strateji kullanıyoruz:
   * 1. Description'da spor keywords ara
   * 2. Question'da spor patterns ara (örn: "Will X beat Y?")
   * 3. Ekonomi/politik keywords varsa EXCLUDE et
   */
  private isSportsMarket(market: any): boolean {
    const question = (market.question || '').toLowerCase();
    const description = (market.description || '').toLowerCase();
    const fullText = `${question} ${description}`;

    // ❌ EXCLUDE: Ekonomi, politika, kripto keywords
    const excludeKeywords = [
      'fed', 'rate', 'recession', 'inflation', 'gdp',
      'trump', 'biden', 'election', 'president', 'senate', 'congress',
      'bitcoin', 'ethereum', 'crypto', 'usdt', 'tether',
      'ukraine', 'russia', 'nato', 'iran', 'nuclear',
      'ai model', 'openai', 'google', 'anthropic', 'deepseek',
      'weed', 'marijuana', 'rescheduled',
    ];

    if (excludeKeywords.some(keyword => fullText.includes(keyword))) {
      return false;
    }

    // ✅ INCLUDE: Spor keywords (daha spesifik)
    const sportsKeywords = [
      // Leagues
      'premier league', 'champions league', 'europa league', 'la liga',
      'bundesliga', 'serie a', 'ligue 1', 'mls',
      'uefa', 'fifa', 'world cup', 'euro',
      
      // Teams (common patterns)
      'arsenal', 'liverpool', 'manchester', 'chelsea', 'barcelona',
      'real madrid', 'bayern', 'psg', 'juventus', 'milan',
      
      // Match patterns
      'will the match', 'will this match', 'will this game',
      'win this match', 'win the match', 'win this game',
      'beat', 'defeat', 'vs', 'match result',
      
      // Sports-specific
      'goal', 'score', 'kickoff', 'overtime', 'penalty',
      'championship', 'tournament', 'playoff',
    ];

    if (sportsKeywords.some(keyword => fullText.includes(keyword))) {
      return true;
    }

    // Question pattern: "Will X beat/defeat Y?"
    if (question.match(/will .+ (beat|defeat|win)/)) {
      // Ama ekonomi/politik değilse
      return !excludeKeywords.some(keyword => fullText.includes(keyword));
    }

    return false;
  }

  /**
   * TÜM aktif ligler için events al
   */
  async getAllSportsEvents(): Promise<PolymarketSportsEvent[]> {
    console.log('\n⚽ Fetching ALL Polymarket Sports Events...\n');

    const allEvents: PolymarketSportsEvent[] = [];

    for (const league of SPORTS_LEAGUES) {
      console.log(`   Scanning ${league.name} (${league.slug})...`);
      
      const events = await this.getSportsEvents(league.slug);
      
      if (events.length > 0) {
        console.log(`   ✅ Found ${events.length} events in ${league.name}`);
        allEvents.push(...events);
      } else {
        console.log(`   ⚠️  No events in ${league.name}`);
      }
    }

    console.log(`\n📊 TOTAL: ${allEvents.length} sports events across all leagues\n`);

    return allEvents;
  }

  /**
   * Event parse et
   */
  private parseEvent(event: any, leagueSlug: string): PolymarketSportsEvent | null {
    try {
      const title = event.title || '';
      
      // Team names çıkar
      const teams = this.extractTeamsFromTitle(title);

      // Markets al
      const markets = (event.markets || []).map((market: any) => ({
        id: market.id,
        conditionId: market.condition_id,
        questionID: market.question_id,
        question: market.question,
        tokens: (market.tokens || []).map((token: any) => ({
          token_id: token.token_id,
          outcome: token.outcome,
          price: parseFloat(token.price || '0'),
          winner: token.winner,
        })),
        volume: parseFloat(market.volume || '0'),
        liquidity: parseFloat(market.liquidity || '0'),
        active: market.active,
        closed: market.closed,
        archived: market.archived,
        accepting_orders: market.accepting_orders,
        end_date_iso: market.end_date_iso,
      }));

      return {
        id: event.id,
        slug: event.slug,
        title: event.title,
        description: event.description || '',
        startDate: event.start_date_iso,
        endDate: event.end_date_iso,
        markets,
        league: leagueSlug,
        homeTeam: teams?.home,
        awayTeam: teams?.away,
        kickoffTime: event.start_date_iso ? new Date(event.start_date_iso) : undefined,
      };
    } catch (error) {
      console.error(`Failed to parse event: ${event?.title}`, error);
      return null;
    }
  }

  /**
   * Title'dan team names çıkar
   * Format: "Arsenal vs Liverpool" veya "Arsenal v Liverpool"
   */
  private extractTeamsFromTitle(title: string): { home: string; away: string } | null {
    // Pattern 1: "X vs Y" veya "X v Y"
    let match = title.match(/^(.+?)\s+(?:vs\.?|v)\s+(.+?)$/i);
    if (match) {
      return {
        home: match[1].trim(),
        away: match[2].trim(),
      };
    }

    // Pattern 2: "X - Y"
    match = title.match(/^(.+?)\s+-\s+(.+?)$/);
    if (match) {
      return {
        home: match[1].trim(),
        away: match[2].trim(),
      };
    }

    return null;
  }

  /**
   * Belirli bir market için detaylı bilgi al
   */
  async getMarketDetails(conditionId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/markets/${conditionId}`, {
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      console.error(`Failed to fetch market ${conditionId}`);
      return null;
    }
  }

  /**
   * Live/Upcoming events ayır
   */
  categorizeSportsEvents(events: PolymarketSportsEvent[]): {
    live: PolymarketSportsEvent[];
    upcoming: PolymarketSportsEvent[];
    ended: PolymarketSportsEvent[];
  } {
    const now = Date.now();
    const live: PolymarketSportsEvent[] = [];
    const upcoming: PolymarketSportsEvent[] = [];
    const ended: PolymarketSportsEvent[] = [];

    for (const event of events) {
      if (!event.kickoffTime) {
        continue;
      }

      const kickoff = event.kickoffTime.getTime();
      const endTime = new Date(event.endDate).getTime();

      // Maç bitti mi? (end_date geçmiş ve tüm marketler closed)
      const allMarketsClosed = event.markets.every(m => m.closed);
      if (endTime < now && allMarketsClosed) {
        ended.push(event);
        continue;
      }

      // Live mi? (kickoff geçmiş ama henüz bitmemiş)
      if (kickoff <= now && endTime > now) {
        live.push(event);
        continue;
      }

      // Upcoming (kickoff henüz gelmedi)
      if (kickoff > now) {
        upcoming.push(event);
        continue;
      }
    }

    return { live, upcoming, ended };
  }

  /**
   * Events'i kickoff zamanına göre sırala
   */
  sortByKickoff(events: PolymarketSportsEvent[]): PolymarketSportsEvent[] {
    return events.sort((a, b) => {
      if (!a.kickoffTime || !b.kickoffTime) return 0;
      return a.kickoffTime.getTime() - b.kickoffTime.getTime();
    });
  }

  /**
   * Yakında başlayacak maçları bul (gelecek N dakika içinde)
   */
  getUpcomingSoon(events: PolymarketSportsEvent[], minutesAhead: number = 60): PolymarketSportsEvent[] {
    const now = Date.now();
    const maxTime = now + (minutesAhead * 60 * 1000);

    return events.filter(event => {
      if (!event.kickoffTime) return false;
      const kickoff = event.kickoffTime.getTime();
      return kickoff >= now && kickoff <= maxTime;
    });
  }

  /**
   * Event'i detaylı yazdır
   */
  printEvent(event: PolymarketSportsEvent, includeMarkets: boolean = true): void {
    const kickoffBerlin = event.kickoffTime?.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const now = Date.now();
    const isLive = event.kickoffTime && event.kickoffTime.getTime() <= now;

    console.log(`\n${isLive ? '🔴' : '⚽'} ${event.title}`);
    console.log(`   League: ${event.league.toUpperCase()}`);
    if (event.homeTeam && event.awayTeam) {
      console.log(`   Teams: ${event.homeTeam} vs ${event.awayTeam}`);
    }
    if (kickoffBerlin) {
      console.log(`   Kickoff: ${kickoffBerlin} Berlin time`);
      
      if (event.kickoffTime) {
        const minutesUntil = Math.floor((event.kickoffTime.getTime() - now) / 60000);
        if (minutesUntil > 0) {
          console.log(`   Starting in: ${minutesUntil} minutes`);
        } else {
          console.log(`   Status: LIVE (${Math.abs(minutesUntil)} minutes elapsed)`);
        }
      }
    }

    if (includeMarkets && event.markets.length > 0) {
      console.log(`   Markets: ${event.markets.length}`);
      
      event.markets.forEach(market => {
        const activeOrders = market.accepting_orders ? '✅' : '❌';
        const totalVolume = (market.volume / 1000).toFixed(1);
        
        console.log(`      ${activeOrders} ${market.question}`);
        console.log(`         Volume: $${totalVolume}K | Liquidity: $${(market.liquidity / 1000).toFixed(1)}K`);
        
        market.tokens.forEach(token => {
          console.log(`         ${token.outcome}: ${(token.price * 100).toFixed(1)}%`);
        });
      });
    }
  }

  /**
   * Summary yazdır
   */
  printSummary(events: PolymarketSportsEvent[]): void {
    const categorized = this.categorizeSportsEvents(events);
    const upcomingSoon = this.getUpcomingSoon(categorized.upcoming, 60);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 POLYMARKET SPORTS SUMMARY`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`Total Events: ${events.length}`);
    console.log(`🔴 Live Matches: ${categorized.live.length}`);
    console.log(`⏰ Upcoming Matches: ${categorized.upcoming.length}`);
    console.log(`   └─> Starting in next 60 min: ${upcomingSoon.length}`);
    console.log(`✅ Ended Matches: ${categorized.ended.length}`);

    // Liglere göre breakdown
    const byLeague = new Map<string, number>();
    events.forEach(event => {
      const count = byLeague.get(event.league) || 0;
      byLeague.set(event.league, count + 1);
    });

    console.log(`\nBy League:`);
    Array.from(byLeague.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([league, count]) => {
        const leagueInfo = SPORTS_LEAGUES.find(l => l.slug === league);
        const name = leagueInfo?.name || league;
        console.log(`   ${name}: ${count} events`);
      });

    console.log(`\n${'='.repeat(80)}\n`);
  }
}
